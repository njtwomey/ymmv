/**
 * Chart colours and shared ECharts option pieces, per theme.
 *
 * Categorical palette: the dataviz reference palette (fixed slot order, each mode
 * stepped for its own surface). Text always uses ink/muted tokens, never a
 * series colour; the neutral grey is for context layers ("rest of UK").
 */
import { useMemo } from 'react'
import { gbpK, thousands } from './format'
import { useTheme } from './theme-context'

export interface ChartTokens {
  mode: 'light' | 'dark'
  ink: string
  muted: string
  grid: string
  axis: string
  context: string
  surface: string
  border: string
  palette: string[]
}

const LIGHT: ChartTokens = {
  mode: 'light',
  ink: '#0b0b0b',
  muted: '#52514e',
  grid: '#ebeae6',
  axis: '#c3c2b7',
  context: '#9a9993',
  surface: '#ffffff',
  border: '#e2e1dc',
  palette: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
}

const DARK: ChartTokens = {
  mode: 'dark',
  ink: '#f0efec',
  muted: '#c3c2b7',
  grid: '#2e2e2c',
  axis: '#4d4c48',
  context: '#6f6e69',
  surface: '#1c1c1b',
  border: '#3a3a37',
  palette: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
}

export function useChartTokens(): ChartTokens {
  const { resolved } = useTheme()
  return resolved === 'dark' ? DARK : LIGHT
}

/** Colour for a level, following the entity (its position in a stable level order), never its rank. */
export function colourFor(t: ChartTokens, order: string[], level: string): string {
  const i = order.indexOf(level)
  return i >= 0 && i < t.palette.length ? t.palette[i] : t.context
}

export function useBase() {
  const t = useChartTokens()
  return useMemo(() => base(t), [t])
}

export function base(t: ChartTokens) {
  const axisCommon = {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { lineStyle: { color: t.axis } },
    axisLabel: { color: t.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid } },
    nameTextStyle: { color: t.muted, fontSize: 12 },
    nameLocation: 'middle' as const,
  }
  return {
    t,
    common: {
      backgroundColor: 'transparent',
      textStyle: { color: t.ink, fontFamily: 'inherit' },
      animationDuration: 300,
      tooltip: {
        backgroundColor: t.surface,
        borderColor: t.border,
        textStyle: { color: t.ink, fontSize: 12 },
        extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,.12); border-radius: 8px;',
      },
      legend: { textStyle: { color: t.muted, fontSize: 12 }, icon: 'circle', itemWidth: 10, itemHeight: 10, top: 0 },
      grid: { left: 64, right: 24, top: 40, bottom: 52, containLabel: false },
    },
    valueAxis: (name: string, extra: object = {}) => ({ type: 'value' as const, name, nameGap: 44, ...axisCommon, ...extra }),
    categoryAxis: (name: string, data: (string | number)[], extra: object = {}) => ({
      type: 'category' as const,
      name,
      nameGap: 32,
      data,
      ...axisCommon,
      splitLine: { show: false },
      ...extra,
    }),
    money: { axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => gbpK(v) } },
    miles: { axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => thousands(v) } },
  }
}
