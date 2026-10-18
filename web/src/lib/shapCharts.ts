/** ECharts options for the SHAP explanation views (waterfall, force, what-if, all cars). */
import type { base } from './chart'
import { gbp, gbpK } from './format'

type Base = ReturnType<typeof base>

export interface Step {
  /** "Mileage" */
  name: string
  /** "64,513 mi" */
  value: string
  phi: number
}

/** £12,700 → "£12.7k" (bar labels need more precision than gbpK's whole thousands). */
const kOne = (v: number) => (Math.abs(v) >= 1000 ? `£${(v / 1000).toFixed(1)}k` : gbp(v))

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${gbp(Math.abs(v))}`

/** The refined waterfall: average car → each input (biggest first) → this car. */
export function waterfallOption(b: Base, d: { base: number; prediction: number; steps: Step[]; asking: number | null }) {
  const up = b.t.palette[1]
  const down = b.t.palette[0]
  let run = d.base
  const bars = d.steps.map((s, i) => {
    const start = run
    run += s.phi
    return { value: [i, start, run, s.phi] }
  })
  const xs = [d.base, d.prediction, ...bars.flatMap((x) => [x.value[1], x.value[2]]), ...(d.asking ? [d.asking] : [])]
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  const pad = Math.max((hi - lo) * 0.18, 400)
  // Labels sit above the plot (the y axis is inverted, so "start" is the top), staggered so they can't collide.
  const ref = (x: number, label: string, type: 'solid' | 'dashed' | 'dotted', color: string, tier: number) => ({
    xAxis: x,
    lineStyle: { color, type, width: type === 'solid' ? 1.5 : 1 },
    label: { formatter: label, color, fontSize: 11, position: 'start' as const, distance: 4 + tier * 15, fontWeight: tier === 1 ? 600 : 400 },
  })
  return {
    ...b.common,
    animation: false,
    tooltip: { show: false },
    grid: { left: 150, right: 24, top: 64, bottom: 30 },
    xAxis: {
      type: 'value' as const,
      min: Math.max(0, Math.floor((lo - pad) / 250) * 250),
      max: Math.ceil((hi + pad) / 250) * 250,
      // The axis starts and ends at padded, non-round values: hide those edge labels so they can't collide.
      axisLabel: { color: b.t.muted, fontSize: 11, formatter: (v: number) => gbpK(v), showMinLabel: false, showMaxLabel: false },
      splitLine: { lineStyle: { color: b.t.grid } },
      axisLine: { show: false },
    },
    yAxis: {
      type: 'category' as const,
      inverse: true,
      data: d.steps.map((s) => `{n|${s.name}}\n{v|${s.value}}`),
      axisLabel: {
        rich: { n: { color: b.t.ink, fontSize: 12, lineHeight: 16 }, v: { color: b.t.muted, fontSize: 11, lineHeight: 14 } },
        align: 'right' as const,
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'custom',
        silent: true,
        data: bars,
        encode: { x: [1, 2], y: 0 },
        renderItem: (_: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
          const i = api.value(0)
          const start = api.value(1)
          const end = api.value(2)
          const phi = api.value(3)
          const band = api.size([0, 1])[1]
          const h = Math.min(26, band * 0.56)
          const [x0, y] = api.coord([start, i])
          const [x1] = api.coord([end, i])
          const left = Math.min(x0, x1)
          const width = Math.max(2, Math.abs(x1 - x0))
          const children: object[] = [
            { type: 'rect', shape: { x: left, y: y - h / 2, width, height: h, r: 3 }, style: { fill: phi >= 0 ? up : down } },
            {
              type: 'text',
              style: {
                text: signed(phi),
                x: phi >= 0 ? left + width + 6 : left - 6,
                y,
                fill: b.t.ink,
                fontSize: 11,
                align: phi >= 0 ? 'left' : 'right',
                verticalAlign: 'middle',
              },
            },
          ]
          if (i < d.steps.length - 1)
            children.push({
              type: 'line',
              shape: { x1, y1: y + h / 2, x2: x1, y2: y + band - h / 2 },
              style: { stroke: b.t.muted, lineDash: [2, 2], lineWidth: 1 },
            })
          return { type: 'group', children }
        },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            ref(d.base, `Average car ${gbp(d.base)}`, 'dashed', b.t.muted, 0),
            ref(d.prediction, `This car ${gbp(d.prediction)}`, 'solid', b.t.ink, 1),
            ...(d.asking ? [ref(d.asking, `Asking ${gbp(d.asking)}`, 'dotted', b.t.palette[3], 2)] : []),
          ],
        },
      },
    ],
  }
}

/**
 * The force plot: one bar where inputs that raise the price push right from the
 * left, and inputs that lower it push left from the right, meeting at this car's
 * price. Biggest pushes sit next to the price.
 */
export function forceOption(b: Base, d: { base: number; prediction: number; steps: Step[] }) {
  const up = b.t.palette[1]
  const down = b.t.palette[0]
  const pos = d.steps.filter((s) => s.phi > 0).sort((a, b2) => b2.phi - a.phi)
  const neg = d.steps.filter((s) => s.phi < 0).sort((a, b2) => a.phi - b2.phi)
  const segs: { from: number; to: number; s: Step; up: boolean }[] = []
  let cursor = d.prediction
  for (const s of pos) {
    segs.push({ from: cursor - s.phi, to: cursor, s, up: true })
    cursor -= s.phi
  }
  cursor = d.prediction
  for (const s of neg) {
    segs.push({ from: cursor, to: cursor - s.phi, s, up: false })
    cursor -= s.phi
  }
  const xs = [d.base, d.prediction, ...segs.flatMap((g) => [g.from, g.to])]
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  const pad = Math.max((hi - lo) * 0.06, 200)
  const total = hi - lo || 1
  return {
    ...b.common,
    animation: false,
    tooltip: {
      ...b.common.tooltip,
      trigger: 'item',
      formatter: (p: { data: { s: Step } }) => `<b>${p.data.s.name}</b>: ${p.data.s.value}<br/>${signed(p.data.s.phi)}`,
    },
    grid: { left: 16, right: 16, top: 56, bottom: 90 },
    xAxis: {
      type: 'value' as const,
      min: Math.floor((lo - pad) / 250) * 250,
      max: Math.ceil((hi + pad) / 250) * 250,
      axisLabel: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLine: { show: false },
    },
    yAxis: { type: 'category' as const, data: [''], show: false },
    series: [
      {
        type: 'custom',
        data: segs.map((g) => ({ value: [0, g.from, g.to], s: g.s, up: g.up })),
        encode: { x: [1, 2], y: 0 },
        renderItem: (params: { dataIndex: number }, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
          const g = segs[params.dataIndex]
          const [x0, y] = api.coord([api.value(1), 0])
          const [x1] = api.coord([api.value(2), 0])
          const h = 34
          const w = Math.max(1, x1 - x0)
          const tip = Math.min(8, w / 2)
          // Chevron pointing the way it pushes.
          const pts = g.up
            ? [[x0, y - h / 2], [x1 - tip, y - h / 2], [x1, y], [x1 - tip, y + h / 2], [x0, y + h / 2], [x0 + tip, y]]
            : [[x1, y - h / 2], [x0 + tip, y - h / 2], [x0, y], [x0 + tip, y + h / 2], [x1, y + h / 2], [x1 - tip, y]]
          const children: object[] = [
            { type: 'polygon', shape: { points: pts }, style: { fill: g.up ? up : down, stroke: b.t.surface, lineWidth: 1 } },
          ]
          if ((g.to - g.from) / total > 0.07)
            children.push({
              type: 'text',
              style: {
                text: `${g.s.name}\n${g.s.value}\n${signed(g.s.phi)}`,
                x: (x0 + x1) / 2,
                y: y + h / 2 + 8,
                fill: b.t.ink,
                fontSize: 11,
                lineHeight: 14,
                align: 'center',
                verticalAlign: 'top',
              },
            })
          return { type: 'group', children }
        },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            { xAxis: d.base, lineStyle: { color: b.t.muted, type: 'dashed' }, label: { formatter: `Average ${gbp(d.base)}`, color: b.t.muted, position: 'end' } },
            { xAxis: d.prediction, lineStyle: { color: b.t.ink, width: 1.5 }, label: { formatter: `This car ${gbp(d.prediction)}`, color: b.t.ink, position: 'end', fontWeight: 600 } },
          ],
        },
      },
    ],
  }
}

/** What if one input were different: a curve for numbers, a bar per option for categories. */
export function whatIfOption(
  b: Base,
  d: { points: { label: string; x: number | null; price: number; current: boolean }[]; name: string; asking: number | null; format: (x: number) => string },
) {
  const isLine = d.points.every((p) => p.x !== null)
  const current = d.points.find((p) => p.current)
  const askingLine = d.asking
    ? [{ yAxis: d.asking, lineStyle: { color: b.t.palette[3], type: 'dotted' }, label: { formatter: `Asking ${gbp(d.asking)}`, color: b.t.palette[3], position: 'insideStartTop' } }]
    : []
  const common = {
    ...b.common,
    animation: false,
    grid: { left: 72, right: 24, top: 24, bottom: 56 },
    yAxis: { ...b.valueAxis('Model price', b.money), scale: true, nameGap: 52 },
  }
  if (isLine)
    return {
      ...common,
      tooltip: { ...b.common.tooltip, trigger: 'axis', formatter: (ps: { value: number[] }[]) => `${d.format(ps[0].value[0])}: <b>${gbp(ps[0].value[1])}</b>` },
      xAxis: { ...b.valueAxis(d.name, { axisLabel: { color: b.t.muted, fontSize: 11, formatter: d.format } }), scale: true, nameGap: 32 },
      series: [
        {
          type: 'line',
          showSymbol: false,
          smooth: false,
          lineStyle: { color: b.t.palette[0], width: 2 },
          data: d.points.map((p) => [p.x, p.price]),
          markLine: { silent: true, symbol: 'none', data: askingLine },
          markPoint: current
            ? {
                symbol: 'circle',
                symbolSize: 10,
                itemStyle: { color: b.t.ink, borderColor: b.t.surface, borderWidth: 2 },
                label: { show: true, position: 'top', color: b.t.ink, fontSize: 11, formatter: `This car: ${gbp(current.price)}` },
                data: [{ coord: [current.x, current.price] }],
              }
            : undefined,
        },
      ],
    }
  return {
    ...common,
    tooltip: { ...b.common.tooltip, trigger: 'item', formatter: (p: { name: string; value: number }) => `${p.name}: <b>${gbp(p.value)}</b>` },
    xAxis: b.categoryAxis('', d.points.map((p) => p.label), { axisLabel: { color: b.t.muted, fontSize: 11, interval: 0, rotate: d.points.length > 6 ? 30 : 0 } }),
    series: [
      {
        type: 'bar',
        barMaxWidth: 36,
        data: d.points.map((p) => ({
          value: p.price,
          itemStyle: { color: p.current ? b.t.palette[0] : b.t.context, borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: 'top', color: p.current ? b.t.ink : b.t.muted, fontSize: 10, fontWeight: p.current ? 600 : 400, formatter: kOne(p.price) },
        })),
        markLine: { silent: true, symbol: 'none', data: askingLine },
      },
    ],
  }
}

/** Overall importance: mean |SHAP| per input across many cars, with this car's own size marked. */
export function importanceOption(b: Base, d: { names: string[]; meanAbs: number[]; thisCar: number[] }) {
  return {
    ...b.common,
    animation: false,
    legend: { ...b.common.legend, data: [{ name: 'Average over cars', icon: 'roundRect' }, { name: 'This car', icon: 'diamond' }] },
    tooltip: { ...b.common.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 150, right: 40, top: 36, bottom: 30 },
    xAxis: { type: 'value' as const, axisLabel: { color: b.t.muted, fontSize: 11, formatter: (v: number) => gbpK(v) }, splitLine: { lineStyle: { color: b.t.grid } } },
    yAxis: { type: 'category' as const, inverse: true, data: d.names, axisLabel: { color: b.t.ink, fontSize: 12 }, axisTick: { show: false }, axisLine: { show: false } },
    series: [
      {
        name: 'Average over cars',
        type: 'bar',
        barMaxWidth: 18,
        itemStyle: { color: b.t.palette[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: b.t.muted, fontSize: 11, formatter: (p: { value: number }) => gbp(p.value) },
        data: d.meanAbs,
      },
      {
        name: 'This car',
        type: 'scatter',
        symbol: 'diamond',
        symbolSize: 12,
        itemStyle: { color: b.t.ink, borderColor: b.t.surface, borderWidth: 1.5 },
        z: 5,
        data: d.thisCar,
      },
    ],
  }
}

/**
 * The beeswarm: every explained car's contribution for each input, coloured by how
 * high that input's value is for the car (numbers only), with this car outlined.
 */
export function beeswarmOption(
  b: Base,
  d: {
    names: string[]
    /** per input: [phi, jitter (−0.5..0.5), colour scale 0..1 or null] */
    points: [number, number, number | null][][]
    thisCar: number[]
    labelOf: (input: number, point: number) => string
  },
) {
  const low = b.t.palette[0]
  const high = b.t.palette[1]
  const mix = (t: number) => {
    const h = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
    const [a, c] = [h(low), h(high)]
    return `rgb(${a.map((v, i) => Math.round(v + (c[i] - v) * t)).join(',')})`
  }
  return {
    ...b.common,
    animation: false,
    tooltip: { ...b.common.tooltip, trigger: 'item', formatter: (p: { data: { tip: string } }) => p.data.tip },
    grid: { left: 150, right: 24, top: 36, bottom: 44 },
    xAxis: {
      type: 'value' as const,
      axisLine: { onZero: false, lineStyle: { color: b.t.axis } },
      name: 'Contribution to price',
      nameLocation: 'middle' as const,
      nameGap: 28,
      nameTextStyle: { color: b.t.muted, fontSize: 12 },
      axisLabel: { color: b.t.muted, fontSize: 11, formatter: (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${gbpK(Math.abs(v))}` },
      splitLine: { lineStyle: { color: b.t.grid } },
    },
    yAxis: {
      type: 'value' as const,
      inverse: true,
      min: -0.5,
      max: d.names.length - 0.5,
      axisLabel: { color: b.t.ink, fontSize: 12, customValues: d.names.map((_, i) => i), formatter: (v: number) => d.names[v] ?? '' },
      splitLine: { show: false },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [
      ...d.points.map((pts, i) => ({
        type: 'scatter',
        symbolSize: 5,
        data: pts.map(([phi, jitter, t], k) => ({
          value: [phi, i + jitter * 0.7],
          tip: `${d.names[i]}: ${d.labelOf(i, k)}<br/>${signed(phi)}`,
          itemStyle: { color: t === null ? b.t.context : mix(t), opacity: 0.75 },
        })),
      })),
      {
        type: 'scatter',
        symbol: 'diamond',
        symbolSize: 13,
        z: 5,
        itemStyle: { color: b.t.ink, borderColor: b.t.surface, borderWidth: 1.5 },
        data: d.thisCar.map((phi, i) => ({ value: [phi, i], tip: `${d.names[i]}: this car<br/>${signed(phi)}` })),
        markLine: { silent: true, symbol: 'none', lineStyle: { color: b.t.axis }, label: { show: false }, data: [{ xAxis: 0 }] },
      },
    ],
  }
}
