import { BarChart, BoxplotChart, CustomChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'
import { useTheme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'

echarts.use([
  BarChart,
  BoxplotChart,
  CustomChart,
  LineChart,
  ScatterChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
])

export type EChartsOption = echarts.EChartsCoreOption

/** Data items may carry a listing `id`; clicking such a point calls onPick(id). */
export function EChart({
  option,
  height = 360,
  className,
  onPick,
}: {
  option: EChartsOption
  height?: number
  className?: string
  onPick?: (id: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const pick = useRef(onPick)
  useEffect(() => {
    pick.current = onPick
  }, [onPick])
  const { resolved } = useTheme()

  // (Re)create the chart per theme so every colour is rebuilt from the theme's tokens.
  useEffect(() => {
    const el = ref.current!
    const c = echarts.init(el, undefined, { renderer: 'canvas' })
    chart.current = c
    c.on('click', (p) => {
      const id = (p.data as { id?: number } | undefined)?.id
      if (typeof id === 'number') pick.current?.(id)
    })
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [resolved])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option, resolved])

  return <div ref={ref} className={cn('w-full min-w-0', className)} style={{ height }} />
}
