/**
 * The read queries behind the app's data, shared by the dev API (server/api.ts) and
 * the static export for GitHub Pages (scripts/export-static.ts), so the JSON the
 * site ships is exactly what the local API serves from the same snapshot.
 */
import type { DatabaseSync } from 'node:sqlite'

export type Row = Record<string, unknown>

export const LISTING_COLUMNS = [
  'id', 'source', 'source_id', 'car_id', 'url', 'title', 'variant', 'make', 'model', 'trim',
  'engine_l', 'fuel', 'transmission', 'doors', 'body_type', 'colour', 'condition', 'seller_type',
  'year', 'plate', 'mileage', 'location', 'distance_miles', 'price_gbp', 'reserved', 'status',
  'first_seen_at', 'last_seen_at', 'delisted_at', 'writeoff', 'price_indicator',
] as const

export function columns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(rows.map((r) => r.name))
}

export function hasTable(db: DatabaseSync, table: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table) !== undefined
}

export function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

export function meta(db: DatabaseSync, source: string) {
  const listingCols = columns(db, 'listings')
  const runCols = columns(db, 'scrape_runs')
  const byCar = listingCols.has('car_id')
    ? (db.prepare(`SELECT car_id, count(*) AS n FROM listings GROUP BY car_id`).all() as Row[])
    : []
  const counts = new Map(byCar.map((r) => [r.car_id, Number(r.n)]))
  const cars = hasTable(db, 'cars')
    ? (db.prepare(`SELECT * FROM cars ORDER BY label`).all() as Row[]).map((c) => ({
        id: c.id,
        label: c.label,
        make: c.make,
        model: c.model,
        doors: c.doors,
        body_type: c.body_type,
        trims: parseJson<string[]>(c.trims, []),
        n_listings: counts.get(c.id) ?? 0,
      }))
    : []
  const sources = db.prepare(`SELECT source, count(*) AS n FROM listings GROUP BY source ORDER BY n DESC`).all()
  const carCol = runCols.has('car_id') ? 'car_id' : 'NULL AS car_id'
  const runs = (
    db
      .prepare(`SELECT id, source, ${carCol}, started_at, finished_at, complete, n_seen FROM scrape_runs ORDER BY started_at DESC`)
      .all() as Row[]
  ).map((r) => ({ ...r, complete: Boolean(r.complete) }))
  return { cars, sources, runs, db_path: source }
}

export function listings(db: DatabaseSync, car: string | null) {
  const have = columns(db, 'listings')
  const select = LISTING_COLUMNS.map((c) => {
    if (have.has(c)) return `l."${c}"`
    if (c === 'variant' && have.has('subtitle')) return `l.subtitle AS variant`
    return `NULL AS "${c}"`
  })
  const marks = hasTable(db, 'marks')
  const sql = `
    SELECT ${select.join(', ')},
      (SELECT count(*) FROM observations o WHERE o.listing_id = l.id) AS n_obs,
      (SELECT o.price_gbp FROM observations o WHERE o.listing_id = l.id ORDER BY o.observed_at LIMIT 1) AS first_price,
      ${marks ? 'm.mark, m.note' : 'NULL AS mark, NULL AS note'},
      ${
        hasTable(db, 'errata')
          ? `(SELECT json_group_array(json_object('field', e.field, 'before', json(e.before), 'after', json(e.after),
               'reason', e.reason, 'evidence', e.evidence, 'created_at', e.created_at))
             FROM errata e WHERE e.listing_id = l.id AND e.active) AS errata`
          : "'[]' AS errata"
      }
    FROM listings l ${marks ? 'LEFT JOIN marks m ON m.listing_id = l.id' : ''}
    ${car && have.has('car_id') ? 'WHERE l.car_id = ?' : ''}
    ORDER BY l.id`
  const stmt = db.prepare(sql)
  const rows = (car && have.has('car_id') ? stmt.all(car) : stmt.all()) as Row[]
  return rows.map((r) => ({ ...r, reserved: Boolean(r.reserved), errata: parseJson(r.errata, []) }))
}

export function history(db: DatabaseSync, id: number) {
  return db
    .prepare(`SELECT observed_at, price_gbp, mileage, run_id FROM observations WHERE listing_id = ? ORDER BY observed_at`)
    .all(id)
}

export function savedModelRow(r: Record<string, unknown>) {
  return { ...r, standardise: Boolean(r.standardise), filters: parseJson(r.filters, {}), metrics: parseJson(r.metrics, {}) }
}

export function listModels(db: DatabaseSync, car: string | null) {
  if (!hasTable(db, 'saved_models')) return []
  const rows = (
    car
      ? db.prepare(`SELECT * FROM saved_models WHERE car_id = ? OR car_id IS NULL ORDER BY created_at DESC`).all(car)
      : db.prepare(`SELECT * FROM saved_models ORDER BY created_at DESC`).all()
  ) as Record<string, unknown>[]
  return rows.map(savedModelRow)
}

/** Every listing's price history, keyed by listing id (for the static export). */
export function allHistory(db: DatabaseSync): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  const rows = db
    .prepare(`SELECT listing_id, observed_at, price_gbp, mileage, run_id FROM observations ORDER BY listing_id, observed_at`)
    .all() as Row[]
  for (const { listing_id, ...point } of rows) (out[String(listing_id)] ??= []).push(point)
  return out
}
