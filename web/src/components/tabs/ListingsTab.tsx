import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { StatusBadges } from '@/components/ListingBadges'
import { MarkMenu } from '@/components/MarkControl'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { sourceLabel } from '@/lib/config'
import { levelLabel } from '@/lib/dims'
import { gbp, miles, pct, shortDate } from '@/lib/format'
import type { MarkValue, Row } from '@/lib/types'
import { cn } from '@/lib/utils'

type SortKey = 'mark' | 'variant' | 'year' | 'mileage' | 'price' | 'gap' | 'seller' | 'source' | 'distance' | 'first_seen' | 'status'
const PAGE = 50

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
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'first_seen', dir: -1 })
  const [page, setPage] = useState(0)
  const gap = (r: Row) => {
    const p = predictions.get(r.id)
    return p && r.price_gbp ? r.price_gbp / p - 1 : null
  }

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
    return [...rows].sort((a, b) => {
      const x = value(a)
      const y = value(b)
      if (x === y) return (a.id - b.id) * sort.dir
      if (x === null) return 1 // nulls last either way
      if (y === null) return -1
      return (x < y ? -1 : 1) * sort.dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, predictions])

  useEffect(() => setPage(0), [rows, sort])
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE))
  const shown = sorted.slice(page * PAGE, page * PAGE + PAGE)

  const Head = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <TableHead className={cn(right && 'text-right')}>
      <button
        className={cn('inline-flex items-center gap-1 hover:text-foreground', sort.key === k && 'text-foreground')}
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : k === 'variant' || k === 'source' ? 1 : -1 }))}
      >
        {children}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </TableHead>
  )

  return (
    <Card className="gap-0 py-0">
      <div className="max-w-full overflow-x-auto">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <Head k="mark">Mark</Head>
              <Head k="variant">Car</Head>
              <Head k="year" right>Year</Head>
              <Head k="mileage" right>Mileage</Head>
              <Head k="price" right>Price</Head>
              <Head k="gap" right>vs model</Head>
              <Head k="seller">Seller</Head>
              <Head k="source">Source</Head>
              <Head k="distance">Where</Head>
              <Head k="first_seen">First seen</Head>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => {
              const g = gap(r)
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => onPick(r.id)}>
                  <TableCell>
                    <MarkMenu mark={r.mark} onChange={(m) => onMark(r.id, m)} />
                  </TableCell>
                  <TableCell className="max-w-[22rem]">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{r.variant}</span>
                      <StatusBadges row={r} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.year ?? '–'}</TableCell>
                  <TableCell className="text-right tabular-nums">{miles(r.mileage)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.price_gbp ? gbp(r.price_gbp) : '–'}</TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      g === null ? 'text-muted-foreground' : g < -0.1 ? 'text-emerald-600 dark:text-emerald-400' : g > 0.1 ? 'text-amber-600 dark:text-amber-400' : '',
                    )}
                  >
                    {pct(g)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{r.seller_type ? levelLabel('seller_type', r.seller_type) : '–'}</TableCell>
                  <TableCell className="whitespace-nowrap">{sourceLabel(r.source)}</TableCell>
                  <TableCell className="max-w-[10rem] truncate text-muted-foreground">
                    {r.location ?? '–'}
                    {r.distance_miles !== null && ` · ${r.distance_miles} mi`}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{shortDate(r.first_seen_at)}</TableCell>
                  <TableCell>
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
          {sorted.length ? `${page * PAGE + 1}–${Math.min(sorted.length, (page + 1) * PAGE)} of ${sorted.length.toLocaleString()}` : 'No listings'}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <span className="tabular-nums">
            {page + 1} / {pages}
          </span>
          <Button variant="ghost" size="icon-sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      </div>
    </Card>
  )
}
