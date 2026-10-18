import { AlertCircle, X } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { FiltersPanel } from '@/components/FiltersPanel'
import { Header } from '@/components/Header'
import { Kpis } from '@/components/Kpis'
import { type ExplainTarget, ExplainDialog } from '@/components/ExplainDialog'
import { ListingDrawer } from '@/components/ListingDrawer'
import { Contrasts } from '@/components/tabs/Contrasts'
import { Depreciation } from '@/components/tabs/Depreciation'
import { ListingsTab } from '@/components/tabs/ListingsTab'
import { ModelTab } from '@/components/tabs/ModelTab'
import { Overview } from '@/components/tabs/Overview'
import { SourcesTab } from '@/components/tabs/SourcesTab'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { deriveRows } from '@/lib/data'
import { levelOrders } from '@/lib/dims'
import { activeFilterCount, applyFilters, filterOptions, type Filters, NO_FILTERS, readView, saveModel, type Tab, type ViewState, writeView } from '@/lib/filters'
import { fitModel, type ModelResult } from '@/lib/model'
import { gbp, miles } from '@/lib/format'
import type { Listing, MarkValue, Meta, Row } from '@/lib/types'

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  depreciation: 'Depreciation',
  contrasts: 'Contrasts',
  model: 'Model',
  listings: 'Listings',
  sources: 'Sources',
}

export default function App() {
  const [view, setView] = useState<ViewState>(() => readView(window.location.search))
  const [meta, setMeta] = useState<Meta | null>(null)
  const [listings, setListings] = useState<Listing[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Keep the URL (shareable view) and the stored model config in sync with the view.
  useEffect(() => {
    const search = writeView(view)
    if (search !== window.location.search) window.history.replaceState(null, '', `${window.location.pathname}${search}`)
    saveModel({ formula: view.formula, folds: view.folds, standardise: view.standardise })
  }, [view])

  useEffect(() => {
    api
      .meta()
      .then((m) => {
        setMeta(m)
        if (m.cars.length) {
          const known = m.cars.some((c) => c.id === view.car)
          const biggest = [...m.cars].sort((a, b) => b.n_listings - a.n_listings)[0].id
          if (!known) setView((v) => ({ ...v, car: biggest }))
        }
      })
      .catch((e: Error) => setError(e.message))
    // Only on mount: the car choice is resolved once against the available cars.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!meta || (meta.cars.length && !view.car)) return
    let live = true
    setListings(null)
    api
      .listings(meta.cars.length ? view.car : null)
      .then((l) => live && setListings(l))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [meta, view.car])

  const car = meta?.cars.find((c) => c.id === view.car) ?? null
  const rows = useMemo(() => deriveRows(listings ?? [], view.filters.radius), [listings, view.filters.radius])
  const orders = useMemo(() => levelOrders(rows, car?.trims ?? []), [rows, car])
  const options = useMemo(() => filterOptions(rows, orders.trim_label), [rows, orders])
  const filtered = useMemo(() => applyFilters(rows, view.filters), [rows, view.filters])

  // The model refits whenever the filtered set changes; deferring keeps typing in filters snappy.
  const forModel = useDeferredValue(filtered)
  const { model, modelError } = useMemo((): { model: ModelResult | null; modelError: string | null } => {
    const priced = forModel.filter((r) => r.price_gbp !== null)
    if (!listings) return { model: null, modelError: null }
    try {
      return { model: fitModel(priced, view.formula, { folds: view.folds, standardise: view.standardise }), modelError: null }
    } catch (e) {
      return { model: null, modelError: (e as Error).message }
    }
  }, [forModel, view.formula, view.folds, view.standardise, listings])
  const predictions = useMemo(() => model?.oof.size ? model.oof : (model?.fitted ?? new Map<number, number>()), [model])
  /** the cars the model was fitted on: SHAP's background */
  const modelRows = useMemo(() => forModel.filter((r) => r.price_gbp !== null), [forModel])
  const [explaining, setExplaining] = useState<ExplainTarget | null>(null)
  const marksById = useMemo(() => new Map(rows.map((r) => [r.id, r.mark])), [rows])
  const explainListing = useCallback(
    (r: Row) =>
      setExplaining({
        title: `${r.year ?? ''} ${r.variant ?? r.title ?? ''}`.trim(),
        subtitle: [miles(r.mileage), r.location, r.price_gbp ? `asking ${gbp(r.price_gbp)}` : null].filter(Boolean).join(' · '),
        row: r as unknown as Record<string, unknown>,
        asking: r.price_gbp,
        url: r.url,
        listingId: r.id,
      }),
    [],
  )

  const setFilters = useCallback((filters: Filters) => setView((v) => ({ ...v, filters })), [])

  const setMark = useCallback(async (id: number, mark: MarkValue | null, note?: string | null) => {
    let previous: Listing | undefined
    setListings((ls) =>
      ls?.map((l) => {
        if (l.id !== id) return l
        previous = l
        return { ...l, mark, note: mark ? (note === undefined ? l.note : note) : null }
      }) ?? null,
    )
    try {
      const current = note === undefined ? (previous?.note ?? null) : note
      await api.setMark(id, mark, mark ? current : null)
    } catch (e) {
      setListings((ls) => ls?.map((l) => (l.id === id && previous ? { ...l, mark: previous.mark, note: previous.note } : l)) ?? null)
      setError(`Couldn't save the mark: ${(e as Error).message}`)
    }
  }, [])

  const selectedRow = rows.find((r) => r.id === selected) ?? null
  const filtersPanel = (
    <FiltersPanel filters={view.filters} onChange={setFilters} options={options} shown={filtered.length} total={rows.length} />
  )

  return (
    <div className="min-h-svh bg-background text-foreground">
      <Header
        meta={meta}
        car={view.car}
        onCar={(id) => setView((v) => ({ ...v, car: id }))}
        onOpenFilters={() => setFiltersOpen(true)}
        activeFilters={activeFilterCount(view.filters)}
      />
      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100svh-3.5rem)] w-72 shrink-0 overflow-y-auto border-r lg:block">{filtersPanel}</aside>
        <main className="min-w-0 flex-1 space-y-4 p-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span className="flex-1">{error}</span>
              <Button variant="ghost" size="icon-xs" onClick={() => setError(null)} aria-label="Dismiss">
                <X />
              </Button>
            </div>
          )}
          {!listings ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-20" />)}
              </div>
              <Skeleton className="h-[440px]" />
            </div>
          ) : (
            <>
              <Kpis rows={filtered} place={view.filters.place} />
              <Tabs value={view.tab} onValueChange={(t) => setView((v) => ({ ...v, tab: t as Tab }))}>
                <div className="max-w-full overflow-x-auto">
                  <TabsList>
                    {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
                      <TabsTrigger key={t} value={t}>
                        {TAB_LABELS[t]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                <TabsContent value="overview">
                  <Overview rows={filtered} orders={orders} place={view.filters.place} onPick={setSelected} />
                </TabsContent>
                <TabsContent value="depreciation">
                  <Depreciation rows={filtered} orders={orders} />
                </TabsContent>
                <TabsContent value="contrasts">
                  <Contrasts rows={filtered} orders={orders} place={view.filters.place} formula={view.formula} />
                </TabsContent>
                <TabsContent value="model">
                  <ModelTab
                    orders={orders}
                    place={view.filters.place}
                    rows={filtered}
                    model={model}
                    error={modelError}
                    formula={view.formula}
                    folds={view.folds}
                    standardise={view.standardise}
                    onStandardise={(standardise) => setView((v) => ({ ...v, standardise }))}
                    onApply={(formula, folds) => setView((v) => ({ ...v, formula, folds }))}
                    onPick={setSelected}
                    onMark={(id, m) => void setMark(id, m)}
                    onExplain={setExplaining}
                    onExplainListing={explainListing}
                    car={view.car}
                    filters={view.filters}
                    onLoadSaved={(m) =>
                      setView((v) => ({
                        ...v,
                        formula: m.formula,
                        folds: m.folds,
                        standardise: m.standardise,
                        // Saved filters fill in over "no filters", so keys added later still get a value.
                        filters: { ...NO_FILTERS, ...(m.filters as Partial<Filters>) },
                      }))
                    }
                  />
                </TabsContent>
                <TabsContent value="listings">
                  <ListingsTab rows={filtered} predictions={predictions} onPick={setSelected} onMark={(id, m) => void setMark(id, m)} />
                </TabsContent>
                <TabsContent value="sources">
                  <SourcesTab
                    rows={filtered}
                    runs={(meta?.runs ?? []).filter((r) => !view.car || !r.car_id || r.car_id === view.car)}
                    formula={view.formula}
                    orders={orders}
                    onPick={setSelected}
                  />
                </TabsContent>
              </Tabs>
            </>
          )}
        </main>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" className="w-[88vw] overflow-y-auto p-0 sm:max-w-sm">
          <SheetHeader className="pb-0">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription className="sr-only">Filter the listings shown in every tab.</SheetDescription>
          </SheetHeader>
          {filtersPanel}
        </SheetContent>
      </Sheet>

      <ListingDrawer
        row={selectedRow}
        predicted={selectedRow ? (predictions.get(selectedRow.id) ?? model?.predict(selectedRow) ?? null) : null}
        onClose={() => setSelected(null)}
        onMark={(id, m, note) => void setMark(id, m, note)}
        onExplain={model ? explainListing : undefined}
        place={view.filters.place}
      />
      <ExplainDialog
        target={explaining}
        model={model}
        rows={modelRows}
        place={view.filters.place}
        onExplainListing={explainListing}
        marks={marksById}
        onMark={(id, m) => void setMark(id, m)}
        onOpenListing={setSelected} // the drawer opens on top; closing it returns to the explanation
        onClose={() => setExplaining(null)}
      />
    </div>
  )
}
