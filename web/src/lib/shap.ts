/**
 * SHAP explanations of a single price, at the level of the inputs a person
 * recognises (year, mileage, trim, …) rather than the model's design columns.
 *
 * Interventional Shapley values: the value of a coalition S of inputs is the
 * average £ prediction when the car keeps its own values for S and takes the
 * other inputs from real background cars. Computed exactly over all 2^M
 * coalitions (M is small), or by permutation sampling if M is large. Because
 * it only calls the model's predict, it handles any formula: interactions,
 * transforms and the sqrt/log response alike.
 *
 * Efficiency holds by construction: base + Σ contributions = this car's price,
 * where base is the average prediction over the background cars.
 */
import type { ModelResult } from './model'
import { fieldColumns, type PriceField } from './pricer'
import { rng } from './stats'

export interface Contribution {
  /** the input, or inputs explained together (see groupDependent) */
  names: string[]
  /** £ this input adds to (or takes off) the price, relative to the base */
  phi: number
}

export interface Explanation {
  /** average prediction over the background cars (£) */
  base: number
  /** this car's prediction (£) = base + Σ phi */
  prediction: number
  contributions: Contribution[]
  method: 'exact' | 'sampled'
  background: number
}

type R = Record<string, unknown>

function factorial(n: number): number {
  let f = 1
  for (let i = 2; i <= n; i++) f *= i
  return f
}

export function explain(
  model: ModelResult,
  target: R,
  backgroundRows: R[],
  fields: PriceField[],
  opts: { maxExact?: number; maxEvals?: number; seed?: number; groups?: number[][] } = {},
): Explanation | null {
  // The "players": single inputs, or groups of near-duplicate inputs explained together.
  const players = opts.groups ?? fields.map((_, i) => [i])
  const M = players.length
  const columns = players.map((g) => g.flatMap((i) => fieldColumns(fields[i].name)))
  const f = (row: R) => model.predict(row as never)
  const prediction = f(target)
  if (prediction === null || M === 0) return null

  const maxEvals = opts.maxEvals ?? 60_000
  const rand = rng(opts.seed ?? 1)
  const exact = M <= (opts.maxExact ?? 10)
  // Background: a seeded random sample, sized so the whole computation stays bounded.
  const nBg = Math.max(20, Math.min(backgroundRows.length, Math.floor(maxEvals / (exact ? 2 ** M : 2 * M * 50))))
  const bg = [...backgroundRows]
  for (let i = bg.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[bg[i], bg[j]] = [bg[j], bg[i]]
  }
  const background = bg.slice(0, nBg).filter((b) => f(b) !== null)
  if (!background.length) return null

  // A car with its own values for inputs in `mask`, background values for the rest.
  const hybrid = (b: R, has: (i: number) => boolean): R => {
    const row: R = { ...target }
    for (let i = 0; i < M; i++) if (!has(i)) for (const c of columns[i]) row[c] = b[c]
    return row
  }
  const meanOver = (has: (i: number) => boolean) => {
    let sum = 0
    let n = 0
    for (const b of background) {
      const p = f(hybrid(b, has))
      if (p !== null) {
        sum += p
        n++
      }
    }
    return n ? sum / n : NaN
  }

  const phi = new Array<number>(M).fill(0)
  let base: number
  if (exact) {
    const v = new Array<number>(2 ** M)
    for (let mask = 0; mask < 2 ** M; mask++) v[mask] = meanOver((i) => (mask & (1 << i)) !== 0)
    const weight = (s: number) => (factorial(s) * factorial(M - s - 1)) / factorial(M)
    for (let i = 0; i < M; i++) {
      for (let mask = 0; mask < 2 ** M; mask++) {
        if (mask & (1 << i)) continue
        const size = popcount(mask)
        phi[i] += weight(size) * (v[mask | (1 << i)] - v[mask])
      }
    }
    base = v[0]
  } else {
    // Permutation sampling: add inputs in a random order against a random background car.
    const perms = Math.max(50, Math.floor(maxEvals / (M + 1)))
    let n = 0
    base = 0
    for (let p = 0; p < perms; p++) {
      const order = [...Array(M).keys()]
      for (let i = M - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[order[i], order[j]] = [order[j], order[i]]
      }
      const b = background[Math.floor(rand() * background.length)]
      const has = new Set<number>()
      let prev = f(hybrid(b, () => false))
      if (prev === null) continue
      base += prev
      n++
      for (const i of order) {
        has.add(i)
        const next = f(hybrid(b, (k) => has.has(k)))
        if (next === null) break
        phi[i] += next - prev
        prev = next
      }
    }
    for (let i = 0; i < M; i++) phi[i] /= n
    base /= n
    // Sampling noise: rescale so the contributions still add up to the prediction.
    const total = phi.reduce((a, x) => a + x, 0)
    const gap = prediction - base
    if (total !== 0) for (let i = 0; i < M; i++) phi[i] *= gap / total
  }

  return {
    base,
    prediction,
    contributions: players.map((g, i) => ({ names: g.map((k) => fields[k].name), phi: phi[i] })).sort((a, b) => Math.abs(b.phi) - Math.abs(a.phi)),
    method: exact ? 'exact' : 'sampled',
    background: background.length,
  }
}

function popcount(x: number): number {
  let c = 0
  while (x) {
    x &= x - 1
    c++
  }
  return c
}

/**
 * Group inputs where one nearly determines the other (e.g. MINI trim → engine
 * size), so SHAP explains them together. Explaining them apart would mean
 * imagining cars that barely exist (a Cooper with a 2.0 engine), which splits the
 * credit into large, offsetting and meaningless numbers.
 *
 * Measured with Theil's U, which is asymmetric: trim tells you the engine (0.89 on
 * the MINI data) even though the engine doesn't tell you the trim (a 2.0 could be
 * a Cooper S or a JCW). Numbers are binned into quintiles first.
 */
export function groupDependent(fields: PriceField[], rows: R[], threshold = 0.75): number[][] {
  const M = fields.length
  const codes = fields.map((f) => {
    const col = fieldColumns(f.name)[0]
    const vals = rows.map((r) => r[col])
    if (f.kind === 'number') {
      const xs = vals.map(Number).filter(Number.isFinite).sort((a, b) => a - b)
      const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => xs[Math.floor(q * (xs.length - 1))])
      return vals.map((v) => (v === null || v === undefined ? null : String(cuts.filter((c) => Number(v) > c).length)))
    }
    return vals.map((v) => (v === null || v === undefined ? null : String(v)))
  })
  const parent = [...Array(M).keys()]
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let a = 0; a < M; a++)
    for (let b = a + 1; b < M; b++)
      if (Math.max(theilsU(codes[a], codes[b]), theilsU(codes[b], codes[a])) >= threshold) parent[find(a)] = find(b)
  const groups = new Map<number, number[]>()
  for (let i = 0; i < M; i++) groups.set(find(i), [...(groups.get(find(i)) ?? []), i])
  return [...groups.values()]
}

function entropy(counts: Iterable<number>, n: number): number {
  let h = 0
  for (const c of counts) if (c > 0) h -= (c / n) * Math.log(c / n)
  return h
}

/** Theil's U(y | x): the share of y's uncertainty removed by knowing x (0 = none, 1 = x determines y). */
export function theilsU(y: (string | null)[], x: (string | null)[]): number {
  const byX = new Map<string, Map<string, number>>()
  const yCounts = new Map<string, number>()
  let n = 0
  for (let i = 0; i < y.length; i++) {
    const a = x[i]
    const b = y[i]
    if (a === null || b === null) continue
    const m = byX.get(a) ?? new Map<string, number>()
    m.set(b, (m.get(b) ?? 0) + 1)
    byX.set(a, m)
    yCounts.set(b, (yCounts.get(b) ?? 0) + 1)
    n++
  }
  const hy = entropy(yCounts.values(), n)
  if (!n || hy === 0) return 0
  let hyGivenX = 0
  for (const m of byX.values()) {
    const nx = [...m.values()].reduce((s, c) => s + c, 0)
    hyGivenX += (nx / n) * entropy(m.values(), nx)
  }
  return (hy - hyGivenX) / hy
}

export interface WhatIfPoint {
  /** the value(s) tried, as a label */
  label: string
  /** numeric inputs: the value tried (for a line chart) */
  x: number | null
  price: number
  current: boolean
}

/**
 * What if this car had a different value for one input (or one group of linked
 * inputs)? Numbers: a grid over the 2nd–98th percentile of the background cars.
 * Categories and groups: every combination seen in the background (so a "what if
 * it were a JCW" also gets a JCW's engine), most common first.
 */
export function whatIf(
  model: ModelResult,
  target: R,
  background: R[],
  fields: PriceField[],
  group: number[],
  refYear: number,
  label: (row: R) => string,
): WhatIfPoint[] {
  const cols = group.flatMap((i) => fieldColumns(fields[i].name))
  const predict = (overrides: R) => {
    const row: R = { ...target, ...overrides }
    if (typeof row.year === 'number' && cols.includes('year')) row.age = refYear - (row.year as number)
    return model.predict(row as never)
  }
  const single = group.length === 1 ? fields[group[0]] : null
  if (single && single.kind === 'number') {
    const col = cols[0]
    const xs = background.map((r) => Number(r[col])).filter(Number.isFinite).sort((a, b) => a - b)
    if (!xs.length) return []
    const lo = xs[Math.floor(xs.length * 0.02)]
    const hi = xs[Math.floor(xs.length * 0.98)]
    const own = Number(target[col])
    const grid = Array.from({ length: 41 }, (_, i) => lo + ((hi - lo) * i) / 40)
    if (Number.isFinite(own) && !grid.includes(own)) grid.push(own)
    return grid
      .sort((a, b) => a - b)
      .flatMap((x) => {
        const price = predict({ [col]: x })
        return price === null ? [] : [{ label: String(x), x, price, current: x === own }]
      })
  }
  // Observed combinations of the group's columns, most common first.
  const combos = new Map<string, { values: R; n: number }>()
  for (const r of background) {
    const values = Object.fromEntries(cols.filter((c) => c !== 'age').map((c) => [c, r[c]]))
    const key = JSON.stringify(values)
    const seen = combos.get(key)
    combos.set(key, { values, n: (seen?.n ?? 0) + 1 })
  }
  const ownKey = JSON.stringify(Object.fromEntries(cols.filter((c) => c !== 'age').map((c) => [c, target[c]])))
  const top = [...combos.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 14)
  // A single numeric category (e.g. C(year)) reads best in its natural order.
  const numericKey = (e: (typeof top)[number]) => Number(Object.values(e[1].values)[0])
  if (group.length === 1 && top.every((e) => Number.isFinite(numericKey(e)))) top.sort((a, b) => numericKey(a) - numericKey(b))
  return top
    .flatMap(([key, { values }]) => {
      const price = predict(values)
      return price === null ? [] : [{ label: label({ ...target, ...values }), x: null, price, current: key === ownKey }]
    })
}
