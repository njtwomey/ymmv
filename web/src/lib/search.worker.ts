/// <reference lib="webworker" />
/** Runs a model Search off the main thread, streaming trials until the budget or a stop. */
import { Search, type SearchSettings, type TestScore, type Trial } from './search'
import type { Row } from './types'

export type SearchRequest =
  | { type: 'start'; rows: Row[]; settings: SearchSettings; budgetMs: number; current: string }
  | { type: 'stop' }

export type SearchMessage =
  | { type: 'ready'; train: number; test: number; dropped: number; excluded: { name: string; reason: string }[] }
  | { type: 'progress'; trials: Trial[]; tried: number; elapsed: number }
  | { type: 'done'; tried: number; elapsed: number; leaderboard: Trial[]; test: TestScore[]; stopped: boolean }
  | { type: 'error'; message: string }

let stopped = false
const post = (m: SearchMessage) => self.postMessage(m)

self.onmessage = async (e: MessageEvent<SearchRequest>) => {
  if (e.data.type === 'stop') {
    stopped = true
    return
  }
  const { rows, settings, budgetMs, current } = e.data
  stopped = false
  try {
    const search = new Search(rows, settings, [current])
    const p = search.prepared
    post({ type: 'ready', train: p.train.length, test: p.test.length, dropped: p.dropped, excluded: p.excluded })
    if (p.train.length < 50) throw new Error(`Only ${p.train.length} training cars: loosen the filters to search.`)
    const start = Date.now()
    let sent = 0
    while (!stopped && Date.now() - start < budgetMs) {
      const sliceEnd = Math.min(Date.now() + 200, start + budgetMs)
      while (Date.now() < sliceEnd) search.step()
      post({ type: 'progress', trials: search.trials.slice(sent), tried: search.tried, elapsed: Date.now() - start })
      sent = search.trials.length
      await new Promise((r) => setTimeout(r, 0)) // let a 'stop' message in
    }
    post({
      type: 'done',
      tried: search.tried,
      elapsed: Date.now() - start,
      leaderboard: search.leaderboard(10),
      test: search.finish(current),
      stopped,
    })
  } catch (err) {
    post({ type: 'error', message: (err as Error).message })
  }
}
