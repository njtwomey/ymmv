/**
 * "Why this price?": SHAP explanations of one car's model price, in four views:
 * a waterfall, a force plot, what-if curves, and the same car against all cars.
 */
import { Dices, ExternalLink, PanelRight, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EChart } from '@/components/EChart'
import { MarkMenu } from '@/components/MarkControl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useBase } from '@/lib/chart'
import { MARKS } from '@/lib/config'
import { formatValue, groupName, groupValue } from '@/lib/explainLabels'
import { gapText, gbp, miles } from '@/lib/format'
import type { ModelResult } from '@/lib/model'
import { fieldColumns, type PriceField, priceFields, referenceYear } from '@/lib/pricer'
import { type Explanation, explain, groupDependent, whatIf } from '@/lib/shap'
import { beeswarmOption, forceOption, importanceOption, type Step, waterfallOption, whatIfOption } from '@/lib/shapCharts'
import { rng } from '@/lib/stats'
import type { MarkValue, Row } from '@/lib/types'

export interface ExplainTarget {
  title: string
  subtitle?: string
  /** the car, keyed by column names (a listing, or values typed into Price a car) */
  row: Record<string, unknown>
  asking: number | null
  /** for listings from the database: the advert, and the listing id */
  url?: string | null
  listingId?: number
}

/** Where and how a car is sold, rather than what it is: these only nudge the match. */
const CIRCUMSTANCES = new Set(['local', 'seller_type', 'source', 'distance_miles'])

/**
 * Real listings closest to a typed-in car: the same car (every category the model
 * uses must match, apart from circumstances like location or seller, which only
 * break ties), then nearest on the numbers (each scaled by its spread).
 */
function closestListings(target: R, rows: Row[], fields: PriceField[], n = 4): Row[] {
  const same = (a: unknown, b: unknown) =>
    Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && a !== '' && b !== '' ? Number(a) === Number(b) : String(a) === String(b)
  const cats = fields.filter((f) => f.kind === 'category').map((f) => fieldColumns(f.name)[0])
  const carCats = cats.filter((c) => !CIRCUMSTANCES.has(c))
  const softCats = cats.filter((c) => CIRCUMSTANCES.has(c))
  const nums = fields
    .filter((f) => f.kind === 'number' && !CIRCUMSTANCES.has(fieldColumns(f.name)[0]))
    .map((f) => ({ col: fieldColumns(f.name)[0], spread: Math.max(1, (f.range?.[1] ?? 1) - (f.range?.[0] ?? 0)) }))
  const val = (r: Row, c: string) => (r as unknown as R)[c]
  return rows
    .filter((r) => r.status === 'active' && r.price_gbp !== null && carCats.every((c) => same(val(r, c), target[c])))
    .map((r) => ({
      r,
      d:
        nums.reduce((a, { col, spread }) => a + Math.abs(Number(val(r, col)) - Number(target[col])) / spread, 0) +
        1e-9 * softCats.filter((c) => !same(val(r, c), target[c])).length, // tie-break only
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.r)
}

type R = Record<string, unknown>
const MAX_STEPS = 7
const GLOBAL_CARS = 250
const GLOBAL_BACKGROUND = 120

/** Biggest contributions first; the tail folded into one "other inputs" step. */
function stepsOf(e: Explanation, row: R, place: string): Step[] {
  const steps = e.contributions.map((c) => ({ name: groupName(c.names), value: groupValue(c.names, row, place), phi: c.phi }))
  if (steps.length <= MAX_STEPS + 1) return steps
  const rest = steps.slice(MAX_STEPS)
  return [...steps.slice(0, MAX_STEPS), { name: `${rest.length} other inputs`, value: rest.map((s) => s.name).join(', '), phi: rest.reduce((a, s) => a + s.phi, 0) }]
}

function sample<T>(xs: T[], n: number, seed: number): T[] {
  const rand = rng(seed)
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

interface Global {
  /** input groups (as input names), most important first */
  groupNames: string[][]
  names: string[]
  meanAbs: number[]
  points: [number, number, number | null][][]
  labels: string[][]
}

export function ExplainDialog({
  target,
  model,
  rows,
  place,
  onExplainListing,
  onOpenListing,
  marks,
  onMark,
  onClose,
}: {
  target: ExplainTarget | null
  model: ModelResult | null
  /** the cars the model was fitted on: the background the average is taken over */
  rows: Row[]
  place: string
  onExplainListing: (row: Row) => void
  onOpenListing: (id: number) => void
  /** current marks by listing id (live, so a mark made here shows straight away) */
  marks: Map<number, MarkValue | null>
  onMark: (id: number, mark: MarkValue | null) => void
  onClose: () => void
}) {
  const b = useBase()
  const [tab, setTab] = useState('waterfall')
  const background = useMemo(() => rows.filter((r) => r.price_gbp !== null) as unknown as R[], [rows])
  const fields = useMemo(() => (model ? priceFields(model, rows) : []), [model, rows])
  const groups = useMemo(() => (fields.length ? groupDependent(fields, background) : []), [fields, background])
  const refYear = useMemo(() => referenceYear(rows), [rows])

  const result = useMemo(() => {
    if (!target || !model || !fields.length) return null
    return explain(model, target.row, background, fields, { groups })
  }, [target, model, background, fields, groups])
  const steps = useMemo(() => (result && target ? stepsOf(result, target.row, place) : []), [result, target, place])
  /** `u` is a uniform random number, drawn in the click handler. */
  const explainRandom = (u: number) => {
    const pool = rows.filter((r) => r.price_gbp !== null && r.id !== target?.listingId)
    if (pool.length) {
      setWhatIfGroup(0)
      onExplainListing(pool[Math.floor(u * pool.length)])
    }
  }
  const closest = useMemo(() => (target && !target.listingId && fields.length ? closestListings(target.row, rows, fields) : []), [target, rows, fields])

  // ------------------------------------------------------------- what if
  const [whatIfGroup, setWhatIfGroup] = useState(0)
  const players = useMemo(() => (result ? result.contributions.map((c) => groups.findIndex((g) => g.map((i) => fields[i].name).join() === c.names.join())) : []), [result, groups, fields])
  const whatIfData = useMemo(() => {
    if (!result || !target || !model || tab !== 'whatif') return null
    const group = groups[players[whatIfGroup] ?? 0]
    if (!group) return null
    const names = group.map((i) => fields[i].name)
    const points = whatIf(model, target.row, background, fields, group, refYear, (row) => groupValue(names, row, place))
    const numeric = group.length === 1 && fields[group[0]].kind === 'number'
    return { names, points, numeric }
  }, [result, target, model, tab, groups, players, whatIfGroup, fields, background, refYear, place])

  // ------------------------------------------------------------- all cars (computed on demand, in chunks)
  const [global, setGlobal] = useState<{ key: ModelResult; data: Global } | null>(null)
  const [progress, setProgress] = useState(0)
  const running = useRef(false)
  useEffect(() => {
    if (tab !== 'all' || !model || !result || (global && global.key === model) || running.current) return
    running.current = true
    let cancelled = false
    const cars = sample(background, GLOBAL_CARS, 7)
    const bg = sample(background, GLOBAL_BACKGROUND, 11)
    const explained: Explanation[] = []
    const step = () => {
      if (cancelled) return
      const end = Math.min(explained.length + 15, cars.length)
      for (let i = explained.length; i < end; i++) {
        const e = explain(model, cars[i], bg, fields, { groups, maxEvals: 1e9 })
        explained.push(e ?? { base: 0, prediction: 0, contributions: [], method: 'exact', background: 0 })
      }
      setProgress(explained.length / cars.length)
      if (explained.length < cars.length) return void setTimeout(step, 0)
      // Collate per input group, in the order of overall importance.
      const key = (names: string[]) => names.join()
      const gNames = groups.map((g) => g.map((i) => fields[i].name))
      const phiOf = (e: Explanation, names: string[]) => e.contributions.find((c) => key(c.names) === key(names))?.phi ?? 0
      const meanAbs = gNames.map((names) => explained.reduce((a, e) => a + Math.abs(phiOf(e, names)), 0) / explained.length)
      const order = [...gNames.keys()].sort((x, y) => meanAbs[y] - meanAbs[x])
      const rand = rng(3)
      const colourScale = (names: string[]) => {
        if (names.length !== 1) return null
        const col = fieldColumns(names[0])[0]
        const vals = cars.map((c) => Number(c[col]))
        if (!vals.every(Number.isFinite)) return null
        const sorted = [...vals].sort((x, y) => x - y)
        return vals.map((v) => (sorted.length > 1 ? sorted.indexOf(v) / (sorted.length - 1) : 0.5))
      }
      setGlobal({
        key: model,
        data: {
          groupNames: order.map((g) => gNames[g]),
          names: order.map((g) => groupName(gNames[g])),
          meanAbs: order.map((g) => meanAbs[g]),
          points: order.map((g) => {
            const scale = colourScale(gNames[g])
            return explained.map((e, k) => [phiOf(e, gNames[g]), rand() - 0.5, scale ? scale[k] : null] as [number, number, number | null])
          }),
          labels: order.map((g) => cars.map((c) => groupValue(gNames[g], c, place))),
        },
      })
      running.current = false
    }
    setTimeout(step, 0)
    return () => {
      cancelled = true
      running.current = false
    }
  }, [tab, model, result, global, background, fields, groups, place])

  // ------------------------------------------------------------- chart options
  const waterfall = useMemo(
    () => (result ? waterfallOption(b, { base: result.base, prediction: result.prediction, steps, asking: target?.asking ?? null }) : null),
    [b, result, steps, target],
  )
  const force = useMemo(() => (result ? forceOption(b, { base: result.base, prediction: result.prediction, steps }) : null), [b, result, steps])
  const whatIfChart = useMemo(() => {
    if (!whatIfData) return null
    const name = groupName(whatIfData.names)
    const fmt = (x: number) => formatValue(whatIfData.names[0], x, place)
    return whatIfOption(b, { points: whatIfData.points, name, asking: target?.asking ?? null, format: fmt })
  }, [b, whatIfData, target, place])
  const globalCharts = useMemo(() => {
    if (!global || !result) return null
    const g = global.data
    // The 250 cars are cached per model; "this car" is whichever is being explained now.
    const thisCar = g.groupNames.map((names) => result.contributions.find((c) => c.names.join() === names.join())?.phi ?? 0)
    return {
      importance: importanceOption(b, { names: g.names, meanAbs: g.meanAbs, thisCar: thisCar.map(Math.abs) }),
      beeswarm: beeswarmOption(b, { names: g.names, points: g.points, thisCar, labelOf: (i, k) => g.labels[i][k] }),
    }
  }, [b, global, result])

  const sentences = steps.filter((s) => Math.abs(s.phi) >= 50).slice(0, 4).map((s) => `${s.name} (${s.value}) ${s.phi >= 0 ? 'adds' : 'takes off'} ${gbp(Math.abs(s.phi))}`)
  const gap = result && target?.asking ? target.asking / result.prediction - 1 : null

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) {
          setTab('waterfall')
          setWhatIfGroup(0)
          onClose()
        }
      }}
    >
      <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Why {result ? gbp(result.prediction) : 'this price'}?</DialogTitle>
          <DialogDescription>
            {target?.title}
            {target?.subtitle && <span className="block">{target.subtitle}</span>}
          </DialogDescription>
          {target && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {target.listingId !== undefined && (
                <span className="flex items-center gap-1 rounded-md border pr-2 text-xs text-muted-foreground">
                  <MarkMenu mark={marks.get(target.listingId) ?? null} onChange={(m) => onMark(target.listingId!, m)} />
                  {MARKS.find((m) => m.value === marks.get(target.listingId!))?.label ?? 'Mark'}
                </span>
              )}
              {target.listingId !== undefined && target.url && (
                <Button asChild size="sm">
                  <a href={target.url} target="_blank" rel="noreferrer">
                    Open advert <ExternalLink />
                  </a>
                </Button>
              )}
              {target.listingId !== undefined && (
                <Button size="sm" variant="outline" onClick={() => onOpenListing(target.listingId!)}>
                  <PanelRight /> Details
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => explainRandom(Math.random())} disabled={!rows.length}>
                <Dices /> Another random car
              </Button>
            </div>
          )}
        </DialogHeader>
        {target && !target.listingId && closest.length > 0 && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">This isn’t a real listing. The closest cars for sale:</p>
            <ul className="space-y-1.5">
              {closest.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {r.year} {r.variant} · {miles(r.mileage)} · <b>{gbp(r.price_gbp)}</b> · {r.location}
                    {r.distance_miles !== null && ` (${r.distance_miles} mi)`}
                  </span>
                  <MarkMenu mark={marks.get(r.id) ?? null} onChange={(m) => onMark(r.id, m)} />
                  <Button size="xs" variant="outline" onClick={() => onExplainListing(r)}>
                    <Sparkles /> Explain
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => onOpenListing(r.id)}>
                    <PanelRight /> Details
                  </Button>
                  {r.url && (
                    <Button asChild size="xs" variant="ghost">
                      <a href={r.url} target="_blank" rel="noreferrer" aria-label="Open advert">
                        <ExternalLink />
                      </a>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!model ? (
          <p className="text-sm text-muted-foreground">Fit a model first.</p>
        ) : !result ? (
          <p className="text-sm text-muted-foreground">The model can’t price this car (a value it never saw while fitting).</p>
        ) : (
          <>
            <p className="text-sm">
              The average car in the filtered data is priced at <b>{gbp(result.base)}</b>. For this one: {sentences.length ? sentences.join('; ') : 'nothing moves it much'}
              , giving <b>{gbp(result.prediction)}</b>.
              {gap !== null && (
                <>
                  {' '}
                  It’s advertised at <b>{gbp(target!.asking!)}</b>, {gapText(gap)} the model: that part is what the model can’t see (condition, spec,
                  history, the seller).
                </>
              )}
            </p>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="waterfall">Waterfall</TabsTrigger>
                <TabsTrigger value="force">Force</TabsTrigger>
                <TabsTrigger value="whatif">What if</TabsTrigger>
                <TabsTrigger value="all">All cars</TabsTrigger>
              </TabsList>

              <TabsContent value="waterfall" className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  From the average car (dashed) to this car (solid), one input at a time, biggest effect first.
                  {target?.asking ? ' The dotted line is the asking price.' : ''}
                </p>
                {waterfall && <EChart option={waterfall} height={Math.max(240, 56 * steps.length + 80)} />}
              </TabsContent>

              <TabsContent value="force" className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  The same contributions as one bar: inputs that raise the price push right (orange), those that lower it push left (blue), and they
                  meet at this car’s price. Hover for details.
                </p>
                {force && <EChart option={force} height={260} />}
              </TabsContent>

              <TabsContent value="whatif" className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">What if this car had a different</span>
                  <Select value={String(whatIfGroup)} onValueChange={(v) => setWhatIfGroup(Number(v))}>
                    <SelectTrigger size="sm" className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {result.contributions.map((c, i) => (
                        <SelectItem key={c.names.join()} value={String(i)}>
                          {groupName(c.names)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">, everything else unchanged?</span>
                </div>
                {whatIfChart ? (
                  <EChart option={whatIfChart} height={320} />
                ) : (
                  <p className="text-sm text-muted-foreground">No alternatives to show for this input.</p>
                )}
                {whatIfData && !whatIfData.numeric && whatIfData.names.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    {groupName(whatIfData.names)} go together in the data, so each bar is a combination that actually exists.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="all" className="space-y-3">
                {!globalCharts ? (
                  <div className="space-y-2 py-6">
                    <p className="text-sm text-muted-foreground">
                      Explaining {GLOBAL_CARS} cars… {Math.round(progress * 100)}%
                    </p>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary transition-[width]" style={{ width: `${progress * 100}%` }} />
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      How much each input moves prices across {GLOBAL_CARS} cars from the filtered data (average size of its effect), with this car
                      marked ◆.
                    </p>
                    <EChart option={globalCharts.importance} height={Math.max(180, 34 * global!.data.names.length + 70)} />
                    <p className="text-xs text-muted-foreground">
                      Every car’s contribution from each input: a dot per car. For numbers, colour runs from low values (blue) to high (orange), so for
                      mileage you should see orange dots on the left (more miles, lower price). This car is ◆.
                    </p>
                    <EChart option={globalCharts.beeswarm} height={Math.max(240, 46 * global!.data.names.length + 80)} />
                  </>
                )}
              </TabsContent>
            </Tabs>

            <p className="text-xs text-muted-foreground">
              SHAP values ({result.method}, against {result.background} background cars): each input’s fair share of the difference from the average
              car, averaged over every order of adding inputs, so they add up exactly. Inputs that are near-duplicates in the data (like MINI trim
              and engine) are explained together; others that move together (like year and mileage) still share credit, so read these as “given
              the model”, not cause and effect.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
