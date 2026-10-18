import { Info, Play, RotateCcw } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { ChartCard, Empty } from '@/components/ChartCard'
import { BestValueTable } from '@/components/BestValueTable'
import { ColourBySelect } from '@/components/ColourBySelect'
import { EChart } from '@/components/EChart'
import { FormulaBuilder } from '@/components/FormulaBuilder'
import type { ExplainTarget } from '@/components/ExplainDialog'
import { ExplainPicker } from '@/components/ExplainPicker'
import { PriceCarCard } from '@/components/PriceCarCard'
import { SavedModels } from '@/components/SavedModels'
import { ModelSearchDialog } from '@/components/ModelSearchDialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { colourFor, useBase } from '@/lib/chart'
import { DEFAULT_FORMULA } from '@/lib/config'
import { FORMULA_ALIASES, FORMULA_COLUMNS } from '@/lib/data'
import { type Dim, levelLabel, RATINGS } from '@/lib/dims'
import { gbp, num, pct, pValue } from '@/lib/format'
import { FormulaError, parseFormula } from '@/lib/formula'
import type { ModelResult } from '@/lib/model'
import { colouredScatter } from '@/lib/series'
import { boxplot, groupBy, summarise } from '@/lib/stats'
import type { Filters } from '@/lib/filters'
import type { MarkValue, Row, SavedModel } from '@/lib/types'
import { pointTooltip } from '@/lib/tooltips'
import { cn } from '@/lib/utils'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-heading text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

const BUILDER_KEY = 'ymmv.builderOpen'

function FormulaEditor({
  formula,
  folds,
  rows,
  standardise,
  onStandardise,
  onApply,
  toolbar,
}: {
  formula: string
  folds: number
  rows: Row[]
  /** saved models bar (rendered by the parent so it survives this editor remounting) */
  toolbar: ReactNode
  standardise: boolean
  onStandardise: (on: boolean) => void
  onApply: (formula: string, folds: number) => void
}) {
  const [draft, setDraft] = useState(formula)
  const parseError = useMemo(() => {
    try {
      parseFormula(draft)
      return null
    } catch (e) {
      return e instanceof FormulaError ? e.message : String(e)
    }
  }, [draft])
  const apply = () => !parseError && onApply(draft.trim(), folds)
  const [builderOpen, setBuilderOpenState] = useState(() => {
    try {
      return localStorage.getItem(BUILDER_KEY) === '1'
    } catch {
      return false
    }
  })
  const setBuilderOpen = (open: boolean) => {
    setBuilderOpenState(open)
    try {
      localStorage.setItem(BUILDER_KEY, open ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <ChartCard
      title="Model"
      actions={
        <>
          <Select value={String(folds)} onValueChange={(v) => onApply(formula, Number(v))}>
            <SelectTrigger size="sm" className="w-[9.5rem]" aria-label="Cross-validation folds">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">No CV</SelectItem>
              <SelectItem value="3">3-fold CV</SelectItem>
              <SelectItem value="5">5-fold CV</SelectItem>
              <SelectItem value="10">10-fold CV</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={() => onApply(DEFAULT_FORMULA, folds)}>
            <RotateCcw /> Default
          </Button>
          <ModelSearchDialog rows={rows} current={formula} onUse={(f) => onApply(f, folds)} />
          <Button size="sm" onClick={apply} disabled={!!parseError || draft.trim() === formula}>
            <Play /> Fit
          </Button>
        </>
      }
    >
      <div className="mb-4">{toolbar}</div>
      <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
        Formula
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="rounded p-0.5 hover:bg-muted" aria-label="Formula syntax">
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-md space-y-1.5 text-xs">
            <p>
              <code>a + b</code> terms · <code>a:b</code> interaction · <code>a * b</code> = a + b + a:b · <code>- 1</code> or <code>0 +</code> no
              intercept · <code>log() log1p() sqrt() exp() abs()</code> · <code>I(age^2)</code> arithmetic · <code>C(x)</code> /{' '}
              <code>C(x, "Level")</code> categorical with a reference level · <code>O(x)</code> /{' '}
              <code>O(x, "low", "high")</code> ordered categories: each coefficient is the step up from the level below.
            </p>
            <p>Text columns are categorical (reference = most common level). Terms that don’t vary after filtering are dropped.</p>
            <p>Columns: {FORMULA_COLUMNS.join(', ')}.</p>
            <p>Aliases: {Object.entries(FORMULA_ALIASES).map(([a, c]) => `${a}→${c}`).join(', ')}.</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <Textarea
        className="font-mono text-sm"
        rows={2}
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) apply()
        }}
        aria-invalid={!!parseError}
      />
      <p className={cn('mt-2 text-xs', parseError ? 'text-destructive' : 'text-muted-foreground')}>
        {parseError ?? (draft.trim() !== formula ? 'Edited: Ctrl/⌘ + Enter or Fit to apply.' : 'Ctrl/⌘ + Enter to fit.')}
      </p>
      {/* This editor remounts on every formula change, so the open state lives in storage. */}
      <details className="mt-3" open={builderOpen} onToggle={(e) => setBuilderOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-medium select-none">Build interactively</summary>
        <div className="mt-3">
          <FormulaBuilder
            formula={formula}
            rows={rows}
            standardise={standardise}
            onStandardise={onStandardise}
            onApply={(f) => onApply(f, folds)}
          />
        </div>
      </details>
    </ChartCard>
  )
}

export function ModelTab({
  rows,
  orders,
  place,
  model,
  error,
  formula,
  folds,
  standardise,
  onStandardise,
  onApply,
  onPick,
  onMark,
  onExplain,
  onExplainListing,
  car,
  filters,
  onLoadSaved,
}: {
  rows: Row[]
  orders: Record<Dim, string[]>
  place: string
  model: ModelResult | null
  error: string | null
  formula: string
  folds: number
  standardise: boolean
  onStandardise: (on: boolean) => void
  onApply: (formula: string, folds: number) => void
  onPick: (id: number) => void
  onMark: (id: number, mark: MarkValue | null) => void
  onExplain: (target: ExplainTarget) => void
  onExplainListing: (row: Row) => void
  car: string | null
  filters: Filters
  onLoadSaved: (m: SavedModel) => void
}) {
  const b = useBase()
  const [colourBy, setColourBy] = useState<Dim>('trim_label')
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const isLog = model?.response.kind === 'log' || model?.response.kind === 'log1p'
  const predictions = useMemo(() => (model ? (model.oof.size ? model.oof : model.fitted) : new Map<number, number>()), [model])
  const predLabel = model?.oof.size ? 'out-of-fold' : 'in-sample'

  const scatter = useMemo(() => {
    const pts = [...predictions.entries()].flatMap(([id, p]) => {
      const r = byId.get(id)
      return r?.price_gbp ? [{ value: [r.price_gbp, p], id }] : []
    })
    const vals = pts.flatMap((p) => p.value)
    const lo = isLog ? 10 ** Math.floor(Math.log10(Math.max(100, Math.min(...vals)))) : 0
    const hi = isLog ? 10 ** Math.ceil(Math.log10(Math.max(...vals))) : Math.max(...vals) * 1.05
    const axis = (name: string) => ({ ...b.valueAxis(name, b.money), type: isLog ? 'log' : 'value', min: lo, max: hi, logBase: 10 })
    const series = colouredScatter(
      pts.map((p) => ({ row: byId.get(p.id)!, value: p.value as [number, number] })),
      colourBy,
      orders,
      b,
      place,
    )
    return {
      ...b.common,
      legend: { ...b.common.legend, type: 'scroll' },
      tooltip: { ...b.common.tooltip, trigger: 'item', formatter: pointTooltip(byId) },
      xAxis: axis('Actual asking price'),
      yAxis: { ...axis(`Predicted (${predLabel})`), nameGap: 52 },
      grid: { ...b.common.grid, left: 72 },
      dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }],
      series: [
        ...series,
        {
          // The perfect-agreement line, kept out of the legend.
          type: 'line',
          silent: true,
          showSymbol: false,
          lineStyle: { color: b.t.muted, type: 'dashed', width: 1 },
          data: [
            [lo, lo],
            [hi, hi],
          ],
          z: 0,
        },
      ],
    }
  }, [predictions, byId, b, isLog, predLabel, colourBy, orders, place])

  const gaps = useMemo(
    () =>
      [...predictions.entries()].flatMap(([id, p]) => {
        const r = byId.get(id)
        return r?.price_gbp ? [{ r, pred: p, gap: r.price_gbp / p - 1 }] : []
      }),
    [predictions, byId],
  )

  // AutoTrader's own rating against our model's gap: do the two agree on what's cheap?
  const ratings = useMemo(() => {
    const groups = groupBy(gaps.filter((g) => g.r.source === 'autotrader'), (g) => g.r.rating)
    const order = RATINGS.filter((x) => groups.has(x))
    return {
      table: order.map((rt) => ({ rating: rt, ...summarise(groups.get(rt)!.map((g) => g.gap)) })),
      option: {
        ...b.common,
        tooltip: {
          ...b.common.tooltip,
          trigger: 'item',
          formatter: (p: { name: string; data: { value: number[]; n: number } }) =>
            `<b>${levelLabel('rating', p.name)}</b> (n=${p.data.n})<br/>median gap ${pct(p.data.value[2])}<br/>middle 50%: ${pct(p.data.value[1])} to ${pct(p.data.value[3])}`,
        },
        xAxis: b.categoryAxis('AutoTrader price rating', order.map((x) => levelLabel('rating', x))),
        yAxis: { ...b.valueAxis('Asking price vs model'), nameGap: 48, axisLabel: { color: b.t.muted, formatter: (v: number) => pct(v) } },
        grid: { ...b.common.grid, left: 64 },
        series: [
          {
            type: 'boxplot',
            data: order.map((rt) => {
              const v = groups.get(rt)!.map((g) => g.gap)
              const c = rt === 'No rating' ? b.t.context : colourFor(b.t, RATINGS, rt)
              return { value: boxplot(v), n: v.length, itemStyle: { color: `${c}40`, borderColor: c, borderWidth: 1.5 } }
            }),
            markLine: { silent: true, symbol: 'none', lineStyle: { color: b.t.axis, type: 'dashed' }, label: { show: false }, data: [{ yAxis: 0 }] },
          },
        ],
      },
    }
  }, [gaps, b])


  return (
    <div className="grid gap-4">
      <FormulaEditor
        key={formula}
        formula={formula}
        folds={folds}
        rows={rows}
        standardise={standardise}
        onStandardise={onStandardise}
        onApply={onApply}
        toolbar={
          <SavedModels car={car} filters={filters} formula={formula} folds={folds} standardise={standardise} model={model} onLoad={onLoadSaved} />
        }
      />
      {error && <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {model && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            <Stat label="Cars" value={model.fit.n.toLocaleString()} />
            <Stat label="Coefficients" value={String(model.fit.k)} />
            <Stat label="R²" value={num(model.fit.r2, 3)} />
            <Stat label="Adj. R²" value={num(model.fit.adjR2, 3)} />
            <Stat label="Residual SD" value={num(model.fit.sigma, 3)} />
            <Stat label={`CV R² (${model.cv?.folds ?? 0}-fold)`} value={model.cv ? num(model.cv.r2, 3) : '–'} />
            <Stat label="CV MAE" value={model.cv?.mae != null ? gbp(model.cv.mae) : '–'} />
            <Stat label="CV MAPE" value={model.cv?.mape != null ? pct(model.cv.mape, 1).replace('+', '') : '–'} />
          </div>
          {model.warnings.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {model.warnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          )}

          <PriceCarCard key={model.formula.text} model={model} rows={rows} place={place} onExplain={onExplain} />
          <ExplainPicker rows={rows} predictions={predictions} onExplain={onExplainListing} />

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard
              title="Predicted vs actual"
              description={`Each car’s ${predLabel} prediction; the dashed line is perfect agreement. Click a point to open the listing.`}
              actions={<ColourBySelect value={colourBy} onChange={setColourBy} />}
            >
              {predictions.size ? <EChart option={scatter} height={380} onPick={onPick} /> : <Empty>The response can’t be back-transformed to prices.</Empty>}
            </ChartCard>
            <ChartCard
              title="AutoTrader’s rating vs this model"
              description="How far each AutoTrader car’s asking price sits from the model’s prediction, by AutoTrader’s own price rating."
            >
              {ratings.table.length ? (
                <>
                  <EChart option={ratings.option} height={300} />
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {ratings.table.map((t) => (
                      <span key={t.rating}>
                        {levelLabel('rating', t.rating)}: median {pct(t.med)} (n={t.n})
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <Empty>No AutoTrader ratings in the filtered data.</Empty>
              )}
            </ChartCard>
          </div>

          <BestValueTable gaps={gaps} predLabel={predLabel} onPick={onPick} onMark={onMark} onExplain={onExplainListing} />

          <ChartCard
            title="Coefficients"
            collapsible
            description={[
              isLog ? 'Response is log-transformed, so “effect” is the % change in price.' : null,
              model.coefs.some((c) => c.sd !== null)
                ? 'Numeric features are standardised: effects are for a 1-SD change (SD shown in the feature’s own units), the intercept is a typical car, and categories are vs their reference level.'
                : 'Effects are per unit of each feature, or vs the reference level for categories.',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="max-w-full overflow-x-auto">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Term</TableHead>
                    <TableHead className="text-right">Estimate</TableHead>
                    <TableHead className="text-right">SE</TableHead>
                    <TableHead className="text-right">t</TableHead>
                    <TableHead className="text-right">p</TableHead>
                    <TableHead className="text-right">95% CI</TableHead>
                    {isLog && <TableHead className="text-right">Effect</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.coefs.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-mono">
                        {c.name}
                        {c.sd !== null && <span className="ml-2 font-sans text-muted-foreground">per SD ({num(c.sd, c.sd < 10 ? 2 : 0)})</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{num(c.estimate, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums">{num(c.se, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums">{num(c.t, 1)}</TableCell>
                      <TableCell className={cn('text-right tabular-nums', c.p < 0.05 ? '' : 'text-muted-foreground')}>{pValue(c.p)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {num(c.lo, 3)} to {num(c.hi, 3)}
                      </TableCell>
                      {isLog && (
                        <TableCell className="text-right tabular-nums">
                          {c.pct === null ? '' : `${pct(c.pct, 1)} (${pct(c.pctLo, 1)} to ${pct(c.pctHi, 1)})`}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </ChartCard>
        </>
      )}
      {!model && !error && (
        <Label className="text-sm text-muted-foreground">Fitting…</Label>
      )}
    </div>
  )
}
