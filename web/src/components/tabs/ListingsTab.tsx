import { ChevronLeft, ChevronRight, ExternalLink, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { StatusBadges } from '@/components/ListingBadges'
import { MarkMenu } from '@/components/MarkControl'
import { ColumnChooser, FilterHead, FilterInput, RangeInput, type Sort, SortHead } from '@/components/TableFilters'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { sourceLabel } from '@/lib/config'
import { levelLabel } from '@/lib/dims'
import { gbp, miles, pct, shortDate } from '@/lib/format'
import { num, useHiddenColumns } from '@/lib/tableColumns'
import type { MarkValue, Row } from '@/lib/types'
import { cn } from '@/lib/utils'

type SortKey = 'mark' | 'variant' | 'year' | 'mileage' | 'price' | 'gap' | 'seller' | 'source' | 'distance' | 'first_seen' | 'status'
const PAGE = 50
const DAY = 86_400_000

/** The column filters (as typed), on top of the sidebar's. */
interface Criteria {
  q: string
  minYear: string
  maxYear: string
  maxMileage: string
  minPrice: string
  maxPrice: string
  /** in %, e.g. "-10" = at least 10% below the model */
  maxGap: string
  maxDistance: string
  /** first seen within this many days */
  maxAge: string
}
const NONE: Criteria = { q: '', minYear: '', maxYear: '', maxMileage: '', minPrice: '', maxPrice: '', maxGap: '', maxDistance: '', maxAge: '' }

type Col = 'mark' | 'year' | 'mileage' | 'price' | 'gap' | 'seller' | 'source' | 'where' | 'first_seen'
const COLUMNS: { key: Col; label: string }[] = [
  { key: 'mark', label: 'Mark' },
  { key: 'year', label: 'Year' },
  { key: 'mileage', label: 'Mileage' },
  { key: 'price', label: 'Price' },
  { key: 'gap', label: 'vs model' },
  { key: 'seller', label: 'Seller' },
  { key: 'source', label: 'Source' },
  { key: 'where', label: 'Where' },
  { key: 'first_seen', label: 'First seen' },
]
/** the filter fields each column owns (cleared when it's hidden) */
const COL_FILTERS: Partial<Record<Col, (keyof Criteria)[]>> = {
  year: ['minYear', 'maxYear'],
  mileage: ['maxMileage'],
  price: ['minPrice', 'maxPrice'],
  gap: ['maxGap'],
  where: ['maxDistance'],
  first_seen: ['maxAge'],
}
/** the sort each column owns */
const COL_SORT: Partial<Record<Col, SortKey>> = {
  mark: 'mark',
  year: 'year',
  mileage: 'mileage',
  price: 'price',
  gap: 'gap',
  seller: 'seller',
  source: 'source',
  where: 'distance',
  first_seen: 'first_seen',
}
const DEFAULT_SORT: Sort<SortKey> = { key: 'first_seen', dir: -1 }

export function ListingsTab({
  rows,
  predictions,
  onPick,
  onMark,
}: {
  rows: Row[]
  predictions: Map<number, number>
  onPick: (id: number) => void
  onMark: (id: number, mark: MarkValue | null) => void
}) {
  const [c, setC] = useState<Criteria>(NONE)
  const [sort, setSort] = useState<Sort<SortKey>>(DEFAULT_SORT)
  const [page, setPage] = useState(0)
  const cols = useHiddenColumns<Col>('listings')
  const show = cols.shown
  const set = <K extends keyof Criteria>(k: K, v: Criteria[K]) => {
    setC((x) => ({ ...x, [k]: v }))
    setPage(0)
  }
  const onSort = (k: SortKey) =>
    setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : k === 'variant' || k === 'source' ? 1 : -1 }))
  const toggleColumn = (k: Col) => {
    if (show(k)) {
      // Hiding a column drops its filter (and its sort).
      const drop = COL_FILTERS[k] ?? []
      if (drop.length) setC((x) => ({ ...x, ...Object.fromEntries(drop.map((f) => [f, ''])) }))
      if (COL_SORT[k] === sort.key) setSort(DEFAULT_SORT)
      setPage(0)
    }
    cols.toggle(k)
  }

  const gap = (r: Row) => {
    const p = predictions.get(r.id)
    return p && r.price_gbp ? r.price_gbp / p - 1 : null
  }

  const filtered = useMemo(() => {
    const words = c.q.toLowerCase().split(/\s+/).filter(Boolean)
    const within = (v: number | null, lo: number | null, hi: number | null) =>
      (lo === null || (v !== null && v >= lo)) && (hi === null || (v !== null && v <= hi))
    const maxGap = num(c.maxGap)
    const maxAge = num(c.maxAge)
    const since = maxAge === null ? null : Date.now() - maxAge * DAY
    return rows.filter((r) => {
      if (!within(r.year, num(c.minYear), num(c.maxYear))) return false
      if (!within(r.mileage, null, num(c.maxMileage))) return false
      if (!within(r.price_gbp, num(c.minPrice), num(c.maxPrice))) return false
      if (!within(r.distance_miles, null, num(c.maxDistance))) return false
      if (maxGap !== null) {
        const g = gap(r)
        if (g === null || g * 100 > maxGap) return false
      }
      if (since !== null && !(Date.parse(r.first_seen_at) >= since)) return false
      if (words.length) {
        const hay = [
          r.year,
          r.variant,
          r.trim_label,
          r.location,
          r.seller_type && levelLabel('seller_type', r.seller_type),
          sourceLabel(r.source),
          r.fuel,
          r.transmission,
          r.colour,
          r.writeoff,
        ]
          .filter((v) => v !== null && v !== undefined)
          .join(' ')
          .toLowerCase()
        if (!words.every((w) => hay.includes(w))) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, c, predictions])

  const sorted = useMemo(() => {
    const value = (r: Row): string | number | null => {
      switch (sort.key) {
        case 'mark': return r.mark
        case 'variant': return r.variant
        case 'year': return r.year
        case 'mileage': return r.mileage
        case 'price': return r.price_gbp
        case 'gap': return gap(r)
        case 'seller': return r.seller_type
        case 'source': return r.source
        case 'distance': return r.distance_miles
        case 'first_seen': return r.first_seen_at
        case 'status': return r.status
      }
    }
    return [...filtered].sort((a, b) => {
      const x = value(a)
      const y = value(b)
      if (x === y) return (a.id - b.id) * sort.dir
      if (x === null) return 1 // nulls last either way
      if (y === null) return -1
      return (x < y ? -1 : 1) * sort.dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, predictions])

  useEffect(() => setPage(0), [rows, sort])
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE))
  const current = Math.min(page, pages - 1)
  const shown = sorted.slice(current * PAGE, current * PAGE + PAGE)
  const active = Object.values(c).some((v) => v !== '')
  const nCols = 2 + COLUMNS.filter((col) => show(col.key)).length // car, link, + chosen

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
        <span>Click a car for its details. Filter in the row under the headings (on top of the sidebar filters); click a heading to sort.</span>
        <div className="ml-auto flex items-center gap-2">
          {active && (
            <Button size="sm" variant="ghost" onClick={() => (setC(NONE), setPage(0))}>
              <RotateCcw /> Reset filters
            </Button>
          )}
          <ColumnChooser columns={COLUMNS} shown={show} onToggle={toggleColumn} />
        </div>
      </div>
      <div className="max-w-full overflow-x-auto">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              {show('mark') && <SortHead sort={sort} onSort={onSort} k="mark">Mark</SortHead>}
              <SortHead sort={sort} onSort={onSort} k="variant" left>
                Car
              </SortHead>
              {show('year') && <SortHead sort={sort} onSort={onSort} k="year">Year</SortHead>}
              {show('mileage') && <SortHead sort={sort} onSort={onSort} k="mileage">Mileage</SortHead>}
              {show('price') && <SortHead sort={sort} onSort={onSort} k="price">Price</SortHead>}
              {show('gap') && <SortHead sort={sort} onSort={onSort} k="gap">vs model</SortHead>}
              {show('seller') && <SortHead sort={sort} onSort={onSort} k="seller">Seller</SortHead>}
              {show('source') && <SortHead sort={sort} onSort={onSort} k="source">Source</SortHead>}
              {show('where') && <SortHead sort={sort} onSort={onSort} k="distance">Where</SortHead>}
              {show('first_seen') && <SortHead sort={sort} onSort={onSort} k="first_seen">First seen</SortHead>}
              <TableHead className="w-8" />
            </TableRow>
            <TableRow className="hover:bg-transparent">
              {show('mark') && <TableHead />}
              <FilterHead left>
                <FilterInput label="Search" numeric={false} value={c.q} onChange={(v) => set('q', v)} placeholder="cooper s auto bristol…" />
              </FilterHead>
              {show('year') && (
                <FilterHead>
                  <RangeInput narrow label="Year" from={c.minYear} to={c.maxYear} onFrom={(v) => set('minYear', v)} onTo={(v) => set('maxYear', v)} />
                </FilterHead>
              )}
              {show('mileage') && (
                <FilterHead>
                  <FilterInput label="Max mileage" value={c.maxMileage} onChange={(v) => set('maxMileage', v)} placeholder="max" />
                </FilterHead>
              )}
              {show('price') && (
                <FilterHead>
                  <RangeInput label="Price (£)" from={c.minPrice} to={c.maxPrice} onFrom={(v) => set('minPrice', v)} onTo={(v) => set('maxPrice', v)} />
                </FilterHead>
              )}
              {show('gap') && (
                <FilterHead>
                  <FilterInput label="vs model at most (%)" value={c.maxGap} onChange={(v) => set('maxGap', v)} placeholder="≤ %" />
                </FilterHead>
              )}
              {show('seller') && <TableHead />}
              {show('source') && <TableHead />}
              {show('where') && (
                <FilterHead>
                  <FilterInput label="Max distance (miles)" value={c.maxDistance} onChange={(v) => set('maxDistance', v)} placeholder="≤ mi" />
                </FilterHead>
              )}
              {show('first_seen') && (
                <FilterHead>
                  <FilterInput label="First seen within (days)" value={c.maxAge} onChange={(v) => set('maxAge', v)} placeholder="≤ days" />
                </FilterHead>
              )}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={nCols} className="py-10 text-center text-muted-foreground">
                  {rows.length ? 'No listings match these filters.' : 'No listings.'}
                </TableCell>
              </TableRow>
            )}
            {shown.map((r) => {
              const g = gap(r)
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => onPick(r.id)}>
                  {show('mark') && (
                    <TableCell className="text-center">
                      <MarkMenu mark={r.mark} onChange={(m) => onMark(r.id, m)} />
                    </TableCell>
                  )}
                  <TableCell className="max-w-[15rem]">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{r.variant}</span>
                      <StatusBadges row={r} />
                    </div>
                  </TableCell>
                  {show('year') && <TableCell className="text-center tabular-nums">{r.year ?? '–'}</TableCell>}
                  {show('mileage') && <TableCell className="text-center tabular-nums">{miles(r.mileage)}</TableCell>}
                  {show('price') && <TableCell className="text-center tabular-nums">{r.price_gbp ? gbp(r.price_gbp) : '–'}</TableCell>}
                  {show('gap') && (
                    <TableCell
                      className={cn(
                        'text-center tabular-nums',
                        g === null ? 'text-muted-foreground' : g < -0.1 ? 'text-emerald-600 dark:text-emerald-400' : g > 0.1 ? 'text-amber-600 dark:text-amber-400' : '',
                      )}
                    >
                      {pct(g)}
                    </TableCell>
                  )}
                  {show('seller') && (
                    <TableCell className="text-center" title={r.seller_type ? levelLabel('seller_type', r.seller_type) : undefined}>
                      {r.seller_type === 'TRADE' ? 'Trade' : r.seller_type ? levelLabel('seller_type', r.seller_type) : '–'}
                    </TableCell>
                  )}
                  {show('source') && <TableCell className="text-center">{sourceLabel(r.source)}</TableCell>}
                  {show('where') && (
                    <TableCell className="max-w-[7rem] truncate text-center text-muted-foreground" title={r.location ?? undefined}>
                      {r.location ?? '–'}
                      {r.distance_miles !== null && ` · ${r.distance_miles} mi`}
                    </TableCell>
                  )}
                  {show('first_seen') && <TableCell className="text-center text-muted-foreground">{shortDate(r.first_seen_at)}</TableCell>}
                  <TableCell className="text-center">
                    {r.url && (
                      <Button asChild variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()}>
                        <a href={r.url} target="_blank" rel="noreferrer" aria-label="Open advert">
                          <ExternalLink />
                        </a>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
        <span>
          {sorted.length ? `${current * PAGE + 1}–${Math.min(sorted.length, (current + 1) * PAGE)} of ${sorted.length.toLocaleString()}` : 'No listings'}
          {sorted.length !== rows.length && ` (filtered from ${rows.length.toLocaleString()})`}
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
    </Card>
  )
}
