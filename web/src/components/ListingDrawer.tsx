import { ExternalLink, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EChart } from '@/components/EChart'
import { StatusBadges } from '@/components/ListingBadges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, READ_ONLY } from '@/lib/api'
import { useBase } from '@/lib/chart'
import { markInfo, MARKS, sourceLabel } from '@/lib/config'
import { parseDate } from '@/lib/data'
import { levelLabel } from '@/lib/dims'
import { gapText, gbp, miles, shortDate } from '@/lib/format'
import type { HistoryPoint, MarkValue, Row } from '@/lib/types'
import { cn } from '@/lib/utils'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{children ?? '–'}</dd>
    </div>
  )
}

function PriceHistory({ id }: { id: number }) {
  const b = useBase()
  const [state, setState] = useState<{ id: number; points: HistoryPoint[] | null; error: string | null }>({ id: -1, points: null, error: null })
  useEffect(() => {
    let live = true
    api
      .history(id)
      .then((points) => live && setState({ id, points, error: null }))
      .catch((e: Error) => live && setState({ id, points: null, error: e.message }))
    return () => {
      live = false
    }
  }, [id])
  const points = state.id === id ? state.points : null
  const error = state.id === id ? state.error : null
  const option = useMemo(() => {
    const data = (points ?? [])
      .filter((p) => p.price_gbp !== null)
      .map((p) => [parseDate(p.observed_at)!.getTime(), p.price_gbp])
    return {
      ...b.common,
      grid: { left: 56, right: 16, top: 16, bottom: 32 },
      tooltip: { ...b.common.tooltip, trigger: 'axis', valueFormatter: (v: number) => gbp(v) },
      xAxis: { ...b.valueAxis(''), type: 'time', splitLine: { show: false } },
      yAxis: { ...b.valueAxis('', b.money), scale: true },
      series: [{ type: 'line', step: 'end', data, symbolSize: 7, lineStyle: { width: 2, color: b.t.palette[0] }, itemStyle: { color: b.t.palette[0] } }],
    }
  }, [points, b])
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!points) return <Loader2 className="size-4 animate-spin text-muted-foreground" />
  if (points.length < 2)
    return <p className="text-sm text-muted-foreground">Seen in {points.length} scrape so far: no price history yet.</p>
  return <EChart option={option} height={180} />
}

function MarkSection({ row, onMark }: { row: Row; onMark: (id: number, mark: MarkValue | null, note: string | null) => void }) {
  const [note, setNote] = useState(row.note ?? '')
  if (READ_ONLY) {
    const info = markInfo(row.mark)
    return info ? (
      <section className="space-y-1">
        <h3 className="text-sm font-medium">Mark</h3>
        <p className="flex items-center gap-1.5 text-sm">
          <info.icon className={cn('size-4', info.className)} /> {info.label}
        </p>
        {row.note && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{row.note}</p>}
      </section>
    ) : null
  }
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Mark</h3>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={row.mark ?? ''}
        onValueChange={(v) => onMark(row.id, (v || null) as MarkValue | null, note || null)}
        className="flex flex-wrap justify-start"
        spacing={1}
      >
        {MARKS.map((m) => (
          <ToggleGroupItem key={m.value} value={m.value} className="gap-1.5 text-xs">
            <m.icon className={m.className} /> {m.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Textarea
        placeholder={row.mark ? 'Notes about this car…' : 'Pick a mark to add a note'}
        value={note}
        disabled={!row.mark}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => row.mark && note !== (row.note ?? '') && onMark(row.id, row.mark, note || null)}
        rows={3}
      />
    </section>
  )
}

export function ListingDrawer({
  row,
  predicted,
  onClose,
  onMark,
  onExplain,
  place,
}: {
  row: Row | null
  predicted: number | null
  onClose: () => void
  onMark: (id: number, mark: MarkValue | null, note: string | null) => void
  /** open the SHAP "why this price?" explanation for this car */
  onExplain?: (row: Row) => void
  place: string
}) {
  const gap = row?.price_gbp && predicted ? row.price_gbp / predicted - 1 : null

  return (
    <Sheet open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {row && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{sourceLabel(row.source)}</Badge>
                <StatusBadges row={row} />
              </div>
              <SheetTitle className="text-lg">
                {row.year} {row.title ?? `${row.make ?? ''} ${row.model ?? ''}`}
              </SheetTitle>
              <SheetDescription>{row.variant}</SheetDescription>
            </SheetHeader>
            <div className="space-y-6 px-4 pb-6">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="font-heading text-3xl font-semibold tabular-nums">{row.price_gbp ? gbp(row.price_gbp) : 'No price'}</p>
                  {predicted !== null && (
                    <p className="text-sm text-muted-foreground">
                      Model: {gbp(predicted)}{' '}
                      {gap !== null && (
                        <span className={gap < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                          ({gapText(gap)})
                        </span>
                      )}
                    </p>
                  )}
                  {predicted !== null && onExplain && (
                    <Button variant="link" size="sm" className="h-auto px-0" onClick={() => onExplain(row)}>
                      <Sparkles /> Why this price?
                    </Button>
                  )}
                  {row.first_price !== null && row.price_gbp !== null && row.first_price !== row.price_gbp && (
                    <p className="text-sm text-muted-foreground">First seen at {gbp(row.first_price)}</p>
                  )}
                </div>
                {row.url && (
                  <Button asChild>
                    <a href={row.url} target="_blank" rel="noreferrer">
                      Open advert <ExternalLink />
                    </a>
                  </Button>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Field label="Mileage">{miles(row.mileage)}</Field>
                <Field label="Year / plate">{row.year ? `${row.year}${row.plate ? ` (${row.plate})` : ''}` : null}</Field>
                <Field label="Trim">{row.trim_label}</Field>
                <Field label="Engine">{row.engine_l ? `${row.engine_l.toFixed(1)} L` : null}</Field>
                <Field label="Fuel">{row.fuel}</Field>
                <Field label="Gearbox">{row.transmission}</Field>
                <Field label="Seller">{row.seller_type ? levelLabel('seller_type', row.seller_type) : null}</Field>
                <Field label="Colour">{row.colour}</Field>
                <Field label="Write-off">{row.writeoff ?? 'No'}</Field>
                <Field label="Location">{row.location}</Field>
                <Field label="Distance">
                  {row.distance_miles !== null ? `${row.distance_miles} mi${row.local === 'Local' ? ` (near ${place})` : ''}` : null}
                </Field>
                <Field label="AutoTrader rating">{row.price_indicator ? levelLabel('rating', row.price_indicator) : null}</Field>
                <Field label="First seen">{shortDate(row.first_seen_at)}</Field>
                <Field label="Last seen">{shortDate(row.last_seen_at)}</Field>
                <Field label={row.status === 'delisted' ? 'Gone since' : 'Sightings'}>
                  {row.status === 'delisted' ? shortDate(row.delisted_at) : `${row.n_obs} scrape${row.n_obs === 1 ? '' : 's'}`}
                </Field>
              </dl>

              {row.errata?.length > 0 && (
                <section className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                  <h3 className="text-sm font-medium">Corrected data</h3>
                  {row.errata.map((e) => (
                    <div key={e.field} className="space-y-1 text-sm">
                      <p>
                        <span className="font-medium capitalize">{e.field.replace('_', ' ')}</span>: <s className="text-muted-foreground">{String(e.before)}</s> →{' '}
                        <b>{String(e.after)}</b>
                      </p>
                      <p className="text-xs text-muted-foreground">{e.reason}</p>
                      {e.evidence && <p className="text-xs break-words text-muted-foreground">Evidence: {e.evidence}</p>}
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">The source still shows the original value; corrections live in the errata table.</p>
                </section>
              )}

              <MarkSection key={`${row.id}:${row.mark}:${row.note}`} row={row} onMark={onMark} />

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Price history</h3>
                <PriceHistory id={row.id} />
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
