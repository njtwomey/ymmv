/** ECharts series builders shared by several charts. */
import { type base, colourFor } from './chart'
import { type Dim, levelLabel, levelOf } from './dims'
import { gbp } from './format'
import { groupBy, type Summary, summarise } from './stats'
import type { Row } from './types'

/**
 * One scatter series per level of `dim`, coloured consistently everywhere (colours
 * follow the level's fixed order, not what happens to be filtered in). For
 * "local vs rest" the rest of the UK is a grey context layer.
 */
export function colouredScatter(
  points: { row: Row; value: [number, number] }[],
  dim: Dim,
  orders: Record<Dim, string[]>,
  b: ReturnType<typeof base>,
  place: string,
) {
  const big = points.length > 1500
  const groups = groupBy(points, (p) => levelOf(p.row, dim) ?? 'Unknown')
  const order = orders[dim].filter((l) => groups.has(l)).concat([...groups.keys()].filter((l) => !orders[dim].includes(l)))
  const isLocal = dim === 'local'
  return order.map((level) => {
    const context = isLocal && level === 'Rest of UK'
    const colour = isLocal ? (context ? b.t.context : b.t.palette[0]) : colourFor(b.t, orders[dim], level)
    return {
      name: `${levelLabel(dim, level, place)} (${groups.get(level)!.length.toLocaleString()})`,
      type: 'scatter' as const,
      large: false,
      symbolSize: context || big ? 5 : 8,
      z: context ? 1 : 3,
      itemStyle: { color: colour, opacity: context ? 0.45 : big ? 0.7 : 0.9, borderColor: context ? 'transparent' : b.t.surface, borderWidth: context ? 0 : 0.5 },
      emphasis: { scale: 1.6 },
      data: groups.get(level)!.map((p) => ({ value: p.value, id: p.row.id })),
    }
  })
}

export interface BandPoint {
  cat: string
  stats: Summary | null
}

/** Median line with a shaded middle-50% band, on a category axis. Points with n < minN are gaps. */
export function bandSeries(name: string, colour: string, points: BandPoint[], minN: number) {
  const ok = (p: BandPoint) => p.stats !== null && p.stats.n >= minN
  const stack = `band:${name}`
  return [
    {
      name: `${name}::lo`,
      type: 'line',
      stack,
      data: points.map((p) => (ok(p) ? p.stats!.q1 : '-')),
      lineStyle: { opacity: 0 },
      symbol: 'none',
      silent: true,
      tooltip: { show: false },
    },
    {
      name: `${name}::band`,
      type: 'line',
      stack,
      data: points.map((p) => (ok(p) ? p.stats!.q3 - p.stats!.q1 : '-')),
      lineStyle: { opacity: 0 },
      symbol: 'none',
      areaStyle: { color: colour, opacity: 0.16 },
      silent: true,
      tooltip: { show: false },
    },
    {
      name,
      type: 'line',
      data: points.map((p) => (ok(p) ? { value: p.stats!.med, n: p.stats!.n, q1: p.stats!.q1, q3: p.stats!.q3 } : '-')),
      lineStyle: { width: 2, color: colour },
      itemStyle: { color: colour },
      symbol: 'circle',
      symbolSize: 6,
    },
  ]
}

/** Axis tooltip that lists only the median series (not the band helpers). */
export function bandTooltipFormatter(params: unknown): string {
  const list = (Array.isArray(params) ? params : [params]) as {
    seriesName: string
    axisValueLabel: string
    marker: string
    data: { value: number; n: number; q1: number; q3: number } | '-'
  }[]
  const rows = list
    .filter((p) => !p.seriesName.includes('::') && p.data !== '-' && p.data !== undefined)
    .map((p) => {
      const d = p.data as { value: number; n: number; q1: number; q3: number }
      return `${p.marker}${p.seriesName}: <b>${gbp(d.value)}</b> <span style="opacity:.7">(${gbp(d.q1)}–${gbp(d.q3)}, n=${d.n})</span>`
    })
  return rows.length ? `${list[0].axisValueLabel}<br/>${rows.join('<br/>')}` : ''
}

export function summaries<T>(items: T[], cat: (t: T) => string | null, value: (t: T) => number | null, cats: string[]): BandPoint[] {
  const by = new Map<string, number[]>()
  for (const it of items) {
    const c = cat(it)
    const v = value(it)
    if (c === null || v === null) continue
    const list = by.get(c)
    if (list) list.push(v)
    else by.set(c, [v])
  }
  return cats.map((c) => ({ cat: c, stats: by.has(c) ? summarise(by.get(c)!) : null }))
}

export const AGE_CATS = Array.from({ length: 21 }, (_, i) => String(i))
export const MILEAGE_BAND = 10_000
export const MILEAGE_CATS = Array.from({ length: 15 }, (_, i) => `${i * 10}–${i * 10 + 10}k`)
export const mileageCat = (m: number | null) =>
  m === null ? null : MILEAGE_CATS[Math.min(Math.floor(m / MILEAGE_BAND), MILEAGE_CATS.length - 1)]

/** Age categories 0..max age present (capped). */
export function ageCats(rows: Row[], cap = 25): string[] {
  const ages = rows.map((r) => r.age).filter((a): a is number => a !== null && a >= 0 && a <= cap)
  if (!ages.length) return []
  const max = Math.max(...ages)
  return Array.from({ length: max + 1 }, (_, i) => String(i))
}
