/** Dashboard filters: defaults, URL (de)serialisation and application to rows. */
import { DEFAULT_FORMULA } from './config'
import type { MarkValue, Row } from './types'

export interface Filters {
  sources: string[]
  trims: string[]
  fuels: string[]
  transmissions: string[]
  sellers: string[]
  yearMin: number | null
  yearMax: number | null
  maxMileage: number | null
  priceMin: number | null
  priceMax: number | null
  withinMiles: number | null
  status: 'all' | 'active' | 'delisted'
  reserved: boolean
  marked: 'all' | 'any' | MarkValue
  writeoffs: 'include' | 'exclude' | 'only'
  q: string
  radius: number
  place: string
}

/** No restrictions at all ("Show all"). */
export const NO_FILTERS: Filters = {
  sources: [],
  trims: [],
  fuels: [],
  transmissions: [],
  sellers: [],
  yearMin: null,
  yearMax: null,
  maxMileage: null,
  priceMin: null,
  priceMax: null,
  withinMiles: null,
  status: 'all',
  reserved: false,
  marked: 'all',
  writeoffs: 'include',
  q: '',
  radius: 30,
  place: 'Bristol',
}

/** What the dashboard opens with ("Reset"): petrol manuals from 2016 on, no write-offs. */
export const DEFAULT_FILTERS: Filters = {
  ...NO_FILTERS,
  fuels: ['Petrol'],
  transmissions: ['Manual'],
  sellers: [], // trade + private
  yearMin: 2016,
  writeoffs: 'exclude',
}

export type Tab = 'overview' | 'depreciation' | 'contrasts' | 'model' | 'listings' | 'sources'
export const TABS: Tab[] = ['overview', 'depreciation', 'contrasts', 'model', 'listings', 'sources']

export interface ViewState {
  car: string | null
  tab: Tab
  filters: Filters
  formula: string
  folds: number
  /** standardise numeric features (coefficients per 1 SD) */
  standardise: boolean
}

const LIST_KEYS = ['sources', 'trims', 'fuels', 'transmissions', 'sellers'] as const
const NUM_KEYS = ['yearMin', 'yearMax', 'maxMileage', 'priceMin', 'priceMax', 'withinMiles', 'radius'] as const

const MODEL_KEY = 'ymmv.model'

interface ModelConfig {
  formula: string
  folds: number
  standardise: boolean
}

function storedModel(): ModelConfig {
  const fallback = { formula: DEFAULT_FORMULA, folds: 5, standardise: true }
  try {
    const v = JSON.parse(localStorage.getItem(MODEL_KEY) ?? '{}') as Partial<ModelConfig>
    return { formula: v.formula || fallback.formula, folds: v.folds || fallback.folds, standardise: v.standardise ?? true }
  } catch {
    return fallback
  }
}

export function saveModel({ formula, folds, standardise }: ModelConfig) {
  try {
    // Store '' for the default, so a later change of default reaches this browser too.
    localStorage.setItem(MODEL_KEY, JSON.stringify({ formula: formula === DEFAULT_FORMULA ? '' : formula, folds, standardise }))
  } catch {
    /* storage unavailable */
  }
}

export function readView(search: string): ViewState {
  const p = new URLSearchParams(search)
  const f: Filters = { ...DEFAULT_FILTERS }
  // The URL only holds differences from DEFAULT_FILTERS; an empty value means "cleared".
  for (const k of LIST_KEYS) if (p.has(k)) f[k] = p.get(k)!.split(',').filter(Boolean)
  for (const k of NUM_KEYS) {
    const v = p.get(k)
    if (v === '' && k !== 'radius') (f[k] as number | null) = null
    else if (v !== null && v !== '' && Number.isFinite(Number(v))) (f[k] as number | null) = Number(v)
  }
  const status = p.get('status')
  if (status === 'active' || status === 'delisted') f.status = status
  f.reserved = p.get('reserved') === '1'
  const marked = p.get('marked')
  if (marked === 'any' || marked === 'interesting' || marked === 'want_more' || marked === 'contacted' || marked === 'rejected')
    f.marked = marked
  const wo = p.get('writeoffs')
  if (wo === 'include' || wo === 'exclude' || wo === 'only') f.writeoffs = wo
  f.q = p.get('q') ?? ''
  f.place = p.get('place') || DEFAULT_FILTERS.place
  const tab = p.get('tab') as Tab
  const model = storedModel()
  return {
    car: p.get('car'),
    tab: TABS.includes(tab) ? tab : 'overview',
    filters: f,
    formula: p.get('formula') || model.formula,
    folds: Number(p.get('folds')) || model.folds,
    standardise: p.has('std') ? p.get('std') !== '0' : model.standardise,
  }
}

export function writeView(v: ViewState): string {
  const p = new URLSearchParams()
  if (v.car) p.set('car', v.car)
  if (v.tab !== 'overview') p.set('tab', v.tab)
  const f = v.filters
  const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
  for (const k of LIST_KEYS) if (!sameList(f[k], DEFAULT_FILTERS[k])) p.set(k, f[k].join(','))
  for (const k of NUM_KEYS) if (f[k] !== DEFAULT_FILTERS[k]) p.set(k, f[k] === null ? '' : String(f[k]))
  if (f.status !== 'all') p.set('status', f.status)
  if (f.reserved) p.set('reserved', '1')
  if (f.marked !== 'all') p.set('marked', f.marked)
  if (f.writeoffs !== DEFAULT_FILTERS.writeoffs) p.set('writeoffs', f.writeoffs)
  if (f.q) p.set('q', f.q)
  if (f.place !== DEFAULT_FILTERS.place) p.set('place', f.place)
  if (v.formula !== DEFAULT_FORMULA) p.set('formula', v.formula)
  if (v.folds !== 5) p.set('folds', String(v.folds))
  if (!v.standardise) p.set('std', '0')
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function activeFilterCount(f: Filters): number {
  let n = 0
  for (const k of LIST_KEYS) if (f[k].length) n++
  for (const k of ['yearMin', 'yearMax', 'maxMileage', 'priceMin', 'priceMax', 'withinMiles'] as const) if (f[k] !== null) n++
  if (f.status !== 'all') n++
  if (f.reserved) n++
  if (f.marked !== 'all') n++
  if (f.writeoffs !== 'include') n++
  if (f.q) n++
  return n
}

export function applyFilters(rows: Row[], f: Filters): Row[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean)
  const inList = (list: string[], v: string | null) => list.length === 0 || (v !== null && list.includes(v))
  const inRange = (v: number | null, lo: number | null, hi: number | null) =>
    (lo === null || (v !== null && v >= lo)) && (hi === null || (v !== null && v <= hi))
  return rows.filter((r) => {
    if (!inList(f.sources, r.source)) return false
    if (!inList(f.trims, r.trim_label)) return false
    if (!inList(f.fuels, r.fuel)) return false
    if (!inList(f.transmissions, r.transmission)) return false
    if (!inList(f.sellers, r.seller_type)) return false
    if (!inRange(r.year, f.yearMin, f.yearMax)) return false
    if (!inRange(r.mileage, null, f.maxMileage)) return false
    if (!inRange(r.distance_miles, null, f.withinMiles)) return false
    if (r.price_gbp === null) {
      if (!f.reserved) return false
    } else if (!inRange(r.price_gbp, f.priceMin, f.priceMax)) return false
    if (f.status !== 'all' && r.status !== f.status) return false
    if (f.writeoffs === 'exclude' && r.writeoff) return false
    if (f.writeoffs === 'only' && !r.writeoff) return false
    if (f.marked === 'any' && !r.mark) return false
    if (f.marked !== 'all' && f.marked !== 'any' && r.mark !== f.marked) return false
    if (words.length) {
      // Every word must appear somewhere: "jcw bristol", "cooper s auto"…
      const hay = [r.variant, r.trim_label, r.location, r.plate, r.colour, r.title, r.writeoff].filter(Boolean).join(' ').toLowerCase()
      if (!words.every((w) => hay.includes(w))) return false
    }
    return true
  })
}

export interface FilterOptions {
  sources: { value: string; count: number }[]
  trims: { value: string; count: number }[]
  fuels: { value: string; count: number }[]
  transmissions: { value: string; count: number }[]
  sellers: { value: string; count: number }[]
  years: [number, number]
}

function counts(rows: Row[], get: (r: Row) => string | null, order?: string[]) {
  const m = new Map<string, number>()
  for (const r of rows) {
    const v = get(r)
    if (v !== null) m.set(v, (m.get(v) ?? 0) + 1)
  }
  const entries = [...m.entries()].map(([value, count]) => ({ value, count }))
  if (order) entries.sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value))
  else entries.sort((a, b) => b.count - a.count)
  return entries
}

export function filterOptions(rows: Row[], trimOrder: string[]): FilterOptions {
  const years = rows.map((r) => r.year).filter((y): y is number => y !== null)
  return {
    sources: counts(rows, (r) => r.source),
    trims: counts(rows, (r) => r.trim_label, trimOrder),
    fuels: counts(rows, (r) => r.fuel),
    transmissions: counts(rows, (r) => r.transmission),
    sellers: counts(rows, (r) => r.seller_type),
    years: years.length ? [Math.min(...years), Math.max(...years)] : [2000, new Date().getFullYear()],
  }
}
