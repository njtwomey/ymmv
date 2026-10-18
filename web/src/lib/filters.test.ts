import { describe, expect, it } from 'vitest'
import { DEFAULT_FORMULA } from './config'
import { DEFAULT_FILTERS, NO_FILTERS, readView, writeView, type Filters, type ViewState } from './filters'

const view = (filters: Filters): ViewState => ({ car: null, tab: 'overview', filters, formula: DEFAULT_FORMULA, folds: 5, standardise: true })
const roundTrip = (filters: Filters) => readView(writeView(view(filters))).filters

describe('filter URLs', () => {
  it('opens with the defaults and an empty query string', () => {
    expect(readView('').filters).toEqual(DEFAULT_FILTERS)
    expect(writeView(view(DEFAULT_FILTERS))).toBe('')
  })

  it('defaults to petrol manuals from 2016, without write-offs', () => {
    expect(DEFAULT_FILTERS).toMatchObject({
      fuels: ['Petrol'],
      transmissions: ['Manual'],
      sellers: [],
      yearMin: 2016,
      yearMax: null,
      priceMax: null,
      writeoffs: 'exclude',
    })
  })

  it('keeps cleared defaults through a reload', () => {
    expect(roundTrip(NO_FILTERS)).toEqual(NO_FILTERS)
    expect(roundTrip({ ...DEFAULT_FILTERS, yearMin: null, fuels: [] })).toEqual({ ...DEFAULT_FILTERS, yearMin: null, fuels: [] })
  })

  it('keeps changed values through a reload', () => {
    const f = { ...DEFAULT_FILTERS, fuels: ['Petrol', 'Diesel'], priceMax: 8000, writeoffs: 'only' as const, sellers: ['PRIVATE'] }
    expect(roundTrip(f)).toEqual(f)
  })
})
