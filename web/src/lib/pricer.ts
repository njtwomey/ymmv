/**
 * "Price a car": turn the fitted model's formula into form fields, and form
 * values back into a row the model can predict.
 *
 * - A variable used as a category anywhere in the formula (a text column, or a
 *   number inside C()) becomes a dropdown of the levels the model has seen;
 *   a text column inside O() offers its listed order.
 * - Other variables are numbers, including numbers inside O(), which can price
 *   values the data never had.
 * - `age` is asked as registration year (age = this year's scrape year − year),
 *   because that's what an advert shows.
 */
import { FORMULA_ALIASES } from './data'
import { exprVars } from './formula'
import type { ModelResult } from './model'
import type { Row } from './types'

export interface PriceField {
  /** variable name as written in the formula (alias or column) */
  name: string
  kind: 'number' | 'category'
  options: string[]
  default: string
  /** numbers: the range seen in the data, to flag extrapolation */
  range?: [number, number]
}

const column = (name: string) => FORMULA_ALIASES[name] ?? name
const valueOf = (r: Row, name: string) => (r as unknown as Record<string, unknown>)[column(name)]

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

/** The year listings were scraped in: ages are measured from it. */
export const referenceYear = (rows: Row[]) =>
  rows.reduce((y, r) => Math.max(y, r.seen_at?.getUTCFullYear?.() ?? 0), 0) || new Date().getFullYear()

export function priceFields(model: ModelResult, rows: Row[]): PriceField[] {
  const categorical = new Map<string, string[]>()
  const numeric = new Set<string>()
  for (const enc of model.design.encodings.values()) {
    // Ordered text levels are a dropdown in their own order; ordered numbers stay a number box.
    const levels = enc.kind === 'categorical' ? enc.allLevels : enc.kind === 'ordinal' ? enc.factor.order : null
    if (levels && enc.factor.varName) {
      const name = enc.factor.varName
      categorical.set(name, [...new Set([...(categorical.get(name) ?? []), ...levels])])
    } else {
      for (const v of exprVars(enc.factor.expr)) numeric.add(v)
    }
  }
  // Ask for year rather than age.
  if (numeric.delete('age') && !categorical.has('year')) numeric.add('year')

  const fields: PriceField[] = []
  for (const [name, levels] of categorical) {
    const counts = new Map<string, number>()
    for (const r of rows) {
      const v = valueOf(r, name)
      if (v !== null && v !== undefined) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1)
    }
    const key = (l: string) => {
      // Numeric levels ("1.5", "2.0", "2019") match the data however it's formatted.
      const n = Number(l)
      return Number.isFinite(n) ? [...counts.keys()].find((k) => Number(k) === n) ?? l : l
    }
    const options = [...levels].sort((a, b) => (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Number(a) - Number(b) : 0))
    const common = [...options].sort((a, b) => (counts.get(key(b)) ?? 0) - (counts.get(key(a)) ?? 0))[0]
    fields.push({ name, kind: 'category', options, default: common ?? options[0] })
  }
  for (const name of numeric) {
    if (categorical.has(name)) continue // a dropdown already covers it
    const xs = rows.map((r) => valueOf(r, name)).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (!xs.length) continue
    fields.push({ name, kind: 'number', options: [], default: String(median(xs)), range: [Math.min(...xs), Math.max(...xs)] })
  }
  const order = ['year', 'mileage', 'trim', 'engine_l', 'engine', 'fuel', 'transmission', 'gearbox', 'seller_type', 'seller', 'local']
  const rank = (n: string) => (order.includes(n) ? order.indexOf(n) : order.length)
  return fields.sort((a, b) => rank(a.name) - rank(b.name))
}

/** The row columns behind an input: year also carries the age derived from it. */
export const fieldColumns = (name: string): string[] => (column(name) === 'year' ? ['year', 'age'] : [column(name)])

/** Form values → a row keyed by real column names, with age derived from year. */
export function rowFromValues(fields: PriceField[], values: Record<string, string>, refYear: number): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const f of fields) {
    const raw = values[f.name] ?? f.default
    const numericLevel = f.kind === 'number' || (raw.trim() !== '' && Number.isFinite(Number(raw)) && f.options.every((o) => Number.isFinite(Number(o))))
    row[column(f.name)] = numericLevel ? Number(raw) : raw
  }
  if (typeof row.year === 'number') row.age = refYear - row.year
  return row
}
