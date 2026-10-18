/** Human labels for model inputs and their values, shared by the explanation views. */
import { type Dim, levelLabel } from './dims'
import { miles } from './format'
import { fieldColumns } from './pricer'

const NAMES: Record<string, string> = {
  year: 'Registration year',
  mileage: 'Mileage',
  engine_l: 'Engine',
  engine: 'Engine',
  trim: 'Trim',
  fuel: 'Fuel',
  transmission: 'Gearbox',
  gearbox: 'Gearbox',
  seller_type: 'Seller',
  seller: 'Seller',
  local: 'Location',
  writeoff: 'Write-off',
  distance_miles: 'Distance',
  source: 'Source',
  colour: 'Colour',
}
const DIM_OF: Record<string, Dim> = { seller_type: 'seller_type', seller: 'seller_type', local: 'local', source: 'source', rating: 'rating' }

export const inputName = (name: string) => NAMES[name] ?? name

/** A value as shown to a person: "64,513 mi", "1.5 L", "Trade (dealer)", "2019". */
export function formatValue(name: string, v: unknown, place: string): string {
  if (v === null || v === undefined || v === '') return '–'
  if (name === 'mileage') return miles(Number(v))
  if (name === 'engine_l' || name === 'engine') return `${Number(v).toFixed(1)} L`
  if (name === 'distance_miles') return `${v} mi`
  if (DIM_OF[name]) return levelLabel(DIM_OF[name], String(v), place)
  return String(v)
}

export const valueIn = (name: string, row: Record<string, unknown>, place: string) =>
  formatValue(name, row[fieldColumns(name)[0]], place)

/** "Trim + Engine" */
export const groupName = (names: string[]) => names.map(inputName).join(' + ')

/** "Cooper, 1.5 L" */
export const groupValue = (names: string[], row: Record<string, unknown>, place: string) =>
  names.map((n) => valueIn(n, row, place)).join(', ')
