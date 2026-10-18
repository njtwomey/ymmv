import type { Listing, Row } from './types'

/** SQLite stores naive UTC 'YYYY-MM-DD HH:MM:SS[.ffffff]'. */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s.replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1') + 'Z')
  return Number.isNaN(d.getTime()) ? null : d
}

export function deriveRows(listings: Listing[], radius: number): Row[] {
  return listings.map((l) => {
    const seen = parseDate(l.last_seen_at) ?? new Date()
    return {
      ...l,
      // Age is measured from when the car was last seen, so sold cars keep their age at sale.
      age: l.year != null ? seen.getUTCFullYear() - l.year : null,
      local: l.distance_miles != null && l.distance_miles <= radius ? 'Local' : 'Rest of UK',
      state: l.status === 'delisted' ? 'Sold' : 'For sale',
      trim_label: l.trim ?? 'Other',
      writeoff_label: l.writeoff ?? 'none',
      is_writeoff: l.writeoff ? 'Write-off' : 'Clean',
      rating: l.price_indicator ?? 'No rating',
      seen_at: seen,
    }
  })
}

/** Column aliases available in model formulas. */
export const FORMULA_ALIASES: Record<string, string> = {
  price: 'price_gbp',
  miles: 'mileage',
  engine: 'engine_l',
  seller: 'seller_type',
  gearbox: 'transmission',
  trim: 'trim_label',
  distance: 'distance_miles',
  writeoff: 'writeoff_label',
}

export type FeatureKind = 'number' | 'category'

export interface FormulaFeature {
  /** name as written in formulas (may be an alias, see FORMULA_ALIASES) */
  name: string
  kind: FeatureKind
  hint: string
}

/** Features offered by the Model tab's formula builder, in display order. */
export const FORMULA_FEATURES: FormulaFeature[] = [
  { name: 'age', kind: 'number', hint: 'Years since registration' },
  { name: 'mileage', kind: 'number', hint: 'Odometer miles' },
  { name: 'engine_l', kind: 'number', hint: 'Engine size in litres; as categories it stands in for generation' },
  { name: 'year', kind: 'number', hint: 'Registration year (the same information as age)' },
  { name: 'distance_miles', kind: 'number', hint: 'Miles from the scrape postcode' },
  { name: 'doors', kind: 'number', hint: 'Number of doors' },
  { name: 'trim', kind: 'category', hint: 'Trim family from cars.yaml (e.g. One / Cooper / Cooper S / JCW)' },
  { name: 'fuel', kind: 'category', hint: 'Petrol, Diesel, Hybrid, …' },
  { name: 'transmission', kind: 'category', hint: 'Manual or Automatic' },
  { name: 'seller_type', kind: 'category', hint: 'Trade (dealer) or private seller' },
  { name: 'writeoff', kind: 'category', hint: 'Insurance write-off category (Cat N / S / C / D, or none)' },
  { name: 'is_writeoff', kind: 'category', hint: 'Write-off or clean' },
  { name: 'rating', kind: 'category', hint: "AutoTrader's own price rating" },
  { name: 'local', kind: 'category', hint: 'Within the local radius, or the rest of the UK' },
  { name: 'source', kind: 'category', hint: 'Which site the listing came from' },
  { name: 'state', kind: 'category', hint: 'For sale, or sold (delisted)' },
  { name: 'colour', kind: 'category', hint: 'Body colour (only some sources give it)' },
  { name: 'body_type', kind: 'category', hint: 'Body style' },
  { name: 'condition', kind: 'category', hint: 'Used or new' },
]

/** Columns offered to formulas (shown in the Model tab help). */
export const FORMULA_COLUMNS = ['price', ...FORMULA_FEATURES.map((f) => f.name)]
