/**
 * "Optimise": a timed, randomised search for the formula with the lowest
 * cross-validated RMSE, with a live timer and RMSE-over-time chart.
 * The search itself runs in a Web Worker (lib/search.worker.ts).
 */
import { Dice5, Play, Sparkles, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EChart } from '@/components/EChart'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useBase } from '@/lib/chart'
import { gbp } from '@/lib/format'
import { DEFAULT_SEARCH, type TestScore, type Trial } from '@/lib/search'
import type { SearchMessage, SearchRequest } from '@/lib/search.worker'
import type { Row } from '@/lib/types'
import { cn } from '@/lib/utils'

const BUDGETS = [15, 30, 60, 120, 300]
type Phase = 'setup' | 'running' | 'done' | 'error'

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function ModelSearchDialog({ rows, current, onUse }: { rows: Row[]; current: string; onUse: (formula: string) => void }) {
  const b = useBase()
  const [open, setOpen] = useState(false)
  const [budget, setBudget] = useState(60)
  const [folds, setFolds] = useState(DEFAULT_SEARCH.folds)
  const [seed, setSeed] = useState(DEFAULT_SEARCH.seed)
  const [interactions, setInteractions] = useState(DEFAULT_SEARCH.interactions)
  const [phase, setPhase] = useState<Phase>('setup')
  const [trials, setTrials] = useState<Trial[]>([])
  const [tried, setTried] = useState(0)
  const [ready, setReady] = useState<Extract<SearchMessage, { type: 'ready' }> | null>(null)
  const [result, setResult] = useState<{ leaderboard: Trial[]; test: TestScore[]; stopped: boolean; tried: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(0)
  const startedAt = useRef(0)
  const worker = useRef<Worker | null>(null)

  const stopWorker = () => {
    worker.current?.terminate()
    worker.current = null
  }
  useEffect(() => stopWorker, [])

  // Tick the visible timer while running.
  useEffect(() => {
    if (phase !== 'running') return
    const id = window.setInterval(() => setNow(Date.now() - startedAt.current), 100)
    return () => window.clearInterval(id)
  }, [phase])

  const start = () => {
    stopWorker()
    setTrials([])
    setTried(0)
    setReady(null)
    setResult(null)
    setError(null)
    setNow(0)
    const w = new Worker(new URL('../lib/search.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e: MessageEvent<SearchMessage>) => {
      const m = e.data
      if (m.type === 'ready') setReady(m)
      else if (m.type === 'progress') {
        setTrials((ts) => [...ts, ...m.trials])
        setTried(m.tried)
      } else if (m.type === 'done') {
        setResult({ leaderboard: m.leaderboard, test: m.test, stopped: m.stopped, tried: m.tried })
        setTried(m.tried)
        setNow(m.elapsed)
        setPhase('done')
        stopWorker()
      } else {
        setError(m.message)
        setPhase('error')
        stopWorker()
      }
    }
    startedAt.current = Date.now()
    setPhase('running')
    const req: SearchRequest = {
      type: 'start',
      rows,
      settings: { ...DEFAULT_SEARCH, folds, seed, interactions },
      budgetMs: budget * 1000,
      current,
    }
    w.postMessage(req)
  }

  const stop = () => worker.current?.postMessage({ type: 'stop' } satisfies SearchRequest)

  const best = useMemo(() => trials.reduce<Trial | null>((a, t) => (!a || t.rmse < a.rmse ? t : a), null), [trials])

  const option = useMemo(() => {
    const improvements = trials.filter((t) => t.improved)
    const bestLine = improvements.map((t) => [t.t / 1000, t.rmse])
    if (best) bestLine.push([Math.max(now, best.t) / 1000, best.rmse])
    const sorted = trials.map((t) => t.rmse).sort((x, y) => x - y)
    const yMax = sorted.length ? Math.min(sorted[sorted.length - 1], sorted[Math.floor(sorted.length * 0.9)] * 1.15) : undefined
    const pts = trials.length > 4000 ? trials.filter((_, i) => i % Math.ceil(trials.length / 4000) === 0) : trials
    return {
      ...b.common,
      animation: false,
      legend: { ...b.common.legend, data: ['Each candidate', 'Best so far'] },
      tooltip: { ...b.common.tooltip, trigger: 'item', formatter: (p: { value: number[] }) => `${gbp(p.value[1])} at ${p.value[0].toFixed(1)}s` },
      xAxis: { ...b.valueAxis('Seconds'), min: 0, max: phase === 'running' ? budget : Math.max(1, Math.ceil(now / 1000)) },
      yAxis: {
        ...b.valueAxis('CV RMSE', b.money),
        scale: true,
        min: best ? Math.floor((best.rmse * 0.94) / 50) * 50 : undefined,
        max: yMax ? Math.ceil(yMax / 50) * 50 : undefined,
      },
      grid: { ...b.common.grid, left: 72 },
      series: [
        {
          name: 'Each candidate',
          type: 'scatter',
          symbolSize: 4,
          itemStyle: { color: b.t.context, opacity: 0.55 },
          data: pts.map((t) => [t.t / 1000, t.rmse]),
          clip: true,
        },
        {
          name: 'Best so far',
          type: 'line',
          step: 'end',
          showSymbol: false,
          lineStyle: { width: 2, color: b.t.palette[0] },
          itemStyle: { color: b.t.palette[0] },
          data: bestLine,
        },
      ],
    }
  }, [trials, best, now, b, budget, phase])

  const running = phase === 'running'
  const remaining = budget * 1000 - now

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          stopWorker()
          if (running) setPhase('setup')
        }
        setOpen(o)
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Sparkles /> Optimise
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Optimise the model</DialogTitle>
          <DialogDescription>
            Tries random formulas (and tweaks of the best one so far) on the filtered cars, scoring each by cross-validated RMSE in £.
            A random {Math.round(DEFAULT_SEARCH.testFrac * 100)}% of cars is held out and only used to score the winner at the end.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Budget
            <Select value={String(budget)} onValueChange={(v) => setBudget(Number(v))} disabled={running}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUDGETS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s < 60 ? `${s} seconds` : `${s / 60} minute${s > 60 ? 's' : ''}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            CV folds
            <Select value={String(folds)} onValueChange={(v) => setFolds(Number(v))} disabled={running}>
              <SelectTrigger size="sm" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[3, 5, 10].map((f) => (
                  <SelectItem key={f} value={String(f)}>
                    {f}-fold
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Seed
            <div className="flex gap-1">
              <Input
                className="h-7 w-24 text-sm tabular-nums"
                type="number"
                value={seed}
                disabled={running}
                onChange={(e) => setSeed(Number(e.target.value) || 0)}
              />
              <Button size="icon-sm" variant="outline" disabled={running} onClick={() => setSeed(Math.floor(Math.random() * 1e6))} aria-label="Random seed">
                <Dice5 />
              </Button>
            </div>
          </label>
          <label className="flex h-7 items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={interactions} onCheckedChange={setInteractions} disabled={running} />
            Interactions
          </label>
          <div className="ml-auto">
            {running ? (
              <Button size="sm" variant="destructive" onClick={stop}>
                <Square /> Stop
              </Button>
            ) : (
              <Button size="sm" onClick={start}>
                <Play /> {phase === 'setup' ? 'Start' : 'Run again'}
              </Button>
            )}
          </div>
        </div>

        {phase !== 'setup' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border px-3 py-2">
              <p className="text-xs text-muted-foreground">{running ? 'Time left' : 'Time taken'}</p>
              <p className="font-heading text-2xl font-semibold tabular-nums">{running ? clock(remaining) : clock(now)}</p>
            </div>
            <div className="rounded-lg border px-3 py-2">
              <p className="text-xs text-muted-foreground">Formulas tried</p>
              <p className="font-heading text-2xl font-semibold tabular-nums">{tried.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border px-3 py-2">
              <p className="text-xs text-muted-foreground">Best CV RMSE</p>
              <p className="font-heading text-2xl font-semibold tabular-nums">{best ? gbp(best.rmse) : '–'}</p>
            </div>
            <div className="rounded-lg border px-3 py-2">
              <p className="text-xs text-muted-foreground">Cars (train / test)</p>
              <p className="font-heading text-2xl font-semibold tabular-nums">{ready ? `${ready.train} / ${ready.test}` : '–'}</p>
            </div>
          </div>
        )}
        {running && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width] duration-100" style={{ width: `${Math.min(100, (now / (budget * 1000)) * 100)}%` }} />
          </div>
        )}

        {error && <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

        {phase !== 'setup' && !error && <EChart option={option} height={260} />}

        {best && (
          <p className="rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs break-words">
            <span className="mr-2 font-sans text-muted-foreground">Best so far:</span>
            {best.formula}
          </p>
        )}

        {result && (
          <>
            <div>
              <p className="mb-1 text-sm font-medium">Held-out test set</p>
              <p className="mb-2 text-xs text-muted-foreground">
                The winner’s CV RMSE ({best ? gbp(best.rmse) : '–'}) is the best of {result.tried.toLocaleString()} tries, so it flatters itself. These are
                scored once on cars the search never saw: the honest comparison.
              </p>
              <Table className="table-fixed text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead className="w-28 text-right">Test RMSE</TableHead>
                    <TableHead className="w-16 text-right">Cars</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.test.map((s) => (
                    <TableRow key={s.label}>
                      <TableCell className="whitespace-normal">
                        {s.label}
                        {s.formula !== '—' && <div className="font-mono text-xs break-words text-muted-foreground">{s.formula}</div>}
                      </TableCell>
                      <TableCell className={cn('text-right tabular-nums', s.label === 'Search winner' && 'font-semibold')}>
                        {s.rmse === null ? 'n/a' : gbp(s.rmse)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{s.n}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Leaderboard (cross-validated)</p>
              <Table className="table-fixed text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Formula</TableHead>
                    <TableHead className="w-14 text-right">Coefs</TableHead>
                    <TableHead className="w-24 text-right">CV RMSE</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.leaderboard.map((t) => (
                    <TableRow key={t.formula}>
                      <TableCell className="font-mono break-words whitespace-normal">{t.formula}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.k}</TableCell>
                      <TableCell className="text-right tabular-nums">{gbp(t.rmse)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="xs"
                          variant={t === result.leaderboard[0] ? 'default' : 'outline'}
                          onClick={() => {
                            onUse(t.formula)
                            setOpen(false)
                          }}
                        >
                          Use
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {ready && ready.excluded.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">
              Not searched ({ready.excluded.length}){ready.dropped > 0 && ` · ${ready.dropped} cars skipped for missing values`}
            </summary>
            <ul className="mt-1 space-y-0.5">
              {ready.excluded.map((x) => (
                <li key={x.name}>
                  <code>{x.name}</code>: {x.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </DialogContent>
    </Dialog>
  )
}
