import { useMemo } from 'react'
import { ChartCard, Empty } from '@/components/ChartCard'
import { EChart } from '@/components/EChart'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { colourFor, useBase } from '@/lib/chart'
import { MODEL_SOURCE, sourceLabel } from '@/lib/config'
import type { Dim } from '@/lib/dims'
import { gbp, pct, relTime, shortDate } from '@/lib/format'
import { fitModel } from '@/lib/model'
import { median } from '@/lib/stats'
import type { Row, Run } from '@/lib/types'

export function SourcesTab({
  rows,
  runs,
  formula,
  orders,
  onPick,
}: {
  rows: Row[]
  runs: Run[]
  formula: string
  orders: Record<Dim, string[]>
  onPick: (id: number) => void
}) {
  const b = useBase()
  const sources = useMemo(() => [...new Set(rows.map((r) => r.source))].sort((a, b) => orders.source.indexOf(a) - orders.source.indexOf(b)), [rows, orders])

  const comparison = useMemo(() => {
    const base = rows.filter((r) => r.source === MODEL_SOURCE && r.price_gbp !== null)
    if (base.length < 50) return { error: `Need at least 50 priced ${sourceLabel(MODEL_SOURCE)} listings to fit the reference model.`, items: [] }
    try {
      const model = fitModel(base, formula, { folds: 0 })
      const items = rows
        .filter((r) => r.source !== MODEL_SOURCE && r.status === 'active' && r.price_gbp !== null)
        .flatMap((r) => {
          const p = model.predict(r)
          return p ? [{ r, pred: p, gap: r.price_gbp! / p - 1 }] : []
        })
        .sort((x, y) => x.gap - y.gap)
      return { error: null, items }
    } catch (e) {
      return { error: (e as Error).message, items: [] }
    }
  }, [rows, formula])

  const dumbbell = useMemo(() => {
    const items = comparison.items
    const cats = items.map(({ r }) => `${r.year ?? ''} ${r.trim_label} ${r.engine_l?.toFixed(1) ?? ''} · ${Math.round((r.mileage ?? 0) / 1000)}k mi`)
    return {
      ...b.common,
      tooltip: {
        ...b.common.tooltip,
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const it = items[p.dataIndex]
          return `<b>${it.r.year} ${it.r.variant}</b><br/>${sourceLabel(it.r.source)} asks ${gbp(it.r.price_gbp)}<br/>Model: ${gbp(it.pred)} (${pct(it.gap)})`
        },
      },
      legend: { ...b.common.legend, data: [`${sourceLabel(MODEL_SOURCE)} model`, 'Asking price'] },
      grid: { left: 200, right: 24, top: 36, bottom: 40 },
      xAxis: { ...b.valueAxis('Price', b.money), scale: true },
      yAxis: { type: 'category', data: cats, axisLabel: { color: b.t.muted, fontSize: 10 }, axisLine: { lineStyle: { color: b.t.axis } } },
      series: [
        {
          type: 'custom',
          silent: true,
          renderItem: (_: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[] }) => {
            const a = api.coord([api.value(0), api.value(2)])
            const c = api.coord([api.value(1), api.value(2)])
            return { type: 'line', shape: { x1: a[0], y1: a[1], x2: c[0], y2: c[1] }, style: { stroke: b.t.context, lineWidth: 2 } }
          },
          data: items.map((it, i) => [it.pred, it.r.price_gbp, i]),
        },
        {
          name: `${sourceLabel(MODEL_SOURCE)} model`,
          type: 'scatter',
          symbolSize: 9,
          itemStyle: { color: b.t.context },
          data: items.map((it, i) => ({ value: [it.pred, i], id: it.r.id })),
        },
        {
          name: 'Asking price',
          type: 'scatter',
          symbol: 'diamond',
          symbolSize: 12,
          itemStyle: { color: colourFor(b.t, orders.source, items[0]?.r.source ?? '') },
          data: items.map((it, i) => ({ value: [it.r.price_gbp, i], id: it.r.id, itemStyle: { color: colourFor(b.t, orders.source, it.r.source) } })),
        },
      ],
    }
  }, [comparison, b, orders])

  return (
    <div className="grid gap-4">
      <ChartCard title="Sources">
        <div className="max-w-full overflow-x-auto">
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Listings</TableHead>
                <TableHead className="text-right">For sale</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Median asking</TableHead>
                <TableHead className="text-right">vs {sourceLabel(MODEL_SOURCE)} model</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((s) => {
                const sub = rows.filter((r) => r.source === s)
                const prices = sub.map((r) => r.price_gbp).filter((p): p is number => p !== null)
                const gaps = comparison.items.filter((it) => it.r.source === s).map((it) => it.gap)
                return (
                  <TableRow key={s}>
                    <TableCell>
                      <span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: colourFor(b.t, orders.source, s) }} />
                      {sourceLabel(s)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{sub.length.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{sub.filter((r) => r.status === 'active').length.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{sub.filter((r) => r.status === 'delisted').length.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{prices.length ? gbp(median(prices)) : '–'}</TableCell>
                    <TableCell className="text-right tabular-nums">{s === MODEL_SOURCE ? 'reference' : gaps.length ? `median ${pct(median(gaps))}` : '–'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </ChartCard>

      <ChartCard
        title={`Other sources vs the ${sourceLabel(MODEL_SOURCE)} model`}
        description={
          comparison.error ??
          (comparison.items.length
            ? `Each for-sale car's asking price against what the current formula, fitted on ${sourceLabel(MODEL_SOURCE)} only, predicts. Median gap ${pct(median(comparison.items.map((i) => i.gap)))}. Dealers often list on ${sourceLabel(MODEL_SOURCE)} too, so some cars appear in both.`
            : undefined)
        }
      >
        {comparison.items.length ? (
          <EChart option={dumbbell} height={Math.max(220, comparison.items.length * 26 + 80)} onPick={onPick} />
        ) : (
          <Empty>No for-sale cars from other sources in the filtered data.</Empty>
        )}
      </ChartCard>

      <ChartCard title="Scrape runs" description="A car counts as sold once a later complete run of its source no longer finds it.">
        <div className="max-h-96 max-w-full overflow-auto">
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Car</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Listings seen</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{r.id}</TableCell>
                  <TableCell>{sourceLabel(r.source)}</TableCell>
                  <TableCell className="text-muted-foreground">{r.car_id ?? '–'}</TableCell>
                  <TableCell title={r.started_at}>
                    {shortDate(r.started_at)} <span className="text-muted-foreground">({relTime(r.started_at)})</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.n_seen.toLocaleString()}</TableCell>
                  <TableCell>
                    {r.complete ? (
                      <Badge variant="secondary">Complete</Badge>
                    ) : r.finished_at ? (
                      <Badge variant="outline">Incomplete</Badge>
                    ) : (
                      <Badge variant="outline">Running</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ChartCard>
    </div>
  )
}
