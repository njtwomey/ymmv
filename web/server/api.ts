/**
 * The app's only backend: a Vite plugin that serves /api/* straight from the
 * SQLite database the Python scrapers write (Node's built-in node:sqlite).
 *
 * Everything is read-only except the user's own data, which the scrapers never
 * touch: marks (PUT /api/listings/:id/mark) and saved model configurations
 * (GET/POST /api/models, DELETE /api/models/:id).
 *
 * The listing query adapts to the columns that exist, so an older database
 * (before the cars/variant migration) still loads: missing columns come back null.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import { hasTable, history, listings, listModels, meta, savedModelRow } from './queries.ts'

// YMMV_DB overrides; otherwise ../db/ymmv.sqlite relative to web/.
function dbPath(): string {
  return process.env.YMMV_DB ? path.resolve(process.env.YMMV_DB) : path.resolve(import.meta.dirname, '../../db/ymmv.sqlite')
}

const MARKS = new Set(['interesting', 'want_more', 'contacted', 'rejected'])

function open(write = false): DatabaseSync {
  const file = dbPath()
  if (!existsSync(file)) throw new HttpError(503, `No database at ${file}: run \`make db-restore\` to build it from db/snapshot, or set YMMV_DB.`)
  // Writes wait longer: a running scrape holds the write lock between its commits.
  return new DatabaseSync(file, { readOnly: !write, timeout: write ? 20000 : 5000 })
}

function setMark(id: number, body: { mark?: string | null; note?: string | null }) {
  const db = open(true)
  try {
    if (!hasTable(db, 'marks')) throw new HttpError(409, 'The database has no marks table yet: run the migrations.')
    if (db.prepare(`SELECT 1 FROM listings WHERE id = ?`).get(id) === undefined) throw new HttpError(404, `No listing ${id}`)
    const mark = body.mark ?? null
    if (mark === null) {
      db.prepare(`DELETE FROM marks WHERE listing_id = ?`).run(id)
      return { listing_id: id, mark: null, note: null }
    }
    if (!MARKS.has(mark)) throw new HttpError(400, `Unknown mark '${mark}'`)
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '')
    db.prepare(
      `INSERT INTO marks (listing_id, mark, note, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(listing_id) DO UPDATE SET mark = excluded.mark, note = excluded.note, updated_at = excluded.updated_at`,
    ).run(id, mark, body.note ?? null, now)
    return db.prepare(`SELECT * FROM marks WHERE listing_id = ?`).get(id)
  } finally {
    db.close()
  }
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// ------------------------------------------------------------------ saved models
interface SavedModelBody {
  name?: unknown
  car_id?: unknown
  formula?: unknown
  folds?: unknown
  standardise?: unknown
  filters?: unknown
  metrics?: unknown
}

function saveModel(body: SavedModelBody) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 120) throw new HttpError(400, 'A model needs a name (up to 120 characters).')
  if (typeof body.formula !== 'string' || !body.formula.includes('~')) throw new HttpError(400, 'A model needs a formula.')
  const folds = Number(body.folds)
  if (!Number.isInteger(folds) || folds < 0 || folds > 20) throw new HttpError(400, 'Folds must be a whole number from 0 to 20.')
  const isObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!isObject(body.filters) || !isObject(body.metrics)) throw new HttpError(400, 'Filters and metrics must be objects.')
  const db = open(true)
  try {
    if (!hasTable(db, 'saved_models')) throw new HttpError(409, 'The database has no saved_models table yet: run `make migrate`.')
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '')
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO saved_models (name, car_id, formula, folds, standardise, filters, metrics, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        typeof body.car_id === 'string' ? body.car_id : null,
        body.formula,
        folds,
        body.standardise ? 1 : 0,
        JSON.stringify(body.filters),
        JSON.stringify(body.metrics),
        now,
      )
    return savedModelRow(db.prepare(`SELECT * FROM saved_models WHERE id = ?`).get(lastInsertRowid) as Record<string, unknown>)
  } finally {
    db.close()
  }
}

function deleteModel(id: number) {
  const db = open(true)
  try {
    const { changes } = db.prepare(`DELETE FROM saved_models WHERE id = ?`).run(id)
    if (!changes) throw new HttpError(404, `No saved model ${id}`)
    return { id, deleted: true }
  } finally {
    db.close()
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => (data += chunk.toString()))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        reject(new HttpError(400, 'Body must be JSON'))
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean) // mounted at /api, so ['meta'] etc.
  try {
    if (req.method === 'GET' && parts.length === 1 && parts[0] === 'meta') {
      const db = open()
      try {
        return send(res, 200, meta(db, path.relative(process.cwd(), dbPath())))
      } finally {
        db.close()
      }
    }
    if (req.method === 'GET' && parts.length === 1 && parts[0] === 'listings') {
      const db = open()
      try {
        return send(res, 200, listings(db, url.searchParams.get('car')))
      } finally {
        db.close()
      }
    }
    if (parts[0] === 'models') {
      if (req.method === 'GET' && parts.length === 1) {
        const db = open()
        try {
          return send(res, 200, listModels(db, url.searchParams.get('car')))
        } finally {
          db.close()
        }
      }
      if (req.method === 'POST' && parts.length === 1) return send(res, 201, saveModel((await readBody(req)) as SavedModelBody))
      const modelId = Number(parts[1])
      if (req.method === 'DELETE' && parts.length === 2 && Number.isInteger(modelId)) return send(res, 200, deleteModel(modelId))
    }
    const id = Number(parts[1])
    if (parts[0] === 'listings' && Number.isInteger(id)) {
      if (req.method === 'GET' && parts[2] === 'history') {
        const db = open()
        try {
          return send(res, 200, history(db, id))
        } finally {
          db.close()
        }
      }
      if (req.method === 'PUT' && parts[2] === 'mark') {
        return send(res, 200, setMark(id, (await readBody(req)) as { mark?: string | null; note?: string | null }))
      }
    }
    send(res, 404, { error: `No route ${req.method} /api${url.pathname}` })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (/database is locked|SQLITE_BUSY/i.test(message))
      return send(res, 503, { error: 'The database is busy (probably a scrape is running). Try again in a moment.' })
    send(res, e instanceof HttpError ? e.status : 500, { error: message })
  }
}

export function apiPlugin(): Plugin {
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use('/api', (req, res) => void handle(req, res))
  }
  return { name: 'mini-api', configureServer: mount, configurePreviewServer: mount }
}
