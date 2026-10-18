/** Best value: cars ranked by how far their asking price sits below the model, with filters, sorting and paging. */
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ExternalLink, PanelRight, RotateCcw, Search } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { ChartCard } from '@/components/ChartCard'
import { WriteoffBadge } from '@/components/ListingBadges'
import { MarkMenu } from '@/components/MarkControl'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { gbp, miles, pct } from '@/lib/format'
import type { MarkValue, Row } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface Gap {
  r: Row
  /** model prediction (£) */
  pred: number
  /** asking / prediction − 1 */
  gap: number
}

const PAGE = 50
type SortKey = 'gap' | 'variant' | 'year' | 'mileage' | 'price' | 'model' | 'distance'

interface Criteria {
  q: string
  minYear: string
  maxYear: string
  maxMileage: string
  minPrice: string
  maxPrice: string
  minModel: string
  maxModel: string
  maxDistance: string
  /** in %, e.g. "-10" = at least 10% below the model */
  maxGap: string
  sold: boolean
}
const NONE: Criteria = { q: '', minYear: '', maxYear: '', maxMileage: '', minPrice: '', maxPrice: '', minModel: '', maxModel: '', maxDistance: '', maxGap: '', sold: false }

const num = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s))

const NO_SPINNER = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

const FIELD =
  'h-7 w-full min-w-0 bg-transparent px-1.5 text-xs font-normal text-foreground tabular-nums outline-none placeholder:text-muted-foreground'
const BOX =
  'flex h-7 items-center rounded-md border border-input bg-transparent focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30'

/** A joined lower–upper pair in one box, so it reads as a single range. */
function RangeInput({ label, from, to, onFrom, onTo }: { label: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <div className={cn(BOX, 'ml-auto w-28')}>
      <input className={cn(FIELD, NO_SPINNER)} type="number" inputMode="numeric" placeholder="from" aria-label={`${label} from`} value={from} onChange={(e) => onFrom(e.target.value)} />
      <span className="text-muted-foreground" aria-hidden>
        –
      </span>
      <input className={cn(FIELD, NO_SPINNER)} type="number" inputMode="numeric" placeholder="to" aria-label={`${label} to`} value={to} onChange={(e) => onTo(e.target.value)} />
    </div>
  )
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  numeric = true,
  left = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  numeric?: boolean
  /** sit at the left of the column (for left-aligned columns); numbers sit right by default */
  left?: boolean
}) {
  return (
    <div className={cn(BOX, numeric ? 'w-16' : 'w-36', numeric && !left && 'ml-auto')}>
      {!numeric && <Search className="ml-2 size-3.5 shrink-0 text-muted-foreground" />}
      <input
        className={cn(FIELD, numeric && NO_SPINNER)}
        type={numeric ? 'number' : 'text'}
        inputMode={numeric ? 'numeric' : undefined}
        placeholder={placeholder}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function SortHead({
  k,
  sort,
  onSort,
  right,
  children,
}: {
  k: SortKey
  sort: { key: SortKey; dir: 1 | -1 }
  onSort: (k: SortKey) => void
  right?: boolean
  children: ReactNode
}) {
  return (
    <TableHead className={cn(right && 'text-right')}>
      <button className={cn('inline-flex items-center gap-1 hover:text-foreground', sort.key === k && 'text-foreground')} onClick={() => onSort(k)}>
        {children}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </TableHead>
  )
}

export function BestValueTable({
  gaps,
  predLabel,
  onPick,
  onMark,
  onExplain,
}: {
  gaps: Gap[]
  predLabel: string
  onPick: (id: number) => void
  onMark: (id: number, mark: MarkValue | null) => void
  /** open the SHAP "why this price?" explanation */
  onExplain: (row: Row) => void
}) {
  const [c, setC] = useState<Criteria>(NONE)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'gap', dir: 1 })
  const [page, setPage] = useState(0)
  const set = <K extends keyof Criteria>(k: K, v: Criteria[K]) => {
    setC((x) => ({ ...x, [k]: v }))
    setPage(0)
  }
  const onSort = (k: SortKey) => {
    // Cheapest / smallest first by default for gap, price, mileage and distance; newest first for year.
    setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : k === 'year' || k === 'model' ? -1 : 1 }))
    setPage(0)
  }

  const filtered = useMemo(() => {
    const words = c.q.toLowerCase().split(/\s+/).filter(Boolean)
    const within = (v: number | null, lo: number | null, hi: number | null) =>
      (lo === null || (v !== null && v >= lo)) && (hi === null || (v !== null && v <= hi))
    const maxGap = num(c.maxGap)
    return gaps.filter(({ r, pred, gap }) => {
      if (!c.sold && r.status !== 'active') return false
      if (!within(r.year, num(c.minYear), num(c.maxYear))) return false
      if (!within(r.mileage, null, num(c.maxMileage))) return false
      if (!within(r.price_gbp, num(c.minPrice), num(c.maxPrice))) return false
      if (!within(pred, num(c.minModel), num(c.maxModel))) return false
      if (!within(r.distance_miles, null, num(c.maxDistance))) return false
      if (maxGap !== null && gap * 100 > maxGap) return false
      if (words.length) {
        const hay = [r.year, r.variant, r.trim_label, r.location, r.seller_type, r.fuel, r.transmission, r.colour, r.writeoff]
          .filter((v) => v !== null && v !== undefined)
          .join(' ')
          .toLowerCase()
        if (!words.every((w) => hay.includes(w))) return false
      }
      return true
    })
  }, [gaps, c])

  const sorted = useMemo(() => {
    const value = ({ r, pred, gap }: Gap): number | string | null => {
      switch (sort.key) {
        case 'variant': return r.variant
        case 'gap': return gap
        case 'year': return r.year
        case 'mileage': return r.mileage
        case 'price': return r.price_gbp
        case 'model': return pred
        case 'distance': return r.distance_miles
      }
    }
    return [...filtered].sort((a, b) => {
      const x = value(a)
      const y = value(b)
      if (x === y) return a.r.id - b.r.id
      if (x === null) return 1 // unknowns last either way
      if (y === null) return -1
      return (x < y ? -1 : 1) * sort.dir
    })
  }, [filtered, sort])

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE))
  const current = Math.min(page, pages - 1) // the list can shrink when the sidebar filters or model change
  const shown = sorted.slice(current * PAGE, current * PAGE + PAGE)
  const active = Object.entries(c).some(([k, v]) => (k === 'sold' ? v : v !== ''))

  return (
    <ChartCard
      title="Best value"
      description={`Cars ranked by how far their asking price sits from their ${predLabel} prediction (biggest bargains first; click Gap to flip). Check write-offs and photos before getting excited.`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>Click a car to see why it’s priced as it is. Filter in the row under the headings; click a heading to sort.</span>
        <label className="ml-auto flex items-center gap-2">
          <Switch checked={c.sold} onCheckedChange={(v) => set('sold', v)} />
          Sold too
        </label>
        {active && (
          <Button size="sm" variant="ghost" onClick={() => (setC(NONE), setPage(0))}>
            <RotateCcw /> Reset filters
          </Button>
        )}
      </div>

      <>
          <div className="max-w-full overflow-x-auto">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <SortHead sort={sort} onSort={onSort} k="variant">Car</SortHead>
                  <SortHead sort={sort} onSort={onSort} k="year" right>
                    Year
                  </SortHead>
                  <SortHead sort={sort} onSort={onSort} k="mileage" right>
                    Mileage
                  </SortHead>
                  <SortHead sort={sort} onSort={onSort} k="price" right>
                    Price
                  </SortHead>
                  <SortHead sort={sort} onSort={onSort} k="model" right>
                    Model
                  </SortHead>
                  <SortHead sort={sort} onSort={onSort} k="gap" right>
                    Gap
                  </SortHead>
                  <SortHead sort={sort} onSort={onSort} k="distance">Where</SortHead>
                  <TableHead className="w-16" />
                </TableRow>
                <TableRow className="hover:bg-transparent">
                  <TableHead />
                  <TableHead className="py-1.5">
                    <FilterInput label="Search" numeric={false} value={c.q} onChange={(v) => set('q', v)} placeholder="cooper s auto bristol…" />
                  </TableHead>
                  <TableHead className="py-1.5">
                    <RangeInput label="Year" from={c.minYear} to={c.maxYear} onFrom={(v) => set('minYear', v)} onTo={(v) => set('maxYear', v)} />
                  </TableHead>
                  <TableHead className="py-1.5">
                    <FilterInput label="Max mileage" value={c.maxMileage} onChange={(v) => set('maxMileage', v)} placeholder="max" />
                  </TableHead>
                  <TableHead className="py-1.5">
                    <RangeInput label="Price (£)" from={c.minPrice} to={c.maxPrice} onFrom={(v) => set('minPrice', v)} onTo={(v) => set('maxPrice', v)} />
                  </TableHead>
                  <TableHead className="py-1.5">
                    <RangeInput label="Model price (£)" from={c.minModel} to={c.maxModel} onFrom={(v) => set('minModel', v)} onTo={(v) => set('maxModel', v)} />
                  </TableHead>
                  <TableHead className="py-1.5">
                    <FilterInput label="Gap at most (%)" value={c.maxGap} onChange={(v) => set('maxGap', v)} placeholder="≤ %" />
                  </TableHead>
                  <TableHead className="py-1.5">
                    <FilterInput label="Max distance (miles)" left value={c.maxDistance} onChange={(v) => set('maxDistance', v)} placeholder="≤ mi" />
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      {gaps.length ? 'No cars match these filters.' : 'No predictions for these cars.'}
                    </TableCell>
                  </TableRow>
                )}
                {shown.map(({ r, pred, gap }) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => onExplain(r)} title="Why this price?">
                    <TableCell>
                      <MarkMenu mark={r.mark} onChange={(m) => onMark(r.id, m)} />
                    </TableCell>
                    <TableCell className="max-w-[15rem]">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{r.variant}</span>
                        <WriteoffBadge writeoff={r.writeoff} />
                        {r.status !== 'active' && <span className="text-xs text-muted-foreground">sold</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.year ?? '–'}</TableCell>
                    <TableCell className="text-right tabular-nums">{miles(r.mileage)}</TableCell>
                    <TableCell className="text-right tabular-nums">{gbp(r.price_gbp)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{gbp(pred)}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium tabular-nums',
                        gap < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
                      )}
                    >
                      {pct(gap)}
                    </TableCell>
                    <TableCell className="max-w-[10rem] truncate text-muted-foreground">
                      {r.location}
                      {r.distance_miles !== null && ` · ${r.distance_miles} mi`}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Details"
                          title="Details: price history, marks, corrections"
                          onClick={(e) => {
                            e.stopPropagation()
                            onPick(r.id)
                          }}
                        >
                          <PanelRight />
                        </Button>
                        {r.url && (
                          <Button asChild variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()}>
                            <a href={r.url} target="_blank" rel="noreferrer" aria-label="Open advert" title="Open advert">
                              <ExternalLink />
                            </a>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {sorted.length ? `${current * PAGE + 1}–${Math.min(sorted.length, (current + 1) * PAGE)} of ${sorted.length.toLocaleString()}` : 'No cars'}
              {sorted.length !== gaps.length && ` (filtered from ${gaps.length.toLocaleString()})`}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page">
                <ChevronLeft />
              </Button>
              <span className="tabular-nums">
                {current + 1} / {pages}
              </span>
              <Button variant="ghost" size="icon-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="Next page">
                <ChevronRight />
              </Button>
            </div>
          </div>
      </>
    </ChartCard>
  )
}
