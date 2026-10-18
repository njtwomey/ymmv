import { describe, expect, it } from 'vitest'
import { parseFormula } from './formula'
import { mutate, prepare, randomCandidate, Search, toFormula, DEFAULT_SEARCH } from './search'
import { rng } from './stats'
import type { Row } from './types'

// Synthetic cars: price depends on age, mileage and trim; colour is mostly missing.
const TRIMS = ['One', 'Cooper', 'Cooper S', 'JCW']
const rows = Array.from({ length: 300 }, (_, i) => {
  const age = 1 + (i % 12)
  const mileage = 5_000 + ((i * 7919) % 120_000)
  const trim = TRIMS[i % 4]
  const noise = Math.sin(i * 12.9898) * 0.08
  const price = Math.exp(9.8 - 0.1 * age - 0.000005 * mileage + 0.15 * TRIMS.indexOf(trim) + noise)
  return {
    id: i + 1, price_gbp: Math.round(price), age, year: 2026 - age, mileage, engine_l: trim === 'JCW' ? 2 : 1.5,
    distance_miles: (i * 37) % 300, local: (i * 37) % 300 <= 30 ? 'Local' : 'Rest of UK', trim_label: trim,
    fuel: i % 5 === 0 ? 'Diesel' : 'Petrol', transmission: i % 3 ? 'Manual' : 'Automatic', seller_type: i % 4 ? 'TRADE' : 'PRIVATE',
    writeoff_label: 'none', source: 'autotrader', colour: i < 10 ? 'Red' : null, body_type: 'Hatchback', condition: 'used',
    rating: 'GOOD', state: 'For sale',
  } as unknown as Row
})

describe('model search', () => {
  const settings = { ...DEFAULT_SEARCH, seed: 7 }

  it('holds out a test set, drops mostly-missing and non-varying features, never offers leaky ones', () => {
    const p = prepare(rows, settings)
    expect(p.train.length + p.test.length).toBe(300)
    expect(p.test.length).toBe(60)
    const testIds = new Set(p.test.map((r) => r.id))
    expect(p.train.some((r) => testIds.has(r.id))).toBe(false)
    const excluded = Object.fromEntries(p.excluded.map((x) => [x.name, x.reason]))
    expect(excluded.colour).toMatch(/missing/)
    expect(excluded.writeoff).toMatch(/vary/)
    expect(excluded.rating).toMatch(/leak/)
    expect(p.categories).not.toContain('rating')
    expect(p.categories).toContain('trim')
  })

  it('is reproducible from the seed', () => {
    const a = prepare(rows, settings).test.map((r) => r.id)
    expect(prepare(rows, settings).test.map((r) => r.id)).toEqual(a)
    expect(prepare(rows, { ...settings, seed: 8 }).test.map((r) => r.id)).not.toEqual(a)
  })

  it('only generates formulas that parse', () => {
    const p = prepare(rows, settings)
    const rand = rng(3)
    let c = randomCandidate(p, rand, true)
    for (let i = 0; i < 200; i++) {
      expect(() => parseFormula(toFormula(c))).not.toThrow()
      c = i % 2 ? randomCandidate(p, rand, true) : mutate(c, p, rand, true)
    }
  })

  it('keeps interactions only when both parents are present', () => {
    expect(toFormula({ response: 'log(price)', slots: { age: '' }, cats: ['trim'], inter: ['trim:age'] })).toBe('log(price) ~ trim')
    expect(toFormula({ response: 'log(price)', slots: { age: 'age' }, cats: ['trim'], inter: ['trim:age'] })).toBe('log(price) ~ age + trim + trim:age')
  })

  it('writes the same model the same way whatever order it was built in', () => {
    const a = toFormula({ response: 'price', slots: { mileage: 'mileage', age: 'age' }, cats: ['seller_type', 'trim'], inter: [] })
    const b = toFormula({ response: 'price', slots: { age: 'age', mileage: 'mileage' }, cats: ['trim', 'seller_type'], inter: [] })
    expect(a).toBe(b)
  })

  it('finds a model that beats the mean, and scores it on the held-out set', () => {
    const s = new Search(rows, settings, ['log(price) ~ 1'])
    for (let i = 0; i < 60; i++) s.step()
    expect(s.best).not.toBeNull()
    expect(s.trials.every((t, i) => !t.improved || s.trials.slice(0, i).every((u) => u.rmse > t.rmse))).toBe(true)
    const [winner, current, mean] = s.finish('log(price) ~ 1')
    expect(winner.label).toBe('Search winner')
    expect(winner.rmse!).toBeLessThan(mean.rmse!)
    expect(current.rmse).not.toBeNull()
  })
})
