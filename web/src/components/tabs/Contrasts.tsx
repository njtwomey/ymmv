import { useMemo, useState } from 'react'
import { ChartCard, Empty } from '@/components/ChartCard'
import { EChart } from '@/components/EChart'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { colourFor, useBase } from '@/lib/chart'
import { type Dim, DIMS, levelLabel, levelOf } from '@/lib/dims'
import { gbp, pct } from '@/lib/format'
import { parseFormula } from '@/lib/formula'
import { effectsOf, fitModel, hasMainEffect } from '@/lib/model'
import { ageCats, bandSeries, bandTooltipFormatter, MILEAGE_CATS, mileageCat, summaries } from '@/lib/series'
import type { Row } from '@/lib/types'

const AGE_BANDS = [
  { label: '0–4 yrs', lo: 0, hi: 4 },
  { label: '5–8', lo: 5, hi: 8 },
  { label: '9–12', lo: 9, hi: 12 },
  { label: '13+', lo: 13, hi: 999 },
]

export function Contrasts({
  rows,
  orders,
  place,
  formula,
}: {
  rows: Row[]
  orders: Record<Dim, string[]>
  place: string
  formula: string
}) {
  const b = useBase()
  const [dim, setDim] = useState<Dim>('seller_type')
  const [refChoice, setRefChoice] = useState<string | null>(null)
  const [minN, setMinN] = useState(5)
  const priced = useMemo(() => rows.filter((r) => r.price_gbp !== null), [rows])
  const levels = useMemo(() => orders[dim].filter((l) => priced.some((r) => levelOf(r, dim) === l)), [orders, dim, priced])
  const ref = refChoice && levels.includes(refChoice) ? refChoice : (levels[levels.length - 1] ?? null)
  const label = (l: string) => levelLabel(dim, l, place)
  const colour = (l: string) => colourFor(b.t, orders[dim], l)
  const count = (l: string) => priced.filter((r) => levelOf(r, dim) === l).length

  const lineChart = (cats: string[], cat: (r: Row) => string | null, xName: string) => {
    const series = levels.flatMap((l) =>
      bandSeries(`${label(l)} (${count(l).toLocaleString()})`, colour(l), summaries(priced.filter((r) => levelOf(r, dim) === l), cat, (r) => r.price_gbp, cats), minN),
    )
    return {
      ...b.common,
      legend: { ...b.common.legend, data: series.filter((s) => !s.name.includes('::')).map((s) => s.name) },
      tooltip: { ...b.common.tooltip, trigger: 'axis', formatter: bandTooltipFormatter },
      xAxis: b.categoryAxis(xName, cats, { boundaryGap: false, axisLabel: { color: b.t.muted, fontSize: 10, hideOverlap: true } }),
      yAxis: { ...b.valueAxis('Median asking price', b.money), nameGap: 52, min: 0 },
      grid: { ...b.common.grid, left: 72 },
      series,
    }
  }

  const byAge = useMemo(
    () => lineChart(ageCats(priced), (r) => (r.age === null ? null : String(r.age)), 'Age (years)'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [priced, dim, levels, minN, b, place],
  )
  const byMileage = useMemo(
    () => lineChart(MILEAGE_CATS, (r) => mileageCat(r.mileage), 'Mileage'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [priced, dim, levels, minN, b, place],
  )

  const mix = useMemo(() => {
    const series = levels.map((l) => {
      const subset = priced.filter((r) => levelOf(r, dim) === l && r.age !== null)
      return {
        name: label(l),
        type: 'bar',
        barGap: '10%',
        itemStyle: { color: colour(l), borderRadius: [3, 3, 0, 0] },
        data: AGE_BANDS.map((band) => (subset.length ? subset.filter((r) => r.age! >= band.lo && r.age! <= band.hi).length / subset.length : 0)),
      }
    })
    return {
      ...b.common,
      tooltip: { ...b.common.tooltip, trigger: 'axis', valueFormatter: (v: number) => `${Math.round(v * 100)}%` },
      xAxis: b.categoryAxis('Age', AGE_BANDS.map((x) => x.label)),
      yAxis: { ...b.valueAxis('Share of the group’s listings'), axisLabel: { color: b.t.muted, formatter: (v: number) => `${Math.round(v * 100)}%` } },
      series,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priced, dim, levels, b, place])

  const effect = useMemo(() => {
    const variable = DIMS.find((d) => d.key === dim)!.formulaVar
    try {
      const parsed = parseFormula(formula)
      const f = hasMainEffect(parsed, variable) ? formula : `${formula} + ${variable}`
      const model = fitModel(priced, f, { folds: 0, refs: ref ? { [variable]: ref } : {} })
      return { model, effects: effectsOf(model, variable), formula: f, error: null }
    } catch (e) {
      return { model: null, effects: [], formula, error: (e as Error).message }
    }
  }, [priced, dim, ref, formula])

  const isLog = effect.model?.response.kind === 'log' || effect.model?.response.kind === 'log1p'
  const forest = useMemo(() => {
    const eff = effect.effects
    const lvl = (c: (typeof eff)[number]) => c.parts[0].level!
    const val = (c: (typeof eff)[number], k: 'est' | 'lo' | 'hi') =>
      isLog ? (k === 'est' ? c.pct! : k === 'lo' ? c.pctLo! : c.pctHi!) : k === 'est' ? c.estimate : k === 'lo' ? c.lo : c.hi
    const cats = eff.map((c) => label(lvl(c)))
    const fmt = (v: number) => (isLog ? pct(v) : gbp(v))
    const lo = Math.min(0, ...eff.map((c) => val(c, 'lo')))
    const hi = Math.max(0, ...eff.map((c) => val(c, 'hi')))
    const pad = (hi - lo) * 0.08 || 0.01
    return {
      ...b.common,
      tooltip: {
        ...b.common.tooltip,
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const c = eff[p.dataIndex]
          return `<b>${label(lvl(c))}</b> vs ${label(ref ?? '')}<br/>${fmt(val(c, 'est'))} (95% CI ${fmt(val(c, 'lo'))} to ${fmt(val(c, 'hi'))})`
        },
      },
      grid: { left: 140, right: 32, top: 16, bottom: 48 },
      xAxis: {
        ...b.valueAxis(isLog ? `Effect on asking price vs ${label(ref ?? '')}` : `£ difference vs ${label(ref ?? '')}`),
        axisLabel: { color: b.t.muted, formatter: fmt, showMinLabel: false, showMaxLabel: false },
        min: lo - pad,
        max: hi + pad,
      },
      yAxis: { type: 'category', data: cats, inverse: true, axisLabel: { color: b.t.ink }, axisLine: { lineStyle: { color: b.t.axis } } },
      series: [
        {
          type: 'custom',
          renderItem: (_: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; style: (o: object) => object }) => {
            const lo = api.coord([api.value(0), api.value(2)])
            const hi = api.coord([api.value(1), api.value(2)])
            return { type: 'line', shape: { x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] }, style: { stroke: b.t.muted, lineWidth: 2 } }
          },
          data: eff.map((c, i) => [val(c, 'lo'), val(c, 'hi'), i]),
          z: 1,
          silent: true,
        },
        {
          type: 'scatter',
          symbolSize: 11,
          data: eff.map((c) => ({ value: [val(c, 'est'), label(lvl(c))], itemStyle: { color: colour(lvl(c)) } })),
          markLine: { silent: true, symbol: 'none', lineStyle: { color: b.t.axis, type: 'dashed' }, label: { show: false }, data: [{ xAxis: 0 }] },
          z: 2,
        },
      ],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect, isLog, b, ref, place, dim])

  const sentences = effect.effects.map((c) => {
    const l = label(c.parts[0].level!)
    const r = label(ref ?? '')
    return isLog
      ? `${l} asks ${pct(c.pct)} (95% CI ${pct(c.pctLo)} to ${pct(c.pctHi)}) vs ${r}`
      : `${l} asks ${gbp(c.estimate)} more (95% CI ${gbp(c.lo)} to ${gbp(c.hi)}) than ${r}`
  })

  if (!priced.length) return <Empty>No priced listings match the filters.</Empty>

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Compare by</Label>
          <Select value={dim} onValueChange={(v) => { setDim(v as Dim); setRefChoice(null) }}>
            <SelectTrigger size="sm" className="w-[14rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIMS.map((d) => (
                <SelectItem key={d.key} value={d.key}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Reference level</Label>
          <Select value={ref ?? undefined} onValueChange={setRefChoice}>
            <SelectTrigger size="sm" className="w-[12rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {levels.map((l) => (
                <SelectItem key={l} value={l}>
                  {label(l)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cminn" className="text-xs text-muted-foreground">Min cars per point</Label>
          <Input id="cminn" type="number" min={1} className="h-8 w-20" value={minN} onChange={(e) => setMinN(Math.max(1, Number(e.target.value) || 1))} />
        </div>
      </div>

      {levels.length < 2 ? (
        <Empty>Only one level of this dimension in the filtered data: nothing to contrast.</Empty>
      ) : (
        <>
          <ChartCard
            title="Like-for-like difference"
            description={
              effect.error ? (
                <span className="text-destructive">{effect.error}</span>
              ) : (
                <>
                  From the regression <code className="text-xs">{effect.formula}</code>, holding the other terms fixed.
                </>
              )
            }
          >
            {effect.effects.length > 0 && (
              <>
                <ul className="mb-2 space-y-1 text-sm">
                  {sentences.map((s) => (
                    <li key={s}>Like-for-like, {s}.</li>
                  ))}
                </ul>
                <EChart option={forest} height={Math.max(120, 48 * effect.effects.length + 64)} />
              </>
            )}
          </ChartCard>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="By age" description="Median asking price; band = middle 50%.">
              <EChart option={byAge} height={360} />
            </ChartCard>
            <ChartCard title="By mileage" description="Median asking price in 10k-mile bands.">
              <EChart option={byMileage} height={360} />
            </ChartCard>
          </div>
          <ChartCard title="What each group sells" description="Share of each group’s listings by age: raw price gaps are partly a different mix of cars.">
            <EChart option={mix} height={300} />
          </ChartCard>
        </>
      )}
    </div>
  )
}
