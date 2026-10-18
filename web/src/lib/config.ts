import type { LucideIcon } from 'lucide-react'
import { Eye, Phone, Star, ThumbsDown } from 'lucide-react'
import type { MarkValue } from './types'

export const APP_NAME = 'YMMV'
export const TAGLINE = 'your mileage may vary'

/** Found by the Optimise search on 2026-10-18 (lowest held-out RMSE on the default filters). */
export const DEFAULT_FORMULA =
  'sqrt(price) ~ C(year) + mileage + engine_l + local + trim + seller_type + trim:log1p(mileage) + trim:age + C(engine_l):age'

export const MARKS: { value: MarkValue; label: string; icon: LucideIcon; className: string }[] = [
  { value: 'interesting', label: 'Interesting', icon: Star, className: 'text-amber-500' },
  { value: 'want_more', label: 'Want to see more', icon: Eye, className: 'text-sky-500' },
  { value: 'contacted', label: 'Contacted', icon: Phone, className: 'text-emerald-500' },
  { value: 'rejected', label: 'Rejected', icon: ThumbsDown, className: 'text-muted-foreground' },
]

export const markInfo = (mark: MarkValue | null) => MARKS.find((m) => m.value === mark) ?? null

export const SOURCE_LABELS: Record<string, string> = {
  autotrader: 'AutoTrader UK',
  onlymini: 'Only Mini',
}

export const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s

/** The source the "other sources vs the model" comparison is fitted on. */
export const MODEL_SOURCE = 'autotrader'
