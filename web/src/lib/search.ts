/**
 * Randomised search over model formulas, scored by cross-validated RMSE in £.
 *
 * Done carefully, because a search like this happily fools itself:
 *  - A held-out test set is split off (randomly, seeded) before searching and only
 *    used once at the end. The winner's CV score is optimistic by construction
 *    (it's the best of many), so the test RMSE is the honest number.
 *  - Every candidate is scored on the same cars. Features that are mostly missing
 *    are left out of the search, and the data is restricted to cars complete on
 *    the rest; otherwise formulas silently drop different rows and their scores
 *    aren't comparable.
 *  - Features that leak the label are never offered (AutoTrader's rating is
 *    computed from the asking price; "sold" is only known afterwards).
 *  - Scores are on the price scale, so log / sqrt / raw responses compete fairly.
 *  - One seed drives the split, the CV folds and the search, so runs reproduce.
 */
import { fitModel } from './model'
import { rng } from './stats'
import type { Row } from './types'

export interface SearchSettings {
  folds: number
  seed: number
  /** share of the cars held out as the final test set */
  testFrac: number
  interactions: boolean
}

export const DEFAULT_SEARCH: SearchSettings = { folds: 5, seed: 1, testFrac: 0.2, interactions: true }

const RESPONSES = ['log(price)', 'sqrt(price)', 'price']

/** Numeric slots: pick one way in (or leave out). `column` is what must be present. */
const SLOTS = [
  { name: 'age', column: 'age', options: ['', 'age', 'age + I(age^2)', 'C(year)'] },
  { name: 'mileage', column: 'mileage', options: ['', 'mileage', 'log1p(mileage)', 'sqrt(mileage)', 'mileage + log1p(mileage)'] },
  { name: 'engine', column: 'engine_l', options: ['', 'engine_l', 'C(engine_l)'] },
  { name: 'distance', column: 'distance_miles', options: ['', 'local', 'log1p(distance_miles)'] },
]

/** Categorical features: in or out. */
const CATEGORIES = [
  { name: 'trim', column: 'trim_label' },
  { name: 'fuel', column: 'fuel' },
  { name: 'transmission', column: 'transmission' },
  { name: 'seller_type', column: 'seller_type' },
  { name: 'writeoff', column: 'writeoff_label' },
  { name: 'source', column: 'source' },
  { name: 'colour', column: 'colour' },
  { name: 'body_type', column: 'body_type' },
  { name: 'condition', column: 'condition' },
]

/** Interactions only enter when both parents are in the model. */
const INTERACTIONS = [
  { term: 'trim:age', needs: ['trim', 'age'] },
  { term: 'trim:log1p(mileage)', needs: ['trim', 'mileage'] },
  { term: 'age:log1p(mileage)', needs: ['age', 'mileage'] },
  { term: 'transmission:age', needs: ['transmission', 'age'] },
  { term: 'seller_type:age', needs: ['seller_type', 'age'] },
  { term: 'fuel:age', needs: ['fuel', 'age'] },
  { term: 'trim:transmission', needs: ['trim', 'transmission'] },
  { term: 'C(engine_l):age', needs: ['engine', 'age'] },
]

/** Never offered, and why. */
export const LEAKY = [
  { name: 'rating', reason: 'AutoTrader computes it from the asking price (label leakage)' },
  { name: 'state', reason: 'sold/for sale is only known after the advert ends' },
  { name: 'is_writeoff', reason: 'duplicates writeoff' },
]

const MAX_MISSING = 0.02

export interface Prepared {
  train: Row[]
  test: Row[]
  slots: typeof SLOTS
  categories: string[]
  excluded: { name: string; reason: string }[]
  /** priced cars dropped for missing values in the searchable features */
  dropped: number
}

const value = (r: Row, column: string) => (r as unknown as Record<string, unknown>)[column]
const missing = (v: unknown) => v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function prepare(rows: Row[], settings: SearchSettings): Prepared {
  const priced = rows.filter((r) => r.price_gbp !== null && r.price_gbp > 0)
  const excluded = [...LEAKY]
  const usable = (name: string, column: string) => {
    const vals = priced.map((r) => value(r, column))
    const share = vals.filter(missing).length / Math.max(priced.length, 1)
    if (share > MAX_MISSING) {
      excluded.push({ name, reason: `${Math.round(share * 100)}% missing` })
      return false
    }
    if (new Set(vals.filter((v) => !missing(v)).map(String)).size < 2) {
      excluded.push({ name, reason: 'doesn’t vary in the filtered data' })
      return false
    }
    return true
  }
  const slots = SLOTS.filter((s) => usable(s.name, s.column))
  const cats = CATEGORIES.filter((c) => usable(c.name, c.column))
  const needed = [...slots.map((s) => s.column), ...cats.map((c) => c.column)]
  if (slots.some((s) => s.name === 'age')) needed.push('year')
  const complete = priced.filter((r) => needed.every((c) => !missing(value(r, c))))
  const shuffled = shuffle(complete, rng(settings.seed))
  const nTest = Math.round(shuffled.length * settings.testFrac)
  return {
    test: shuffled.slice(0, nTest),
    train: shuffled.slice(nTest),
    slots,
    categories: cats.map((c) => c.name),
    excluded,
    dropped: priced.length - complete.length,
  }
}

// ------------------------------------------------------------------ candidates
export interface Candidate {
  response: string
  slots: Record<string, string>
  cats: string[]
  inter: string[]
}

/** Terms in a fixed order, so the same model always gives the same formula (and is only scored once). */
export function toFormula(c: Candidate): string {
  const present = new Set([...Object.entries(c.slots).filter(([, v]) => v).map(([k]) => k), ...c.cats])
  const slots = SLOTS.map((s) => c.slots[s.name]).filter(Boolean)
  const cats = CATEGORIES.map((x) => x.name).filter((name) => c.cats.includes(name))
  const inter = INTERACTIONS.filter((i) => c.inter.includes(i.term) && i.needs.every((n) => present.has(n))).map((i) => i.term)
  const terms = [...slots, ...cats, ...inter]
  return `${c.response} ~ ${terms.join(' + ') || '1'}`
}

const pick = <T,>(xs: T[], rand: () => number): T => xs[Math.floor(rand() * xs.length)]

export function randomCandidate(p: Prepared, rand: () => number, interactions: boolean): Candidate {
  const slots = Object.fromEntries(p.slots.map((s) => [s.name, pick(s.options, rand)]))
  const cats = p.categories.filter(() => rand() < 0.5)
  const present = new Set([...Object.entries(slots).filter(([, v]) => v).map(([k]) => k), ...cats])
  const possible = INTERACTIONS.filter((i) => i.needs.every((n) => present.has(n))).map((i) => i.term)
  const nInter = interactions ? Math.floor(rand() * 3) : 0
  return { response: pick(RESPONSES, rand), slots, cats, inter: shuffle(possible, rand).slice(0, nInter) }
}

/** One or two small changes to a candidate: the "local" half of the search. */
export function mutate(c: Candidate, p: Prepared, rand: () => number, interactions: boolean): Candidate {
  const next: Candidate = { response: c.response, slots: { ...c.slots }, cats: [...c.cats], inter: [...c.inter] }
  const changes = 1 + Math.floor(rand() * 2)
  for (let n = 0; n < changes; n++) {
    const kind = rand()
    if (kind < 0.15) next.response = pick(RESPONSES, rand)
    else if (kind < 0.55 && p.slots.length) {
      const s = pick(p.slots, rand)
      next.slots[s.name] = pick(s.options, rand)
    } else if (kind < 0.85 && p.categories.length) {
      const cat = pick(p.categories, rand)
      next.cats = next.cats.includes(cat) ? next.cats.filter((x) => x !== cat) : [...next.cats, cat]
    } else if (interactions) {
      const t = pick(INTERACTIONS, rand).term
      next.inter = next.inter.includes(t) ? next.inter.filter((x) => x !== t) : [...next.inter, t]
    }
  }
  return next
}

// ------------------------------------------------------------------ the search
export interface Trial {
  /** ms since the search started */
  t: number
  formula: string
  k: number
  rmse: number
  /** whether this trial was the best so far when it ran */
  improved: boolean
}

export interface TestScore {
  label: string
  formula: string
  rmse: number | null
  n: number
}

export function testRmse(train: Row[], test: Row[], formula: string, label: string): TestScore {
  try {
    const m = fitModel(train, formula, { folds: 0 })
    let sq = 0
    let n = 0
    for (const r of test) {
      const p = m.predict(r)
      if (p === null || r.price_gbp === null) continue
      sq += (p - r.price_gbp) ** 2
      n++
    }
    return { label, formula, rmse: n ? Math.sqrt(sq / n) : null, n }
  } catch {
    return { label, formula, rmse: null, n: 0 }
  }
}

/** The "know nothing" baseline: predict the training mean for every car. */
export function meanBaseline(train: Row[], test: Row[]): TestScore {
  const mean = train.reduce((a, r) => a + r.price_gbp!, 0) / train.length
  const rmse = Math.sqrt(test.reduce((a, r) => a + (r.price_gbp! - mean) ** 2, 0) / test.length)
  return { label: 'Mean price (no model)', formula: '—', rmse, n: test.length }
}

export class Search {
  readonly prepared: Prepared
  readonly trials: Trial[] = []
  best: Trial | null = null
  private bestCandidate: Candidate | null = null
  private readonly seen = new Map<string, number | null>()
  private readonly rand: () => number
  private readonly start = Date.now()
  private queue: string[]
  private readonly settings: SearchSettings

  /** `seeds`: formulas to try first, e.g. the user's current model. */
  constructor(rows: Row[], settings: SearchSettings, seeds: string[] = []) {
    this.settings = settings
    this.prepared = prepare(rows, settings)
    this.rand = rng(settings.seed + 1)
    this.queue = [...seeds]
  }

  private evaluate(formula: string): Trial | null {
    if (this.seen.has(formula)) return null
    let rmse: number | null = null
    let k = 0
    try {
      const m = fitModel(this.prepared.train, formula, { folds: this.settings.folds, seed: this.settings.seed })
      // Comparable only if (nearly) every training car was scored.
      if (m.cv?.rmse != null && m.cv.n >= 0.98 * this.prepared.train.length) {
        rmse = m.cv.rmse
        k = m.fit.k
      }
    } catch {
      /* invalid for this data: skip */
    }
    this.seen.set(formula, rmse)
    if (rmse === null) return null
    const improved = !this.best || rmse < this.best.rmse
    const trial = { t: Date.now() - this.start, formula, k, rmse, improved }
    this.trials.push(trial)
    if (improved) this.best = trial
    return trial
  }

  /** Try one more candidate (half random exploration, half tweaks of the best). */
  step(): Trial | null {
    const seed = this.queue.shift()
    if (seed) return this.evaluate(seed)
    const { interactions } = this.settings
    const explore = !this.bestCandidate || this.rand() < 0.5
    const cand = explore
      ? randomCandidate(this.prepared, this.rand, interactions)
      : mutate(this.bestCandidate!, this.prepared, this.rand, interactions)
    const trial = this.evaluate(toFormula(cand))
    if (trial?.improved) this.bestCandidate = cand
    return trial
  }

  get tried(): number {
    return this.seen.size
  }

  leaderboard(n = 10): Trial[] {
    return [...this.trials].sort((a, b) => a.rmse - b.rmse).slice(0, n)
  }

  /** Score the winner (and the references) once on the untouched test set. */
  finish(current: string | null): TestScore[] {
    const { train, test } = this.prepared
    const out: TestScore[] = []
    if (this.best) out.push(testRmse(train, test, this.best.formula, 'Search winner'))
    if (current) out.push(testRmse(train, test, current, 'Your current model'))
    if (test.length) out.push(meanBaseline(train, test))
    return out
  }
}
