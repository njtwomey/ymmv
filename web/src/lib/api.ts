import type { HistoryPoint, Listing, MarkValue, Meta, SavedModel } from './types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  return body
}

/**
 * The published site (`vite build --mode static`) has no server: it reads the JSON
 * that scripts/export-static.ts built from db/snapshot, and can't write.
 */
export const READ_ONLY = import.meta.env.MODE === 'static'
const data = (file: string) => `${import.meta.env.BASE_URL}data/${file}`
const readOnly = () => Promise.reject(new Error('This is a read-only snapshot: changes need the local app.'))
let historyFile: Promise<Record<string, HistoryPoint[]>> | null = null

const staticApi = {
  meta: () => request<Meta>(data('meta.json')),
  listings: (car: string | null) => request<Listing[]>(data(`listings-${car ? encodeURIComponent(car) : 'all'}.json`)),
  history: async (id: number) => ((await (historyFile ??= request(data('history.json'))))[String(id)] ?? []) as HistoryPoint[],
  setMark: (_id: number, _mark: MarkValue | null, _note: string | null) => readOnly() as Promise<never>,
  models: async (car: string | null) => (await request<SavedModel[]>(data('models.json'))).filter((m) => !car || !m.car_id || m.car_id === car),
  saveModel: (_m: Omit<SavedModel, 'id' | 'created_at'>) => readOnly() as Promise<never>,
  deleteModel: (_id: number) => readOnly() as Promise<never>,
}

const liveApi = {
  meta: () => request<Meta>('/api/meta'),
  listings: (car: string | null) => request<Listing[]>(car ? `/api/listings?car=${encodeURIComponent(car)}` : '/api/listings'),
  history: (id: number) => request<HistoryPoint[]>(`/api/listings/${id}/history`),
  setMark: (id: number, mark: MarkValue | null, note: string | null) =>
    request<{ listing_id: number; mark: MarkValue | null; note: string | null }>(`/api/listings/${id}/mark`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mark, note }),
    }),
  models: (car: string | null) => request<SavedModel[]>(car ? `/api/models?car=${encodeURIComponent(car)}` : '/api/models'),
  saveModel: (m: Omit<SavedModel, 'id' | 'created_at'>) =>
    request<SavedModel>('/api/models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) }),
  deleteModel: (id: number) => request<{ id: number; deleted: boolean }>(`/api/models/${id}`, { method: 'DELETE' }),
}

export const api = READ_ONLY ? staticApi : liveApi
