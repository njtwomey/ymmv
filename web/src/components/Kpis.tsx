import { Card, CardContent } from '@/components/ui/card'
import { gbp, miles } from '@/lib/format'
import { median } from '@/lib/stats'
import type { Row } from '@/lib/types'

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card size="sm" className="gap-1 py-3">
      <CardContent className="px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-heading text-xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export function Kpis({ rows, place }: { rows: Row[]; place: string }) {
  const priced = rows.map((r) => r.price_gbp).filter((p): p is number => p !== null)
  const mileage = rows.map((r) => r.mileage).filter((m): m is number => m !== null)
  const local = rows.filter((r) => r.local === 'Local').length
  const sold = rows.filter((r) => r.status === 'delisted').length
  const marked = rows.filter((r) => r.mark).length
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <Kpi label="Listings shown" value={rows.length.toLocaleString()} sub={`${priced.length.toLocaleString()} with a price`} />
      <Kpi label="Median asking price" value={priced.length ? gbp(median(priced)) : '–'} />
      <Kpi label="Median mileage" value={mileage.length ? miles(median(mileage)) : '–'} />
      <Kpi label={`Near ${place}`} value={local.toLocaleString()} sub={rows.length ? `${Math.round((local / rows.length) * 100)}% of shown` : undefined} />
      <Kpi label="Sold (delisted)" value={sold.toLocaleString()} sub="gone between scrapes" />
      <Kpi label="Marked" value={marked.toLocaleString()} />
    </div>
  )
}
