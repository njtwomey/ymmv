/**
 * Search over model formulas, scored by cross-validated RMSE in £.
 *
 * The search is a local search with restarts (first-improvement hill climbing
 * plus "kicks"): start from the user's formula, try single changes (another
 * response, another way in for a number, a category in or out, an interaction
 * in or out) in random order and move to the first one that scores better.
 * When no single change helps, shake up the best formula so far with a few
 * random changes and climb again. Interactions are offered for every category
 * with age, mileage and engine size, and for every pair of categories.
 *
 * Benchmarked on the real data (10 splits, 60 s each) against the earlier
 * half-random, half-tweak search: no worse on the dashboard's default filters,
 * and about £25 (2%) lower held-out RMSE on all AutoTrader cars, where many more
 * features vary. A "simplest model within one SE" pick was worse in every case,
 * so the winner is simply the lowest CV RMSE.
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
import { exprVars, parseFormula } from './formula'
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
  { name: 'age', column: 'age', options: ['', 'age', 'age + I(age^2)', 'C(year)', 'O(year)'] },
  { name: 'mileage', column: 'mileage', options: ['', 'mileage', 'log1p(mileage)', 'sqrt(mileage)', 'mileage + log1p(mileage)'] },
  { name: 'engine', column: 'engine_l', options: ['', 'engine_l', 'C(engine_l)', 'O(engine_l)'] },
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

/**
 * Interactions only enter when both parents are in the model. These few come
 * first in formulas; `prepare` adds every category with age, mileage and engine
 * size, and every pair of categories.
 */
const CURATED = [
  'trim:age',
  'trim:log1p(mileage)',
  'age:log1p(mileage)',
  'transmission:age',
  'seller_type:age',
  'fuel:age',
  'trim:transmission',
  'C(engine_l):age',
  'O(engine_l):age',
]
const PARTNERS = [
  { term: 'age', slot: 'age' },
  { term: 'log1p(mileage)', slot: 'mileage' },
  { term: 'engine_l', slot: 'engine' },
]

/** The slot or category each column belongs to, for working out an interaction's parents. */
const OWNER: Record<string, string> = {
  year: 'age',
  ...Object.fromEntries(SLOTS.map((s) => [s.column, s.name])),
  local: 'distance',
  ...Object.fromEntries(CATEGORIES.flatMap((c) => [[c.column, c.name], [c.name, c.name]])),
}

const termKey = (term: string) => parseFormula(`y ~ ${term}`).terms[0].key
const needsCache = new Map<string, string[]>()
/** The slots and categories an interaction needs, e.g. trim:log1p(mileage) → trim, mileage. */
function needsOf(term: string): string[] {
  let needs = needsCache.get(term)
  if (!needs) {
    const vars = parseFormula(`y ~ ${term}`).terms[0].factors.flatMap((f) => [...exprVars(f.expr)])
    needs = [...new Set(vars.map((v) => OWNER[v] ?? v))]
    needsCache.set(term, needs)
  }
  return needs
}

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
  /** interactions whose parents can both be in a model */
  interactions: string[]
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
  const names = cats.map((c) => c.name)
  const available = new Set([...slots.map((s) => s.name), ...names])
  const generated = [
    ...names.flatMap((c) => PARTNERS.map((x) => `${c}:${x.term}`)),
    ...names.flatMap((a, i) => names.slice(i + 1).map((b) => `${a}:${b}`)),
    'engine_l:age',
  ]
  const keys = new Set<string>()
  const interactions = [...CURATED, ...generated].filter((t) => {
    const key = termKey(t)
    if (keys.has(key) || !needsOf(t).every((n) => available.has(n))) return false
    keys.add(key)
    return true
  })
  return {
    test: shuffled.slice(0, nTest),
    train: shuffled.slice(nTest),
    slots,
    categories: names,
    interactions,
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

const presentOf = (c: Candidate) => new Set([...Object.entries(c.slots).filter(([, v]) => v).map(([k]) => k), ...c.cats])
const interRank = (t: string) => (CURATED.includes(t) ? CURATED.indexOf(t) : CURATED.length)

/** Terms in a fixed order, so the same model always gives the same formula (and is only scored once). */
export function toFormula(c: Candidate): string {
  const present = presentOf(c)
  const slots = SLOTS.map((s) => c.slots[s.name]).filter(Boolean)
  const cats = CATEGORIES.map((x) => x.name).filter((name) => c.cats.includes(name))
  const inter = [...new Set(c.inter)]
    .filter((t) => needsOf(t).every((n) => present.has(n)))
    .sort((a, b) => interRank(a) - interRank(b) || a.localeCompare(b))
  const terms = [...slots, ...cats, ...inter]
  return `${c.response} ~ ${terms.join(' + ') || '1'}`
}

/** Drop interactions whose parents have gone, so a candidate is exactly its formula. */
function normalise(c: Candidate): Candidate {
  const present = presentOf(c)
  return { ...c, inter: c.inter.filter((t) => needsOf(t).every((n) => present.has(n))) }
}

const pick = <T,>(xs: T[], rand: () => number): T => xs[Math.floor(rand() * xs.length)]

export function randomCandidate(p: Prepared, rand: () => number, interactions: boolean): Candidate {
  const slots = Object.fromEntries(p.slots.map((s) => [s.name, pick(s.options, rand)]))
  const cats = p.categories.filter(() => rand() < 0.5)
  const present = new Set([...Object.entries(slots).filter(([, v]) => v).map(([k]) => k), ...cats])
  const possible = p.interactions.filter((t) => needsOf(t).every((n) => present.has(n)))
  const nInter = interactions ? Math.floor(rand() * 3) : 0
  return { response: pick(RESPONSES, rand), slots, cats, inter: shuffle(possible, rand).slice(0, nInter) }
}

/** A few random changes to a candidate: a kick away from a local optimum. */
export function mutate(c: Candidate, p: Prepared, rand: () => number, interactions: boolean, changes = 1 + Math.floor(rand() * 2)): Candidate {
  const next: Candidate = { response: c.response, slots: { ...c.slots }, cats: [...c.cats], inter: [...c.inter] }
  for (let n = 0; n < changes; n++) {
    const kind = rand()
    if (kind < 0.15) next.response = pick(RESPONSES, rand)
    else if (kind < 0.55 && p.slots.length) {
      const s = pick(p.slots, rand)
      next.slots[s.name] = pick(s.options, rand)
    } else if (kind < 0.85 && p.categories.length) {
      const cat = pick(p.categories, rand)
      next.cats = next.cats.includes(cat) ? next.cats.filter((x) => x !== cat) : [...next.cats, cat]
    } else if (interactions && p.interactions.length) {
      const t = pick(p.interactions, rand)
      next.inter = next.inter.includes(t) ? next.inter.filter((x) => x !== t) : [...next.inter, t]
    }
  }
  return normalise(next)
}

/** Every single change to a candidate: the neighbourhood the hill climb tries. */
export function neighbours(c: Candidate, p: Prepared, interactions: boolean): Candidate[] {
  const out: Candidate[] = []
  for (const r of RESPONSES) if (r !== c.response) out.push({ ...c, response: r })
  for (const s of p.slots) for (const o of s.options) if (o !== (c.slots[s.name] ?? '')) out.push(normalise({ ...c, slots: { ...c.slots, [s.name]: o } }))
  for (const cat of p.categories)
    out.push(normalise({ ...c, cats: c.cats.includes(cat) ? c.cats.filter((x) => x !== cat) : [...c.cats, cat] }))
  if (interactions) {
    const present = presentOf(c)
    for (const t of p.interactions)
      if (needsOf(t).every((n) => present.has(n)))
        out.push({ ...c, inter: c.inter.includes(t) ? c.inter.filter((x) => x !== t) : [...c.inter, t] })
  }
  return out
}

/** A formula as a candidate, so the search can climb from it; null if the search can't express it. */
export function candidateOf(formula: string, p: Prepared): Candidate | null {
  try {
    const f = parseFormula(formula)
    const keys = new Set(f.terms.map((t) => t.key))
    const termKeys = (text: string) => (text ? parseFormula(`y ~ ${text}`).terms.map((t) => t.key) : [])
    const slots: Record<string, string> = {}
    for (const s of p.slots) {
      // Longest first, so `age + I(age^2)` wins over `age`.
      const options = [...s.options].sort((a, b) => termKeys(b).length - termKeys(a).length)
      const hit = options.find((o) => termKeys(o).every((k) => keys.has(k))) ?? ''
      slots[s.name] = hit
      for (const k of termKeys(hit)) keys.delete(k)
    }
    const cats = p.categories.filter((c) => keys.delete(termKey(c)))
    const inter = p.interactions.filter((t) => keys.delete(termKey(t)))
    if (keys.size || !RESPONSES.includes(f.responseText) || !f.intercept) return null
    return { response: f.responseText, slots, cats, inter }
  } catch {
    return null
  }
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
  private readonly seen = new Map<string, number | null>()
  private readonly rand: () => number
  private readonly start = Date.now()
  private queue: string[]
  private readonly settings: SearchSettings
  /** where the climb is, the best candidate so far, and the current one's untried neighbours */
  private current: { c: Candidate; rmse: number } | null = null
  private top: { c: Candidate; rmse: number } | null = null
  private pending: Candidate[] | null = null

  /** `seeds`: formulas to try first, e.g. the user's current model; the best of them is where the climb starts. */
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

  /** Score a candidate (once; repeats are free) and say what it got. */
  private score(c: Candidate): { trial: Trial | null; rmse: number | null } {
    const formula = toFormula(c)
    const trial = this.evaluate(formula)
    return { trial, rmse: this.seen.get(formula) ?? null }
  }

  private moveTo(c: Candidate, rmse: number) {
    this.current = { c, rmse }
    this.pending = null
    if (!this.top || rmse < this.top.rmse) this.top = { c, rmse }
  }

  /** Try one more formula: a seed, the next single change, or a kick when no change helps. */
  step(): Trial | null {
    const p = this.prepared
    const { interactions } = this.settings
    const seed = this.queue.shift()
    if (seed !== undefined) {
      const trial = this.evaluate(seed)
      const rmse = this.seen.get(seed) ?? null
      const c = candidateOf(seed, p)
      if (c && rmse !== null && (!this.current || rmse < this.current.rmse)) this.moveTo(c, rmse)
      return trial
    }
    if (!this.current) {
      // No usable seed: start from a random formula.
      const c = randomCandidate(p, this.rand, interactions)
      const { trial, rmse } = this.score(c)
      if (rmse !== null) this.moveTo(c, rmse)
      return trial
    }
    this.pending ??= shuffle(neighbours(this.current.c, p, interactions), this.rand)
    const next = this.pending.pop()
    if (next) {
      const { trial, rmse } = this.score(next)
      if (rmse !== null && rmse < this.current.rmse) this.moveTo(next, rmse) // first improvement
      return trial
    }
    // A local optimum: no single change helps. Kick the best so far and climb from there.
    const kicked = mutate(this.top!.c, p, this.rand, interactions, 3 + Math.floor(this.rand() * 3))
    const { trial, rmse } = this.score(kicked)
    if (rmse !== null) this.moveTo(kicked, rmse)
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
