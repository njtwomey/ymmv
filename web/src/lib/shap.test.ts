import { describe, expect, it } from 'vitest'
import { fitModel } from './model'
import { priceFields } from './pricer'
import { explain, groupDependent, theilsU } from './shap'
import type { Row } from './types'

const TRIMS = ['One', 'Cooper', 'Cooper S', 'JCW']
const rows = Array.from({ length: 300 }, (_, i) => {
  const year = 2016 + (i % 9)
  const mileage = 5_000 + ((i * 7919) % 120_000)
  const trim = TRIMS[i % 4]
  const noise = Math.sin(i * 12.9898) * 400
  const price = 4000 + 900 * (year - 2016) - 0.03 * mileage + 1500 * TRIMS.indexOf(trim) + noise
  return {
    id: i + 1, price_gbp: Math.round(price), year, age: 2026 - year, mileage, trim_label: trim,
    engine_l: trim === 'JCW' || trim === 'Cooper S' ? 2 : 1.5, local: i % 7 ? 'Rest of UK' : 'Local',
    seller_type: i % 5 ? 'TRADE' : 'PRIVATE', seen_at: new Date('2026-10-18T12:00:00Z'),
  } as unknown as Row
})
const R = (r: Row) => r as unknown as Record<string, unknown>

describe('SHAP', () => {
  it('matches the closed form for an additive linear model: phi = beta * (x - background mean)', () => {
    const model = fitModel(rows, 'price ~ mileage + trim', { folds: 0 })
    const fields = priceFields(model, rows)
    const target = rows[10]
    const e = explain(model, R(target), rows.map(R), fields, { maxEvals: 1e9 })!
    const beta = model.coefs.find((c) => c.name === 'mileage')!.estimate
    const meanMiles = rows.reduce((a, r) => a + r.mileage!, 0) / rows.length
    const phiMiles = e.contributions.find((c) => c.names.includes('mileage'))!.phi
    expect(phiMiles).toBeCloseTo(beta * (target.mileage! - meanMiles), 6)
  })

  it('adds up: base + contributions = prediction, even with interactions on the sqrt scale', () => {
    const f = 'sqrt(price) ~ C(year) + mileage + engine_l + local + trim + seller_type + trim:log1p(mileage) + trim:age + C(engine_l):age'
    const model = fitModel(rows, f, { folds: 0, standardise: true })
    const fields = priceFields(model, rows)
    for (const r of [rows[3], rows[150], rows[299]]) {
      const e = explain(model, R(r), rows.map(R), fields)!
      expect(e.method).toBe('exact')
      expect(e.base + e.contributions.reduce((a, c) => a + c.phi, 0)).toBeCloseTo(e.prediction, 6)
      expect(e.prediction).toBeCloseTo(model.fitted.get(r.id)!, 6)
    }
  })

  it('sampling agrees with the exact answer', () => {
    const model = fitModel(rows, 'log(price) ~ age + I(age^2) + log1p(mileage) + trim + trim:age', { folds: 0 })
    const fields = priceFields(model, rows)
    const exact = explain(model, R(rows[42]), rows.map(R), fields, { maxEvals: 1e9 })!
    const sampled = explain(model, R(rows[42]), rows.map(R), fields, { maxExact: 0, maxEvals: 200_000 })!
    expect(sampled.method).toBe('sampled')
    for (const c of exact.contributions) {
      const s = sampled.contributions.find((x) => x.names.join() === c.names.join())!
      expect(Math.abs(s.phi - c.phi)).toBeLessThan(Math.max(60, Math.abs(c.phi) * 0.15))
    }
  })

  it('is quick enough to feel instant', () => {
    const f = 'sqrt(price) ~ C(year) + mileage + engine_l + local + trim + seller_type + trim:log1p(mileage) + trim:age + C(engine_l):age'
    const model = fitModel(rows, f, { folds: 0 })
    const fields = priceFields(model, rows)
    const t0 = performance.now()
    explain(model, R(rows[7]), rows.map(R), fields)
    expect(performance.now() - t0).toBeLessThan(1500)
  })

  it('explains near-duplicate inputs together, and keeps distinct ones apart', () => {
    const model = fitModel(rows, 'sqrt(price) ~ C(year) + mileage + engine_l + trim + seller_type', { folds: 0 })
    const fields = priceFields(model, rows)
    const groups = groupDependent(fields, rows.map(R)).map((g) => g.map((i) => fields[i].name).sort())
    expect(groups).toContainEqual(['engine_l', 'trim']) // engine follows from trim here
    expect(groups).toContainEqual(['mileage'])
    expect(groups).toContainEqual(['year'])
    const e = explain(model, R(rows[5]), rows.map(R), fields, { groups: groupDependent(fields, rows.map(R)) })!
    expect(e.base + e.contributions.reduce((a, c) => a + c.phi, 0)).toBeCloseTo(e.prediction, 6)
  })

  it("measures one-way dependence with Theil's U", () => {
    const trim = ['One', 'Cooper', 'Cooper S', 'JCW', 'One', 'Cooper', 'Cooper S', 'JCW']
    const engine = ['1.5', '1.5', '2.0', '2.0', '1.5', '1.5', '2.0', '2.0']
    expect(theilsU(engine, trim)).toBeCloseTo(1, 8) // trim determines engine
    expect(theilsU(trim, engine)).toBeCloseTo(0.5, 8) // engine only halves the trim uncertainty
    expect(theilsU(['a', 'b', 'a', 'b'], ['x', 'x', 'y', 'y'])).toBeCloseTo(0, 8)
  })
})
