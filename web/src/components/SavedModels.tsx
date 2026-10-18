/** Save the current model setup (filters + formula + scores) to the database, and load or delete saved ones. */
import { Check, ChevronDown, Library, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, READ_ONLY } from '@/lib/api'
import { parseDate } from '@/lib/data'
import type { Filters } from '@/lib/filters'
import { gbp, num } from '@/lib/format'
import { metricsOf, type ModelResult } from '@/lib/model'
import type { ModelMetrics, SavedModel } from '@/lib/types'

const summary = (m: ModelMetrics) =>
  [
    m.cv_rmse != null ? `CV RMSE ${gbp(m.cv_rmse)}` : null,
    m.cv_r2 != null ? `CV R² ${num(m.cv_r2, 3)}` : `R² ${num(m.r2, 3)}`,
    `${m.n.toLocaleString()} cars`,
    `${m.k} coefs`,
  ]
    .filter(Boolean)
    .join(' · ')

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function SavedModels({
  car,
  filters,
  formula,
  folds,
  standardise,
  model,
  onLoad,
}: {
  car: string | null
  filters: Filters
  formula: string
  folds: number
  standardise: boolean
  model: ModelResult | null
  /** apply a saved model: its filters, formula and settings */
  onLoad: (m: SavedModel) => void
}) {
  const [saved, setSaved] = useState<SavedModel[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')

  const refresh = useCallback(
    () =>
      api
        .models(car)
        .then((ms) => (setSaved(ms), setError(null)))
        .catch((e: Error) => setError(e.message)),
    [car],
  )
  useEffect(() => {
    void refresh()
  }, [refresh])

  const isCurrent = (m: SavedModel) => m.formula === formula && m.folds === folds && m.standardise === standardise && same(m.filters, filters)
  const defaultName = model ? `${formula.split('~')[0].trim()} · ${summary(metricsOf(model)).split(' · ')[0]}` : ''

  const save = async () => {
    if (!model) return
    try {
      await api.saveModel({ name: name.trim() || defaultName, car_id: car, formula, folds, standardise, filters: { ...filters }, metrics: metricsOf(model) })
      setSaving(false)
      setName('')
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const remove = async (id: number) => {
    try {
      await api.deleteModel(id)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <Library /> Saved models ({saved.length}) <ChevronDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-96 w-[min(34rem,calc(100vw-2rem))] overflow-y-auto">
          <DropdownMenuLabel>Load a saved model (its filters, formula and settings)</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {saved.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">Nothing saved yet: use Save model.</p>}
          {saved.map((m) => (
            <DropdownMenuItem key={m.id} className="items-start gap-2" onSelect={() => onLoad(m)}>
              <Check className={isCurrent(m) ? 'mt-0.5' : 'invisible mt-0.5'} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{m.formula}</p>
                <p className="text-xs text-muted-foreground">
                  {summary(m.metrics)} · {parseDate(m.created_at)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </p>
              </div>
              {!READ_ONLY && <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Delete ${m.name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  void remove(m.id)
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Trash2 />
              </Button>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {!READ_ONLY && <Popover open={saving} onOpenChange={(o) => (setSaving(o), o && setName(''))}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" disabled={!model}>
            <Save /> Save model
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-2">
          <p className="text-sm font-medium">Save this model</p>
          <p className="text-xs text-muted-foreground">Saves the current filters, formula and settings with their scores ({model ? summary(metricsOf(model)) : '–'}).</p>
          <Input
            autoFocus
            className="h-8 text-sm"
            placeholder={defaultName}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void save()}>
              <Save /> Save
            </Button>
          </div>
        </PopoverContent>
      </Popover>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
