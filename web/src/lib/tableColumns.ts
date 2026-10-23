/** Small helpers shared by the filterable tables: number parsing and remembered column visibility. */
import { useState } from 'react'

/** A filter box's value as a number, or null when blank / not a number. */
export const num = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s))

const storageKey = (table: string) => `ymmv.columns.${table}`

function loadHidden(table: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(storageKey(table)) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Which optional columns of a table are hidden, remembered per table in localStorage (when available). */
export function useHiddenColumns<K extends string>(table: string) {
  const [hidden, setHidden] = useState<K[]>(() => loadHidden(table) as K[])
  const toggle = (k: K) => {
    const next = hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k]
    setHidden(next)
    try {
      localStorage.setItem(storageKey(table), JSON.stringify(next))
    } catch {
      /* storage unavailable: the choice lasts for this visit only */
    }
  }
  return { hidden, shown: (k: K) => !hidden.includes(k), toggle }
}
