import { parseDate } from './data'

export const gbp = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '–' : `£${Math.round(v).toLocaleString('en-GB')}`

export const gbpK = (v: number) => {
  if (!Number.isFinite(v)) return '–'
  if (Math.abs(v) < 1000) return `£${Math.round(v)}`
  return `£${(v / 1000).toFixed(Math.abs(v) < 10_000 && v % 1000 !== 0 ? 1 : 0)}k`
}

export const thousands = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))

export const miles = (v: number | null | undefined) =>
  v == null ? '–' : `${Math.round(v).toLocaleString('en-GB')} mi`

export const pct = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(digits)}%`

/** A price gap as words: 0.12 → "12% above", −0.43 → "43% below". */
export const gapText = (gap: number) => `${Math.abs(gap * 100).toFixed(0)}% ${gap < 0 ? 'below' : 'above'}`

export const num = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? '–' : v.toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits })

export function pValue(p: number): string {
  if (!Number.isFinite(p)) return '–'
  return p < 0.001 ? '<0.001' : p.toFixed(3)
}

export function relTime(s: string | Date | null | undefined): string {
  const d = s instanceof Date ? s : parseDate(s ?? null)
  if (!d) return '–'
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 36) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

export function shortDate(s: string | null | undefined): string {
  const d = parseDate(s ?? null)
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '–'
}
