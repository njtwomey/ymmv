/**
 * Build the static data for the published site from db/snapshot/*.sql, the single
 * source of truth. Rebuilds a throwaway SQLite database from the snapshot, then
 * writes the same JSON the dev API serves (via server/queries.ts):
 *
 *   meta.json, listings-all.json, listings-<car>.json, history.json, models.json
 *
 * Usage: node scripts/export-static.ts [outDir=dist/data] [snapshotDir=../db/snapshot]
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { allHistory, listings, listModels, meta } from '../server/queries.ts'

const [outDir = 'dist/data', snapshotDir = path.resolve(import.meta.dirname, '../../db/snapshot')] = process.argv.slice(2)
const tmp = path.join(os.tmpdir(), `ymmv-static-${process.pid}.sqlite`)

// The snapshot is a copy of a consistent database, so load it as is: Node enforces
// foreign keys by default, which would make table order matter.
const db = new DatabaseSync(tmp, { enableForeignKeyConstraints: false })
try {
  db.exec(readFileSync(path.join(snapshotDir, 'tables.sql'), 'utf8'))
  for (const file of readdirSync(snapshotDir).filter((f) => f.endsWith('.sql') && f !== 'tables.sql').sort()) {
    db.exec(`BEGIN;\n${readFileSync(path.join(snapshotDir, file), 'utf8')}COMMIT;`)
  }

  mkdirSync(outDir, { recursive: true })
  const write = (name: string, data: unknown) => {
    const body = JSON.stringify(data)
    writeFileSync(path.join(outDir, name), body)
    console.log(`${name.padEnd(32)} ${(body.length / 1024).toFixed(0).padStart(6)} KB`)
  }
  const m = meta(db, 'db/snapshot')
  write('meta.json', m)
  write('listings-all.json', listings(db, null))
  for (const car of m.cars) write(`listings-${car.id}.json`, listings(db, String(car.id)))
  write('history.json', allHistory(db))
  write('models.json', listModels(db, null))
} finally {
  db.close()
  rmSync(tmp, { force: true })
}
