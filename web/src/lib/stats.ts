/** Small descriptive-statistics helpers. */

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5)
}

export interface Summary {
  n: number
  q1: number
  med: number
  q3: number
}

export function summarise(values: number[]): Summary {
  const s = [...values].sort((a, b) => a - b)
  return { n: s.length, q1: quantile(s, 0.25), med: quantile(s, 0.5), q3: quantile(s, 0.75) }
}

/** [lower whisker, Q1, median, Q3, upper whisker] with Tukey 1.5 x IQR whiskers. */
export function boxplot(values: number[]): [number, number, number, number, number] {
  const s = [...values].sort((a, b) => a - b)
  const q1 = quantile(s, 0.25)
  const q3 = quantile(s, 0.75)
  const fence = 1.5 * (q3 - q1)
  const lo = s.find((v) => v >= q1 - fence) ?? s[0]
  const hi = [...s].reverse().find((v) => v <= q3 + fence) ?? s[s.length - 1]
  return [lo, q1, quantile(s, 0.5), q3, hi]
}

export function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = out.get(k)
    if (list) list.push(item)
    else out.set(k, [item])
  }
  return out
}

/** Levels ordered by frequency, most common first. */
export function levelsByCount(values: (string | null | undefined)[]): string[] {
  const counts = new Map<string, number>()
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
}

/** Deterministic PRNG (mulberry32) so cross-validation folds are stable between renders. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
