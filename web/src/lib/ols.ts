/** Ordinary least squares with standard errors, plus the t distribution it needs. */
import { Matrix, QrDecomposition, inverse } from 'ml-matrix'

export interface OlsFit {
  /** one entry per design column; NaN for columns dropped as collinear */
  beta: number[]
  se: number[]
  kept: boolean[]
  /** columns that were all zero in the fitted data, e.g. a category level never seen */
  unseen: boolean[]
  n: number
  /** number of estimated coefficients */
  k: number
  df: number
  sigma: number
  r2: number
  adjR2: number
  /** design-column index of each kept column */
  keptIndex: number[]
  /** coefficient covariance for the kept columns, in `keptIndex` order (original scale) */
  cov: number[][]
}

/**
 * Which columns to keep: modified Gram-Schmidt in column order, dropping any
 * column that is (numerically) a combination of earlier ones, as R's lm does.
 */
function independentColumns(cols: number[][], tol = 1e-9): boolean[] {
  const basis: number[][] = []
  return cols.map((col) => {
    const norm0 = Math.hypot(...col)
    if (norm0 === 0) return false
    const v = [...col]
    for (const q of basis) {
      let dot = 0
      for (let i = 0; i < v.length; i++) dot += q[i] * v[i]
      for (let i = 0; i < v.length; i++) v[i] -= dot * q[i]
    }
    const norm = Math.hypot(...v)
    if (norm <= tol * norm0 || norm < 1e-12) return false
    basis.push(v.map((x) => x / norm))
    return true
  })
}

export function ols(X: number[][], y: number[], hasIntercept: boolean): OlsFit {
  const n = X.length
  const p = X[0]?.length ?? 0
  if (n === 0 || p === 0) throw new Error('Nothing to fit: no rows or no columns')
  const cols = Array.from({ length: p }, (_, j) => X.map((r) => r[j]))
  const kept = independentColumns(cols)
  const unseen = cols.map((c) => c.every((v) => v === 0))
  const keptIndex = kept.flatMap((k, j) => (k ? [j] : []))
  const k = keptIndex.length
  if (n <= k) throw new Error(`Too few rows (${n}) for ${k} coefficients`)

  // Scale columns to unit norm for conditioning; undo afterwards.
  const scale = keptIndex.map((j) => Math.hypot(...cols[j]))
  const Xs = new Matrix(n, k)
  for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) Xs.set(i, c, X[i][keptIndex[c]] / scale[c])
  const Y = Matrix.columnVector(y)
  const qr = new QrDecomposition(Xs)
  const bs = qr.solve(Y).getColumn(0)

  const fitted = Xs.mmul(Matrix.columnVector(bs)).getColumn(0)
  let rss = 0
  for (let i = 0; i < n; i++) rss += (y[i] - fitted[i]) ** 2
  const meanY = y.reduce((a, b) => a + b, 0) / n
  const tss = y.reduce((a, b) => a + (hasIntercept ? (b - meanY) ** 2 : b * b), 0)
  const df = n - k
  const sigma2 = rss / df
  const R = qr.upperTriangularMatrix.subMatrix(0, k - 1, 0, k - 1)
  const Rinv = inverse(R)
  const cov = Rinv.mmul(Rinv.transpose()).mul(sigma2)

  const beta = new Array<number>(p).fill(NaN)
  const se = new Array<number>(p).fill(NaN)
  keptIndex.forEach((j, c) => {
    beta[j] = bs[c] / scale[c]
    se[j] = Math.sqrt(cov.get(c, c)) / scale[c]
  })
  const covOrig = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, c) => cov.get(a, c) / (scale[a] * scale[c])))
  const r2 = tss > 0 ? 1 - rss / tss : NaN
  return {
    beta,
    se,
    kept,
    unseen,
    n,
    k,
    df,
    sigma: Math.sqrt(sigma2),
    r2,
    adjR2: 1 - ((1 - r2) * (n - (hasIntercept ? 1 : 0))) / Math.max(df, 1),
    keptIndex,
    cov: covOrig,
  }
}

/** Standard error of a new observation's prediction at x: sqrt(sigma² + x'Σx). */
export function predictionSe(fit: OlsFit, x: number[]): number {
  const xs = fit.keptIndex.map((j) => x[j])
  let v = 0
  for (let a = 0; a < xs.length; a++) for (let c = 0; c < xs.length; c++) v += xs[a] * fit.cov[a][c] * xs[c]
  return Math.sqrt(fit.sigma ** 2 + v)
}

/**
 * x·beta, as R's predict.lm does for rank-deficient fits: a column dropped as a
 * linear combination of others contributes 0, which reproduces the fitted values.
 * Null only when the row needs a column that was all zero in the fitted data
 * (a category level the fit never saw), since nothing was learnt about it.
 */
export function predictRow(fit: OlsFit, x: number[]): number | null {
  let s = 0
  for (let j = 0; j < x.length; j++) {
    if (fit.kept[j]) s += x[j] * fit.beta[j]
    else if (fit.unseen[j] && x[j] !== 0) return null
  }
  return s
}

// ------------------------------------------------------------------ t distribution
/** ln Γ(x) for x > 0: shift up to x ≥ 7, then Stirling's series (error < 1e-10). */
function logGamma(x: number): number {
  let shift = 0
  while (x < 7) {
    shift += Math.log(x)
    x += 1
  }
  const x2 = x * x
  const series = 1 / (12 * x) - 1 / (360 * x * x2) + 1 / (1260 * x * x2 * x2) - 1 / (1680 * x * x2 * x2 * x2)
  return (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) + series - shift
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300
  const EPS = 3e-14
  const FPMIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** Regularised incomplete beta I_x(a, b). */
export function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b
}

/** Two-sided p-value for a t statistic. */
export function tPValue(t: number, df: number): number {
  if (!Number.isFinite(t)) return NaN
  return incBeta(df / (df + t * t), df / 2, 0.5)
}

/** Critical value t such that P(|T| > t) = alpha. */
export function tCritical(df: number, alpha = 0.05): number {
  let lo = 0
  let hi = 1000
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (tPValue(mid, df) > alpha) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
