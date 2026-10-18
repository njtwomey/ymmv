/** Shapes returned by the /api endpoints (see server/api.ts). */

export type MarkValue = 'interesting' | 'want_more' | 'contacted' | 'rejected'

export interface Car {
  id: string
  label: string
  make: string
  model: string
  doors: number | null
  body_type: string | null
  trims: string[]
  n_listings: number
}

export interface Run {
  id: number
  source: string
  car_id: string | null
  started_at: string
  finished_at: string | null
  complete: boolean
  n_seen: number
}

export interface Meta {
  cars: Car[]
  sources: { source: string; n: number }[]
  runs: Run[]
  db_path: string
}

/** A field-level correction made to a listing (see the errata table). */
export interface Correction {
  field: string
  before: unknown
  after: unknown
  reason: string
  evidence: string | null
  created_at: string
}

export interface Listing {
  id: number
  source: string
  source_id: string
  car_id: string | null
  url: string | null
  title: string | null
  variant: string | null
  make: string | null
  model: string | null
  trim: string | null
  engine_l: number | null
  fuel: string | null
  transmission: string | null
  doors: number | null
  body_type: string | null
  colour: string | null
  condition: string | null
  seller_type: string | null
  year: number | null
  plate: string | null
  mileage: number | null
  location: string | null
  distance_miles: number | null
  price_gbp: number | null
  reserved: boolean
  status: 'active' | 'delisted'
  first_seen_at: string
  last_seen_at: string
  delisted_at: string | null
  /** 'Cat N' | 'Cat S' | 'Cat C' | 'Cat D' or null */
  writeoff: string | null
  /** AutoTrader's own price rating: GREAT | GOOD | FAIR | HIGH | LOW */
  price_indicator: string | null
  n_obs: number
  first_price: number | null
  mark: MarkValue | null
  /** active corrections to this listing (the shown values already include them) */
  errata: Correction[]
  note: string | null
}

export interface HistoryPoint {
  observed_at: string
  price_gbp: number | null
  mileage: number | null
  run_id: number
}

/** A listing plus the derived columns the charts and the model use. */
export interface Row extends Listing {
  age: number | null
  local: 'Local' | 'Rest of UK'
  state: 'For sale' | 'Sold'
  trim_label: string
  /** writeoff category, 'none' when clean (for formulas) */
  writeoff_label: string
  is_writeoff: 'Write-off' | 'Clean'
  rating: string
  seen_at: Date
}

/** Scores of a fitted model, as saved with it. */
export interface ModelMetrics {
  n: number
  k: number
  r2: number
  adj_r2: number
  sigma: number
  cv_folds: number | null
  cv_r2: number | null
  cv_mae: number | null
  cv_mape: number | null
  cv_rmse: number | null
}

/** A model configuration saved to the database: selection criteria + formula + scores. */
export interface SavedModel {
  id: number
  name: string
  car_id: string | null
  formula: string
  folds: number
  standardise: boolean
  filters: Record<string, unknown>
  metrics: ModelMetrics
  created_at: string
}
