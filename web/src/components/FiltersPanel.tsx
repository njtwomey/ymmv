import { Info, ListX, RotateCcw, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { ChipGroup } from '@/components/ChipGroup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { MARKS, sourceLabel } from '@/lib/config'
import { levelLabel } from '@/lib/dims'
import { DEFAULT_FILTERS, NO_FILTERS, type FilterOptions, type Filters } from '@/lib/filters'

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</Label>
      {hint && (
        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <Info className="mt-px size-3 shrink-0" aria-hidden />
          {hint}
        </p>
      )}
      {children}
    </div>
  )
}

function NumberInput({
  value,
  onChange,
  placeholder,
  prefix,
}: {
  value: number | null
  onChange: (v: number | null) => void
  placeholder: string
  prefix?: string
}) {
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span>}
      <Input
        type="number"
        inputMode="numeric"
        className={prefix ? 'h-8 pl-6 text-sm' : 'h-8 text-sm'}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </div>
  )
}

export function FiltersPanel({
  filters,
  onChange,
  options,
  shown,
  total,
}: {
  filters: Filters
  onChange: (f: Filters) => void
  options: FilterOptions
  shown: number
  total: number
}) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...filters, [k]: v })
  const [lo, hi] = options.years
  const reset = () => onChange({ ...DEFAULT_FILTERS, radius: filters.radius, place: filters.place })
  const showAll = () => onChange({ ...NO_FILTERS, radius: filters.radius, place: filters.place })

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{shown.toLocaleString()}</span>
          <span className="text-muted-foreground"> of {total.toLocaleString()} listings</span>
        </p>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={showAll} title="Remove every filter">
            <ListX /> Show all
          </Button>
          <Button variant="ghost" size="sm" onClick={reset} title="Back to the default filters">
            <RotateCcw /> Reset
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-8 text-sm"
          placeholder="Search variant, place, plate…"
          value={filters.q}
          onChange={(e) => set('q', e.target.value)}
        />
      </div>

      <Section title="Status">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filters.status}
          onValueChange={(v) => v && set('status', v as Filters['status'])}
          className="w-full"
        >
          <ToggleGroupItem value="all" className="flex-1 text-xs">All</ToggleGroupItem>
          <ToggleGroupItem value="active" className="flex-1 text-xs">For sale</ToggleGroupItem>
          <ToggleGroupItem value="delisted" className="flex-1 text-xs">Sold</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Label htmlFor="reserved" className="text-sm font-normal">Include cars with no price</Label>
          <Switch id="reserved" checked={filters.reserved} onCheckedChange={(v) => set('reserved', v)} />
        </div>
      </Section>

      <Section title="Write-offs">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filters.writeoffs}
          onValueChange={(v) => v && set('writeoffs', v as Filters['writeoffs'])}
          className="w-full"
        >
          <ToggleGroupItem value="include" className="flex-1 text-xs">Include</ToggleGroupItem>
          <ToggleGroupItem value="exclude" className="flex-1 text-xs">Exclude</ToggleGroupItem>
          <ToggleGroupItem value="only" className="flex-1 text-xs">Only</ToggleGroupItem>
        </ToggleGroup>
      </Section>

      <Section title="Marked">
        <Select value={filters.marked} onValueChange={(v) => set('marked', v as Filters['marked'])}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All listings</SelectItem>
            <SelectItem value="any">Any mark</SelectItem>
            {MARKS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                <m.icon className={m.className} /> {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>

      <Separator />

      <Section title="Source">
        <ChipGroup options={options.sources} value={filters.sources} onChange={(v) => set('sources', v)} label={sourceLabel} />
      </Section>
      <Section title="Trim" hint="Performance tier parsed from the variant name (patterns in cars.yaml).">
        <ChipGroup options={options.trims} value={filters.trims} onChange={(v) => set('trims', v)} />
      </Section>
      <Section title="Fuel">
        <ChipGroup options={options.fuels} value={filters.fuels} onChange={(v) => set('fuels', v)} />
      </Section>
      <Section title="Gearbox">
        <ChipGroup options={options.transmissions} value={filters.transmissions} onChange={(v) => set('transmissions', v)} />
      </Section>
      <Section title="Seller">
        <ChipGroup
          options={options.sellers}
          value={filters.sellers}
          onChange={(v) => set('sellers', v)}
          label={(v) => levelLabel('seller_type', v)}
        />
      </Section>

      <Section title={`Registration year: ${filters.yearMin ?? lo}–${filters.yearMax ?? hi}`}>
        <Slider
          min={lo}
          max={hi}
          step={1}
          value={[Math.max(filters.yearMin ?? lo, lo), Math.min(filters.yearMax ?? hi, hi)]}
          onValueChange={([a, b]) => onChange({ ...filters, yearMin: a <= lo ? null : a, yearMax: b >= hi ? null : b })}
          className="py-1"
        />
      </Section>

      <Section title="Price">
        <div className="grid grid-cols-2 gap-2">
          <NumberInput prefix="£" placeholder="Min" value={filters.priceMin} onChange={(v) => set('priceMin', v)} />
          <NumberInput prefix="£" placeholder="Max" value={filters.priceMax} onChange={(v) => set('priceMax', v)} />
        </div>
      </Section>
      <div className="grid grid-cols-2 gap-2">
        <Section title="Max mileage">
          <NumberInput placeholder="Any" value={filters.maxMileage} onChange={(v) => set('maxMileage', v)} />
        </Section>
        <Section title="Within (mi)">
          <NumberInput placeholder="Any" value={filters.withinMiles} onChange={(v) => set('withinMiles', v)} />
        </Section>
      </div>

      <Separator />

      <Section title="Local area">
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <Input className="h-8 text-sm" value={filters.place} onChange={(e) => set('place', e.target.value || DEFAULT_FILTERS.place)} aria-label="Place name" />
          <NumberInput placeholder="30" value={filters.radius} onChange={(v) => set('radius', v ?? DEFAULT_FILTERS.radius)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Cars within {filters.radius} miles of the scrape postcode count as “near {filters.place}”.
        </p>
      </Section>
    </div>
  )
}
