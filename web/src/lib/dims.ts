/** Categorical dimensions used for colouring, splitting and contrasts. */
import { sourceLabel } from './config'
import type { Row } from './types'

export type Dim = 'seller_type' | 'fuel' | 'transmission' | 'source' | 'local' | 'state' | 'trim_label' | 'is_writeoff' | 'rating'

export const DIMS: { key: Dim; label: string; formulaVar: string }[] = [
  { key: 'seller_type', label: 'Seller type', formulaVar: 'seller_type' },
  { key: 'transmission', label: 'Gearbox', formulaVar: 'transmission' },
  { key: 'fuel', label: 'Fuel', formulaVar: 'fuel' },
  { key: 'trim_label', label: 'Trim', formulaVar: 'trim' },
  { key: 'source', label: 'Source', formulaVar: 'source' },
  { key: 'local', label: 'Local vs rest of UK', formulaVar: 'local' },
  { key: 'state', label: 'Sold vs for sale', formulaVar: 'state' },
  { key: 'is_writeoff', label: 'Write-off vs clean', formulaVar: 'is_writeoff' },
  { key: 'rating', label: 'AutoTrader price rating', formulaVar: 'rating' },
]

/** Dimensions offered for colouring scatter charts. */
export const COLOUR_BY: Dim[] = ['source', 'trim_label', 'seller_type', 'local', 'fuel', 'transmission', 'state', 'is_writeoff', 'rating']

/** AutoTrader's price ratings, cheapest-looking first. */
export const RATINGS = ['GREAT', 'GOOD', 'FAIR', 'HIGH', 'LOW', 'No rating']

export const dimLabel = (d: Dim) => DIMS.find((x) => x.key === d)?.label ?? d

export function levelOf(r: Row, d: Dim): string | null {
  const v = r[d]
  return v === null || v === undefined ? null : String(v)
}

export function levelLabel(d: Dim, level: string, place = 'local'): string {
  if (d === 'seller_type') return level === 'TRADE' ? 'Trade (dealer)' : level === 'PRIVATE' ? 'Private' : level
  if (d === 'source') return sourceLabel(level)
  if (d === 'local') return level === 'Local' ? `Near ${place}` : level
  if (d === 'rating') return level === 'No rating' ? level : level[0] + level.slice(1).toLowerCase()
  return level
}

/** Stable level order per dimension, from all rows of the car (so colours don't move when filtering). */
export function levelOrders(rows: Row[], trims: string[]): Record<Dim, string[]> {
  const byCount = (d: Dim) => {
    const counts = new Map<string, number>()
    for (const r of rows) {
      const l = levelOf(r, d)
      if (l !== null) counts.set(l, (counts.get(l) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }
  const trimOrder = [...trims, ...byCount('trim_label').filter((t) => !trims.includes(t))]
  return {
    seller_type: ['TRADE', 'PRIVATE', ...byCount('seller_type').filter((x) => x !== 'TRADE' && x !== 'PRIVATE')],
    fuel: byCount('fuel'),
    transmission: byCount('transmission'),
    source: byCount('source'),
    local: ['Local', 'Rest of UK'],
    state: ['For sale', 'Sold'],
    is_writeoff: ['Clean', 'Write-off'],
    rating: RATINGS.filter((x) => rows.some((r) => r.rating === x)),
    trim_label: trimOrder,
  }
}
