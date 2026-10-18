/** Find a car to explain: search the filtered cars, or jump to an interesting one. */
import { ChevronsUpDown, Dices, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ChartCard } from '@/components/ChartCard'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { gbp, miles, pct } from '@/lib/format'
import type { Row } from '@/lib/types'

export function ExplainPicker({
  rows,
  predictions,
  onExplain,
}: {
  rows: Row[]
  /** listing id → model prediction (£) */
  predictions: Map<number, number>
  onExplain: (row: Row) => void
}) {
  const [open, setOpen] = useState(false)
  const cars = useMemo(() => rows.filter((r) => r.price_gbp !== null && predictions.has(r.id)), [rows, predictions])
  const byGap = useMemo(
    () =>
      cars
        .filter((r) => r.status === 'active')
        .map((r) => ({ r, gap: r.price_gbp! / predictions.get(r.id)! - 1 }))
        .sort((a, b) => a.gap - b.gap),
    [cars, predictions],
  )
  const under = byGap[0]
  const over = byGap[byGap.length - 1]

  return (
    <ChartCard
      title="Explain a price"
      description="Pick any car to see why the model prices it as it does: a SHAP breakdown from the average car to this one."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="w-72 max-w-full justify-between font-normal" aria-expanded={open}>
              Find a car ({cars.length.toLocaleString()})… <ChevronsUpDown className="opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(36rem,calc(100vw-2rem))] p-0" align="start">
            <Command>
              <CommandInput placeholder="Year, variant, place, plate…" />
              <CommandList>
                <CommandEmpty>No car matches.</CommandEmpty>
                <CommandGroup>
                  {cars.slice(0, 2000).map((r) => (
                    <CommandItem
                      key={r.id}
                      value={`${r.id} ${r.year} ${r.variant} ${r.location} ${r.plate ?? ''} ${r.trim_label}`}
                      onSelect={() => {
                        setOpen(false)
                        onExplain(r)
                      }}
                    >
                      <span className="truncate">
                        {r.year} {r.variant}
                      </span>
                      <span className="ml-auto pl-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {miles(r.mileage)} · {gbp(r.price_gbp)} · {r.location}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {under && (
          <Button size="sm" variant="ghost" onClick={() => onExplain(under.r)} title={`${under.r.year} ${under.r.variant}`}>
            <TrendingDown /> Most underpriced ({pct(under.gap)})
          </Button>
        )}
        {over && over !== under && (
          <Button size="sm" variant="ghost" onClick={() => onExplain(over.r)} title={`${over.r.year} ${over.r.variant}`}>
            <TrendingUp /> Most overpriced ({pct(over.gap)})
          </Button>
        )}
        {cars.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onExplain(cars[Math.floor(Math.random() * cars.length)])}>
            <Dices /> Random car
          </Button>
        )}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Sparkles className="size-3.5" /> Also: “Why this price?” in any car’s drawer, and under Price a car.
        </span>
      </div>
    </ChartCard>
  )
}
