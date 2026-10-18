/** Fit a formula to listings: coefficients, cross-validation and per-listing predictions. */
import { FORMULA_ALIASES } from './data'
import {
  buildDesign,
  type ColumnPart,
  type Design,
  type Formula,
  FormulaError,
  inverseResponse,
  parseFormula,
  type ResponseKind,
  responseKind,
} from './formula'
import { ols, type OlsFit, predictionSe, predictRow, tCritical, tPValue } from './ols'
import { rng } from './stats'
import type { ModelMetrics, Row } from './types'

export interface Coef {
  name: string
  parts: ColumnPart[]
  estimate: number
  se: number
  t: number
  p: number
  lo: number
  hi: number
  /** exp(b) - 1 when the response is log-transformed */
  pct: number | null
  pctLo: number | null
  pctHi: number | null
  /** when standardised: the column's SD, so the estimate is the effect of a 1-SD change */
  sd: number | null
}

export interface CvResult {
  folds: number
  n: number
  /** R² of out-of-fold predictions on the response's (transformed) scale */
  r2: number
  /** on the original scale, when the response transform can be inverted */
  mae: number | null
  mape: number | null
  /** root mean squared error on the original scale (e.g. £) */
  rmse: number | null
}

export interface ModelResult {
  formula: Formula
  design: Design
  fit: OlsFit
  coefs: Coef[]
  response: { kind: ResponseKind; variable: string | null }
  cv: CvResult | null
  /** listing id → in-sample prediction on the original scale */
  fitted: Map<number, number>
  /** listing id → out-of-fold prediction on the original scale */
  oof: Map<number, number>
  warnings: string[]
  /** prediction on the original scale for any row (e.g. another source), or null */
  predict(row: Row): number | null
  /** prediction with a prediction interval for a new car, on the original scale, or null */
  predictInterval(row: Record<string, unknown>, level?: number): { fit: number; lo: number; hi: number } | null
}

export interface ModelOptions {
  folds?: number
  seed?: number
  refs?: Record<string, string>
  /** centre and scale numeric columns, so coefficients are per 1 SD (predictions are unchanged) */
  standardise?: boolean
}

interface Scaling {
  mean: number
  sd: number
}

/**
 * Centre (when there's an intercept) and scale purely numeric columns. Dummy and
 * mixed columns are left alone so their effects still read "vs the reference level".
 * With an intercept this is a reparametrisation: fitted values don't change.
 */
function standardise(design: Design): { design: Design; scaling: (Scaling | null)[] } {
  const n = design.X.length
  const scaling = design.columns.map((c, j): Scaling | null => {
    if (c.name === '(Intercept)' || c.parts.some((pt) => pt.level !== null)) return null
    const mean = design.intercept ? design.X.reduce((a, x) => a + x[j], 0) / n : 0
    const sd = Math.sqrt(design.X.reduce((a, x) => a + (x[j] - mean) ** 2, 0) / Math.max(n - 1, 1))
    return sd > 0 ? { mean, sd } : null
  })
  const apply = (x: number[]) => x.map((v, j) => (scaling[j] ? (v - scaling[j]!.mean) / scaling[j]!.sd : v))
  return {
    design: {
      ...design,
      X: design.X.map(apply),
      encode: (row) => {
        const x = design.encode(row)
        return x && apply(x)
      },
    },
    scaling,
  }
}

export function fitModel(rows: Row[], formulaText: string, opts: ModelOptions = {}): ModelResult {
  const formula = parseFormula(formulaText)
  const data = rows as unknown as Record<string, unknown>[]
  const raw = buildDesign(formula, data, { aliases: FORMULA_ALIASES, refs: opts.refs })
  const { design, scaling } = opts.standardise ? standardise(raw) : { design: raw, scaling: raw.columns.map(() => null) }
  if (design.X.length < 10) throw new FormulaError(`Only ${design.X.length} complete rows: too few to fit`)
  const fit = ols(design.X, design.y, design.intercept)
  const response = responseKind(formula)
  const inv = inverseResponse(response.kind)
  const isLog = response.kind === 'log' || response.kind === 'log1p'
  const tc = tCritical(fit.df)

  const coefs: Coef[] = design.columns.flatMap((c, j) => {
    if (!fit.kept[j]) return []
    const b = fit.beta[j]
    const se = fit.se[j]
    const lo = b - tc * se
    const hi = b + tc * se
    const pct = (v: number) => (isLog && c.name !== '(Intercept)' ? Math.expm1(v) : null)
    const sd = scaling[j]?.sd ?? null
    return [{ name: c.name, parts: c.parts, estimate: b, se, t: b / se, p: tPValue(b / se, fit.df), lo, hi, pct: pct(b), pctLo: pct(lo), pctHi: pct(hi), sd }]
  })
  const dropped = design.columns.filter((_, j) => !fit.kept[j]).map((c) => c.name)
  const warnings = [...design.warnings]
  if (dropped.length) warnings.push(`Dropped collinear columns: ${dropped.join(', ')}`)
  if (design.dropped) warnings.push(`${design.dropped} rows skipped for missing or invalid values`)

  const fitted = new Map<number, number>()
  if (inv)
    design.rows.forEach((ri, i) => {
      const p = predictRow(fit, design.X[i])
      if (p !== null) fitted.set(rows[ri].id, inv(p))
    })

  const { cv, oof } = crossValidate(rows, design, opts.folds ?? 5, opts.seed ?? 1, inv)
  return {
    formula,
    design,
    fit,
    coefs,
    response,
    cv,
    fitted,
    oof,
    warnings,
    predict(row) {
      const x = design.encode(row as unknown as Record<string, unknown>)
      if (!x || !inv) return null
      const p = predictRow(fit, x)
      return p === null ? null : inv(p)
    },
    predictInterval(row, level = 0.95) {
      const x = design.encode(row)
      if (!x || !inv) return null
      const p = predictRow(fit, x)
      if (p === null) return null
      const half = tCritical(fit.df, 1 - level) * predictionSe(fit, x)
      // A sqrt-scale bound below 0 would square back up into a positive price.
      const floor = response.kind === 'sqrt' ? 0 : -Infinity
      return { fit: inv(p), lo: inv(Math.max(floor, p - half)), hi: inv(p + half) }
    },
  }
}

function crossValidate(
  rows: Row[],
  design: Design,
  folds: number,
  seed: number,
  inv: ((y: number) => number) | null,
): { cv: CvResult | null; oof: Map<number, number> } {
  const n = design.X.length
  const oof = new Map<number, number>()
  if (folds < 2 || n < folds * 5) return { cv: null, oof }
  const rand = rng(seed)
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const fold = new Array<number>(n)
  order.forEach((idx, pos) => (fold[idx] = pos % folds))

  const predTransformed = new Array<number | null>(n).fill(null)
  for (let k = 0; k < folds; k++) {
    const train = order.filter((i) => fold[i] !== k)
    let f: OlsFit
    try {
      f = ols(
        train.map((i) => design.X[i]),
        train.map((i) => design.y[i]),
        design.intercept,
      )
    } catch {
      continue
    }
    for (let i = 0; i < n; i++) if (fold[i] === k) predTransformed[i] = predictRow(f, design.X[i])
  }

  const ok = predTransformed.flatMap((p, i) => (p === null ? [] : [i]))
  if (!ok.length) return { cv: null, oof }
  const meanY = ok.reduce((a, i) => a + design.y[i], 0) / ok.length
  let ssRes = 0
  let ssTot = 0
  let absErr = 0
  let pctErr = 0
  let sqErr = 0
  for (const i of ok) {
    ssRes += (design.y[i] - predTransformed[i]!) ** 2
    ssTot += (design.y[i] - meanY) ** 2
    if (inv) {
      const actual = inv(design.y[i])
      const pred = inv(predTransformed[i]!)
      oof.set(rows[design.rows[i]].id, pred)
      absErr += Math.abs(pred - actual)
      sqErr += (pred - actual) ** 2
      pctErr += Math.abs(pred - actual) / Math.abs(actual)
    }
  }
  return {
    cv: {
      folds,
      n: ok.length,
      r2: 1 - ssRes / ssTot,
      mae: inv ? absErr / ok.length : null,
      mape: inv ? pctErr / ok.length : null,
      rmse: inv ? Math.sqrt(sqErr / ok.length) : null,
    },
    oof,
  }
}

/** Coefficients belonging to one categorical column, e.g. all seller_type[...] dummies. */
export function effectsOf(model: ModelResult, column: string): Coef[] {
  return model.coefs.filter((c) => c.parts.length === 1 && c.parts[0].varName === column && c.parts[0].level !== null)
}

/** Does the formula already contain `column` as a main effect? */
export function hasMainEffect(formula: Formula, column: string): boolean {
  return formula.terms.some((t) => t.factors.length === 1 && t.factors[0].varName === column)
}

/** A fitted model's scores, in the shape saved to the database. */
export function metricsOf(model: ModelResult): ModelMetrics {
  return {
    n: model.fit.n,
    k: model.fit.k,
    r2: model.fit.r2,
    adj_r2: model.fit.adjR2,
    sigma: model.fit.sigma,
    cv_folds: model.cv?.folds ?? null,
    cv_r2: model.cv?.r2 ?? null,
    cv_mae: model.cv?.mae ?? null,
    cv_mape: model.cv?.mape ?? null,
    cv_rmse: model.cv?.rmse ?? null,
  }
}
