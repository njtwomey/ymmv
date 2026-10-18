/** "Price a car": enter a car's details and get the fitted model's price, with a 95% range. */
import { RotateCcw, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ChartCard } from '@/components/ChartCard'
import type { ExplainTarget } from '@/components/ExplainDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FORMULA_FEATURES } from '@/lib/data'
import { type Dim, levelLabel } from '@/lib/dims'
import { gapText, gbp } from '@/lib/format'
import type { ModelResult } from '@/lib/model'
import { priceFields, referenceYear, rowFromValues } from '@/lib/pricer'
import type { Row } from '@/lib/types'
import { cn } from '@/lib/utils'

const LABELS: Record<string, string> = {
  year: 'Registration year',
  mileage: 'Mileage',
  engine_l: 'Engine (litres)',
  engine: 'Engine (litres)',
  trim: 'Trim',
  fuel: 'Fuel',
  transmission: 'Gearbox',
  gearbox: 'Gearbox',
  seller_type: 'Seller',
  seller: 'Seller',
  local: 'Location',
  writeoff: 'Write-off',
  distance_miles: 'Distance (miles)',
}
const DIM_OF: Record<string, Dim> = { seller_type: 'seller_type', seller: 'seller_type', local: 'local', rating: 'rating', source: 'source' }

export function PriceCarCard({
  model,
  rows,
  place,
  onExplain,
}: {
  model: ModelResult
  rows: Row[]
  place: string
  onExplain: (target: ExplainTarget) => void
}) {
  const fields = useMemo(() => priceFields(model, rows), [model, rows])
  const refYear = useMemo(() => referenceYear(rows), [rows])
  const [values, setValues] = useState<Record<string, string>>({})
  const [asking, setAsking] = useState('')
  const value = (name: string) => values[name] ?? fields.find((f) => f.name === name)?.default ?? ''

  const row = useMemo(() => rowFromValues(fields, values, refYear), [fields, values, refYear])
  const result = useMemo(() => model.predictInterval(row, 0.95), [model, row])
  const askingPrice = Number(asking.replace(/[£,\s]/g, ''))
  const gap = result && askingPrice > 0 ? askingPrice / result.fit - 1 : null
  const outside = fields.filter((f) => {
    if (f.kind !== 'number' || !f.range) return false
    const v = Number(value(f.name))
    return Number.isFinite(v) && (v < f.range[0] || v > f.range[1])
  })

  return (
    <ChartCard
      title="Price a car"
      description="Enter a car’s details to get the current model’s price. The fields follow the formula: change the model and they change too."
      actions={
        <Button size="sm" variant="ghost" onClick={() => (setValues({}), setAsking(''))}>
          <RotateCcw /> Typical car
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid grid-cols-2 content-start gap-3 sm:grid-cols-3">
          {fields.map((f) => {
            const label = LABELS[f.name] ?? f.name
            const hint = FORMULA_FEATURES.find((x) => x.name === f.name)?.hint
            const dim = DIM_OF[f.name]
            return (
              <label key={f.name} className="grid gap-1 text-xs text-muted-foreground" title={hint}>
                {label}
                {f.kind === 'category' ? (
                  <Select value={value(f.name)} onValueChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))}>
                    <SelectTrigger size="sm" className="w-full text-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => (
                        <SelectItem key={o} value={o}>
                          {dim ? levelLabel(dim, o, place) : o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    className="h-7 text-sm text-foreground tabular-nums"
                    type="number"
                    inputMode="numeric"
                    value={value(f.name)}
                    onChange={(e) => setValues((s) => ({ ...s, [f.name]: e.target.value }))}
                  />
                )}
              </label>
            )
          })}
          <label className="grid gap-1 text-xs text-muted-foreground">
            Asking price (optional)
            <Input
              className="h-7 text-sm text-foreground tabular-nums"
              inputMode="numeric"
              placeholder="£"
              value={asking}
              onChange={(e) => setAsking(e.target.value)}
            />
          </label>
        </div>

        <div className="rounded-lg border bg-muted/30 p-4">
          {result ? (
            <>
              <p className="text-xs text-muted-foreground">Model price</p>
              <p className="font-heading text-3xl font-semibold tabular-nums">{gbp(result.fit)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                95% range {gbp(result.lo)} – {gbp(result.hi)}
              </p>
              {gap !== null && (
                <p className={cn('mt-3 text-sm font-medium', gap < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                  Asking {gbp(askingPrice)} is {gapText(gap)} the model
                </p>
              )}
              {outside.length > 0 && (
                <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                  {outside.map((f) => LABELS[f.name] ?? f.name).join(', ')} outside the data the model was fitted on, so this is extrapolating.
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() =>
                  onExplain({
                    title: 'The car you entered',
                    subtitle: fields.map((f) => `${LABELS[f.name] ?? f.name}: ${f.kind === 'category' && DIM_OF[f.name] ? levelLabel(DIM_OF[f.name], value(f.name), place) : value(f.name)}`).join(' · '),
                    row,
                    asking: askingPrice > 0 ? askingPrice : null,
                  })
                }
              >
                <Sparkles /> Why this price?
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                The range covers where 95% of similar cars’ asking prices would fall: model uncertainty plus car-to-car variation.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              The model can’t price this combination: a value it never saw while fitting, or a response that can’t be turned back into £.
            </p>
          )}
        </div>
      </div>
    </ChartCard>
  )
}
