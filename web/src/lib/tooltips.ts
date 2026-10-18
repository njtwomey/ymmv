import { gbp, miles } from './format'
import type { Row } from './types'

/** Item tooltip for a point whose data carries a listing id. */
export function pointTooltip(byId: Map<number, Row>) {
  return (p: { data: { id: number }; marker: string; seriesName: string }) => {
    const r = byId.get(p.data.id)
    if (!r) return ''
    return `${p.marker}<b>${r.year ?? ''} ${r.variant ?? ''}</b><br/>${gbp(r.price_gbp)} · ${miles(r.mileage)}<br/>
      <span style="opacity:.7">${r.location ?? ''}${r.distance_miles !== null ? ` (${r.distance_miles} mi)` : ''} · ${p.seriesName}</span>`
  }
}
