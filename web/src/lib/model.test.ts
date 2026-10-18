import { describe, expect, it } from 'vitest'
import { fitModel } from './model'
import type { Row } from './types'

// Synthetic listings: price falls with age and mileage; diesels a bit cheaper.
const rows = Array.from({ length: 120 }, (_, i) => {
  const age = 1 + (i % 12)
  const mileage = 5_000 + ((i * 7919) % 120_000)
  const fuel = i % 3 === 0 ? 'Diesel' : 'Petrol'
  const noise = Math.sin(i * 12.9898) * 0.05
  const price = Math.exp(10 - 0.12 * age - 0.000004 * mileage - (fuel === 'Diesel' ? 0.1 : 0) + noise)
  return { id: i + 1, age, mileage, fuel, price_gbp: Math.round(price) } as unknown as Row
})
const formula = 'log(price) ~ age + I(age^2) + mileage + fuel'

describe('standardisation', () => {
  const raw = fitModel(rows, formula, { folds: 5 })
  const std = fitModel(rows, formula, { folds: 5, standardise: true })

  it('does not change predictions or cross-validation', () => {
    for (const [id, p] of raw.fitted) expect(std.fitted.get(id)).toBeCloseTo(p, 6)
    expect(std.cv!.r2).toBeCloseTo(raw.cv!.r2, 8)
    expect(std.predict(rows[5])).toBeCloseTo(raw.predict(rows[5])!, 6)
  })

  it('reports numeric effects per SD and leaves categories alone', () => {
    const coef = (m: typeof raw, name: string) => m.coefs.find((c) => c.name === name)!
    const age = coef(std, 'age')
    expect(age.sd).toBeGreaterThan(0)
    expect(age.estimate).toBeCloseTo(coef(raw, 'age').estimate * age.sd!, 8)
    expect(coef(std, 'age').p).toBeCloseTo(coef(raw, 'age').p, 8)
    const diesel = std.coefs.find((c) => c.name.startsWith('fuel'))!
    expect(diesel.sd).toBeNull()
    expect(diesel.estimate).toBeCloseTo(raw.coefs.find((c) => c.name.startsWith('fuel'))!.estimate, 8)
  })
})

describe('rank-deficient formulas', () => {
  it('still predicts every car when a term duplicates another', () => {
    const dup = rows.map((r) => ({ ...r, age2: (r as unknown as { age: number }).age * 2 })) as unknown as Row[]
    const m = fitModel(dup, 'log(price) ~ age + age2 + mileage', { folds: 5 })
    expect(m.warnings.some((w) => w.includes('collinear'))).toBe(true)
    expect(m.fitted.size).toBe(rows.length)
    expect(m.cv).not.toBeNull()
  })
})

describe('ordered categories', () => {
  const asC = fitModel(rows, 'log(price) ~ C(age) + mileage', { folds: 5 })
  const asO = fitModel(rows, 'log(price) ~ O(age) + mileage', { folds: 0 })

  it('fit the same as C() but read as steps between neighbouring levels', () => {
    for (const [id, p] of asC.fitted) expect(asO.fitted.get(id)).toBeCloseTo(p, 6)
    const c = (m: typeof asC, name: string) => m.coefs.find((x) => x.name === name)!.estimate
    // C() is against the most common level, so compare differences.
    expect(c(asO, 'O(age)[≥6]')).toBeCloseTo(c(asC, 'C(age)[6]') - c(asC, 'C(age)[5]'), 6)
  })

  it('still predicts in cross-validation when a fold never saw a level', () => {
    // One car is 20 years old: whichever fold holds it, the rest never saw age 20.
    const old = [...rows, { ...rows[0], id: 999, age: 20 } as unknown as Row]
    const c = fitModel(old, 'log(price) ~ C(age) + mileage', { folds: 5 })
    const o = fitModel(old, 'log(price) ~ O(age) + mileage', { folds: 5 })
    expect(c.oof.has(999)).toBe(false)
    expect(o.oof.has(999)).toBe(true)
    expect(o.cv!.n).toBe(old.length)
  })
})
