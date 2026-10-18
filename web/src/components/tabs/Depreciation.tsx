import { useMemo, useState } from 'react'
import { ChartCard, Empty } from '@/components/ChartCard'
import { EChart } from '@/components/EChart'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { colourFor, useBase } from '@/lib/chart'
import type { Dim } from '@/lib/dims'
import { ageCats, bandSeries, bandTooltipFormatter, summaries } from '@/lib/series'
import type { Row } from '@/lib/types'

export function Depreciation({ rows, orders }: { rows: Row[]; orders: Record<Dim, string[]> }) {
  const b = useBase()
  const [minN, setMinN] = useState(5)
  const priced = useMemo(() => rows.filter((r) => r.price_gbp !== null && r.age !== null), [rows])

  const option = useMemo(() => {
    const cats = ageCats(priced)
    const trims = orders.trim_label.filter((t) => priced.some((r) => r.trim_label === t))
    const series = trims.flatMap((trim) => {
      const subset = priced.filter((r) => r.trim_label === trim)
      const pts = summaries(subset, (r) => String(r.age), (r) => r.price_gbp, cats)
      return bandSeries(`${trim} (${subset.length.toLocaleString()})`, colourFor(b.t, orders.trim_label, trim), pts, minN)
    })
    return {
      ...b.common,
      legend: { ...b.common.legend, data: series.filter((s) => !s.name.includes('::')).map((s) => s.name) },
      tooltip: { ...b.common.tooltip, trigger: 'axis', formatter: bandTooltipFormatter },
      xAxis: b.categoryAxis('Age (years since registration)', cats, { boundaryGap: false }),
      yAxis: { ...b.valueAxis('Median asking price', b.money), nameGap: 52, min: 0 },
      grid: { ...b.common.grid, left: 72 },
      series,
    }
  }, [priced, orders, minN, b])

  return (
    <ChartCard
      title="Depreciation by trim"
      description="Median asking price by age; the band is the middle 50%. Ages with too few cars are left as gaps."
      actions={
        <div className="flex items-center gap-2">
          <Label htmlFor="minn" className="text-sm font-normal whitespace-nowrap">
            Min cars per point
          </Label>
          <Input id="minn" type="number" min={1} className="h-8 w-16" value={minN} onChange={(e) => setMinN(Math.max(1, Number(e.target.value) || 1))} />
        </div>
      }
    >
      {priced.length ? <EChart option={option} height={460} /> : <Empty>No priced listings match the filters.</Empty>}
    </ChartCard>
  )
}
