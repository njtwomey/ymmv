import { useMemo, useState } from 'react'
import { ChartCard, Empty } from '@/components/ChartCard'
import { ColourBySelect } from '@/components/ColourBySelect'
import { EChart } from '@/components/EChart'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useBase } from '@/lib/chart'
import type { Dim } from '@/lib/dims'
import { gbp } from '@/lib/format'
import { colouredScatter } from '@/lib/series'
import { boxplot, groupBy } from '@/lib/stats'
import { pointTooltip } from '@/lib/tooltips'
import type { Row } from '@/lib/types'

export function Overview({
  rows,
  orders,
  place,
  onPick,
}: {
  rows: Row[]
  orders: Record<Dim, string[]>
  place: string
  onPick: (id: number) => void
}) {
  const b = useBase()
  const [colourBy, setColourBy] = useState<Dim>('local')
  const [split, setSplit] = useState(true)
  const priced = useMemo(() => rows.filter((r) => r.price_gbp !== null && r.mileage !== null), [rows])
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])

  const scatter = useMemo(() => {
    const points = priced.map((r) => ({ row: r, value: [r.mileage!, r.price_gbp!] as [number, number] }))
    const series = colouredScatter(points, colourBy, orders, b, place)
    return {
      ...b.common,
      legend: { ...b.common.legend, type: 'scroll' },
      tooltip: { ...b.common.tooltip, trigger: 'item', formatter: pointTooltip(byId) },
      xAxis: { ...b.valueAxis('Mileage', b.miles), min: 0 },
      yAxis: { ...b.valueAxis('Asking price', b.money), min: 0, nameGap: 52 },
      grid: { ...b.common.grid, left: 72 },
      dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }],
      series,
    }
  }, [priced, colourBy, orders, b, place, byId])

  const box = useMemo(() => {
    const withYear = priced.filter((r) => r.year !== null)
    const years = [...new Set(withYear.map((r) => r.year!))].sort((x, y) => x - y)
    const cats = years.map(String)
    const groupsOf = split ? (['Rest of UK', 'Local'] as const) : (['All'] as const)
    const series = groupsOf.map((g, i) => {
      const subset = g === 'All' ? withYear : withYear.filter((r) => r.local === g)
      const byYear = groupBy(subset, (r) => r.year!)
      const colour = g === 'Rest of UK' ? b.t.context : b.t.palette[0]
      return {
        name: g === 'Local' ? `Near ${place}` : g === 'All' ? 'All cars' : g,
        type: 'boxplot',
        itemStyle: { color: colour, borderColor: g === 'Rest of UK' ? b.t.muted : colour, opacity: 0.9 },
        boxWidth: split ? ['20%', '40%'] : ['30%', '60%'],
        z: i,
        data: years.map((y) => {
          const v = (byYear.get(y) ?? []).map((r) => r.price_gbp!)
          return v.length ? { value: boxplot(v), n: v.length } : '-'
        }),
      }
    })
    const n = groupBy(withYear, (r) => r.year!)
    return {
      ...b.common,
      tooltip: {
        ...b.common.tooltip,
        trigger: 'item',
        formatter: (p: { seriesName: string; name: string; data: { value: number[]; n: number } }) =>
          `<b>${p.name}</b> · ${p.seriesName} (n=${p.data.n})<br/>median ${gbp(p.data.value[2])}<br/>middle 50%: ${gbp(p.data.value[1])}–${gbp(p.data.value[3])}`,
      },
      xAxis: b.categoryAxis('Registration year', cats, {
        axisLabel: { color: b.t.muted, fontSize: 10, formatter: (v: string) => `${v}\nn=${n.get(Number(v))?.length ?? 0}` },
        nameGap: 40,
      }),
      yAxis: { ...b.valueAxis('Asking price', b.money), nameGap: 52 },
      grid: { ...b.common.grid, left: 72, bottom: 64 },
      series,
    }
  }, [priced, split, b, place])

  return (
    <div className="grid gap-4">
      <ChartCard
        title="Asking price vs mileage"
        description="Click a point to open the listing. Scroll or pinch to zoom."
        actions={
          <ColourBySelect value={colourBy} onChange={setColourBy} />
        }
      >
        {priced.length ? <EChart option={scatter} height={440} onPick={onPick} /> : <Empty>No priced listings match the filters.</Empty>}
      </ChartCard>
      <ChartCard
        title="Asking price by registration year"
        description="Boxes: middle 50% and median; whiskers 1.5 × IQR."
        actions={
          <div className="flex items-center gap-2">
            <Switch id="split-local" checked={split} onCheckedChange={setSplit} />
            <Label htmlFor="split-local" className="text-sm font-normal">
              Split near {place}
            </Label>
          </div>
        }
      >
        {priced.length ? <EChart option={box} height={380} /> : <Empty>No priced listings match the filters.</Empty>}
      </ChartCard>
    </div>
  )
}
