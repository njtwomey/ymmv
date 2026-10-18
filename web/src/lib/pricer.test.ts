import { describe, expect, it } from 'vitest'
import { fitModel } from './model'
import { priceFields, referenceYear, rowFromValues } from './pricer'
import type { Row } from './types'

const TRIMS = ['One', 'Cooper', 'Cooper S', 'JCW']
const rows = Array.from({ length: 400 }, (_, i) => {
  const year = 2016 + (i % 9)
  const age = 2026 - year
  const mileage = 5_000 + ((i * 7919) % 120_000)
  const trim = TRIMS[i % 4]
  const engine_l = trim === 'JCW' || trim === 'Cooper S' ? 2 : 1.5
  const noise = Math.sin(i * 12.9898) * 0.08
  const price = Math.exp(9.8 - 0.1 * age - 0.000005 * mileage + 0.15 * TRIMS.indexOf(trim) + noise)
  return {
    id: i + 1, price_gbp: Math.round(price), year, age, mileage, engine_l, trim_label: trim,
    local: i % 7 === 0 ? 'Local' : 'Rest of UK', seller_type: i % 4 ? 'TRADE' : 'PRIVATE', seen_at: new Date('2026-10-18T12:00:00Z'),
  } as unknown as Row
})
const formula = 'sqrt(price) ~ C(year) + mileage + engine_l + local + trim + seller_type + trim:log1p(mileage) + trim:age + C(engine_l):age'

describe('price a car', () => {
  const model = fitModel(rows, formula, { folds: 0, standardise: true })
  const fields = priceFields(model, rows)
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]))

  it('asks for the formula’s inputs: dropdowns for categories, numbers otherwise, year instead of age', () => {
    expect(Object.keys(byName).sort()).toEqual(['engine_l', 'local', 'mileage', 'seller_type', 'trim', 'year'])
    expect(byName.year.kind).toBe('category')
    expect(byName.year.options).toEqual(['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024'])
    expect(byName.engine_l).toMatchObject({ kind: 'category', options: ['1.5', '2.0'] })
    expect(byName.trim.kind).toBe('category')
    expect(byName.mileage.kind).toBe('number')
    expect(byName.age).toBeUndefined()
  })

  it('reproduces the model’s own prediction for a car it was fitted on', () => {
    const car = rows[17] as unknown as Record<string, number | string>
    const values = {
      year: String(car.year), mileage: String(car.mileage), engine_l: Number(car.engine_l).toFixed(1),
      trim: String(car.trim_label), local: String(car.local), seller_type: String(car.seller_type),
    }
    const p = model.predictInterval(rowFromValues(fields, values, referenceYear(rows)))!
    expect(p.fit).toBeCloseTo(model.fitted.get(18)!, 6)
    expect(p.lo).toBeLessThan(p.fit)
    expect(p.hi).toBeGreaterThan(p.fit)
  })

  it('gives 95% ranges that cover about 95% of cars', () => {
    const inside = rows.filter((r) => {
      const p = model.predictInterval(r as unknown as Record<string, unknown>)!
      return r.price_gbp! >= p.lo && r.price_gbp! <= p.hi
    }).length
    expect(inside / rows.length).toBeGreaterThan(0.9)
    expect(inside / rows.length).toBeLessThan(0.995)
  })

  it('prices the typical car from the defaults', () => {
    expect(model.predictInterval(rowFromValues(fields, {}, 2026))).not.toBeNull()
  })
})
