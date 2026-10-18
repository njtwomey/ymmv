/**
 * Click-to-build model formulas: pick the response, add features (with transforms
 * or a reference level), add interactions, and remove terms from the chip list.
 * Every click refits straight away; the text box stays available for anything else.
 */
import { Check, ChevronDown, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FORMULA_ALIASES, FORMULA_FEATURES, type FormulaFeature } from '@/lib/data'
import { addTerm, numericVariants, partsOf, removeTerm, setIntercept, setResponse, withReference } from '@/lib/formulaEdit'
import type { Row } from '@/lib/types'
import { cn } from '@/lib/utils'

const RESPONSES = [
  { value: 'log(price)', hint: 'Effects are % changes in price (usually the better fit)' },
  { value: 'price', hint: 'Effects are £ changes in price' },
  { value: 'sqrt(price)', hint: 'In between: dampens expensive outliers' },
]

function levelsOf(rows: Row[], name: string): string[] {
  const col = FORMULA_ALIASES[name] ?? name
  const counts = new Map<string, number>()
  for (const r of rows) {
    const v = (r as unknown as Record<string, unknown>)[col]
    if (v !== null && v !== undefined && v !== '') counts.set(String(v), (counts.get(String(v)) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([v]) => v)
}

/** Terms that use a feature in any form: `trim`, `C(engine_l)`, `log1p(mileage)`, `age:trim`… */
const termsUsing = (terms: string[], name: string) => terms.filter((t) => new RegExp(`\\b${name}\\b`).test(t))

function FeatureButton({
  feature,
  using,
  onToggle,
  onAdd,
  levels,
}: {
  feature: FormulaFeature
  using: string[]
  onToggle: () => void
  onAdd: (term: string) => void
  levels: string[]
}) {
  const x = feature.name
  const active = using.length > 0
  return (
    <div className="inline-flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={active ? 'secondary' : 'outline'}
            size="sm"
            className={cn('rounded-r-none font-mono', active && 'border border-transparent')}
            onClick={onToggle}
            aria-pressed={active}
          >
            {active ? <Check /> : <Plus />}
            {x}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {feature.hint}. {active ? `Click to remove ${using.join(', ')}.` : 'Click to add.'}
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="-ml-px rounded-l-none px-1" aria-label={`More ways to add ${x}`}>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        {/* The default menu width is the trigger's (here a tiny ▾), so size to the content instead. */}
        <DropdownMenuContent align="start" className="max-h-80 w-auto min-w-72 overflow-y-auto">
          {feature.kind === 'number' ? (
            <>
              <DropdownMenuLabel>Add {x} as…</DropdownMenuLabel>
              {numericVariants(x).map((v) => (
                <DropdownMenuItem key={v.term} onSelect={() => onAdd(v.term)}>
                  <code className="text-xs">{v.term}</code>
                  <span className="ml-auto pl-6 text-xs whitespace-nowrap text-muted-foreground">{v.label}</span>
                </DropdownMenuItem>
              ))}
            </>
          ) : (
            <>
              <DropdownMenuLabel>Compare against (reference level)</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => onAdd(x)}>
                <code className="text-xs">{x}</code>
                <span className="ml-auto pl-6 text-xs whitespace-nowrap text-muted-foreground">most common level</span>
              </DropdownMenuItem>
              {levels.length > 0 && <DropdownMenuSeparator />}
              {levels.map((l) => (
                <DropdownMenuItem key={l} onSelect={() => onAdd(withReference(x, l))}>
                  {l}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function FormulaBuilder({
  formula,
  rows,
  standardise,
  onStandardise,
  onApply,
}: {
  formula: string
  rows: Row[]
  standardise: boolean
  onStandardise: (on: boolean) => void
  onApply: (formula: string) => void
}) {
  const parts = useMemo(() => {
    try {
      return partsOf(formula)
    } catch {
      return null
    }
  }, [formula])
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const levels = useMemo(
    () => Object.fromEntries(FORMULA_FEATURES.filter((f) => f.kind === 'category').map((f) => [f.name, levelsOf(rows, f.name)])),
    [rows],
  )

  if (!parts) return <p className="text-xs text-muted-foreground">Fix the formula text below to use the builder.</p>

  const edit = (fn: (text: string) => string) => {
    try {
      onApply(fn(formula))
    } catch {
      /* the builder only offers valid edits; ignore anything the parser still rejects */
    }
  }
  const groups: [string, FormulaFeature[]][] = [
    ['Numbers', FORMULA_FEATURES.filter((f) => f.kind === 'number')],
    ['Categories', FORMULA_FEATURES.filter((f) => f.kind === 'category')],
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Predict</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={RESPONSES.some((r) => r.value === parts.response) ? parts.response : ''}
            onValueChange={(v) => v && edit((t) => setResponse(t, v))}
          >
            {RESPONSES.map((r) => (
              // The tooltip wraps a span: as the item's own trigger it would overwrite data-state="on".
              <Tooltip key={r.value}>
                <TooltipTrigger asChild>
                  <span>
                    <ToggleGroupItem value={r.value} className="font-mono">
                      {r.value}
                    </ToggleGroupItem>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{r.hint}</TooltipContent>
              </Tooltip>
            ))}
          </ToggleGroup>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={parts.intercept} onCheckedChange={(on) => edit((t) => setIntercept(t, on))} />
          Intercept
        </label>
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={standardise} onCheckedChange={onStandardise} />
              Standardise numbers
            </label>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            Centre and scale numeric features so each coefficient is the effect of a 1-SD change, comparable across features.
            Predictions don’t change.
          </TooltipContent>
        </Tooltip>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">In the model ({parts.terms.length})</p>
        <div className="flex flex-wrap gap-1.5">
          {parts.terms.length === 0 && <span className="text-xs text-muted-foreground">Nothing yet: add features below.</span>}
          {parts.terms.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-md border bg-muted/50 py-0.5 pr-0.5 pl-2 font-mono text-xs">
              {t}
              <Button variant="ghost" size="icon-xs" aria-label={`Remove ${t}`} onClick={() => edit((x) => removeTerm(x, t))}>
                <X />
              </Button>
            </span>
          ))}
        </div>
      </div>

      {groups.map(([title, features]) => (
        <div key={title}>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            {title} <span className="font-normal">· click to add or remove, ▾ for more</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {features.map((f) => (
              <FeatureButton
                key={f.name}
                feature={f}
                using={termsUsing(parts.terms, f.name)}
                levels={levels[f.name] ?? []}
                onToggle={() => {
                  const using = termsUsing(parts.terms, f.name)
                  edit((t) => (using.length ? using.reduce(removeTerm, t) : addTerm(t, f.name)))
                }}
                onAdd={(term) => edit((t) => addTerm(t, term))}
              />
            ))}
          </div>
        </div>
      ))}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Interaction <span className="font-normal">· lets one feature’s effect depend on another, e.g. mileage hurting JCWs more</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {[
            [a, setA],
            [b, setB],
          ].map(([value, set], i) => (
            <Select key={i} value={value as string} onValueChange={set as (v: string) => void}>
              <SelectTrigger size="sm" className="w-40 font-mono" aria-label={`Interaction feature ${i + 1}`}>
                <SelectValue placeholder={i === 0 ? 'feature' : 'with'} />
              </SelectTrigger>
              <SelectContent>
                {FORMULA_FEATURES.map((f) => (
                  <SelectItem key={f.name} value={f.name} className="font-mono">
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
          <Button size="sm" variant="outline" disabled={!a || !b || a === b} onClick={() => edit((t) => addTerm(t, `${a}:${b}`))}>
            <Plus /> Add <code>{a && b && a !== b ? `${a}:${b}` : 'a:b'}</code>
          </Button>
        </div>
      </div>
    </div>
  )
}
