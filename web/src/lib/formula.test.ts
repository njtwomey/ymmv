import { describe, expect, it } from 'vitest'
import { buildDesign, FormulaError, parseFormula, responseKind } from './formula'

const terms = (f: string) => parseFormula(f).terms.map((t) => t.key)

describe('parseFormula', () => {
  it('parses the default formula', () => {
    const f = parseFormula('log(price) ~ age + I(age^2) + log1p(mileage) + engine_l + trim + fuel')
    expect(f.responseText).toBe('log(price)')
    expect(f.terms.map((t) => t.key)).toEqual(['age', 'I(age^2)', 'log1p(mileage)', 'engine_l', 'trim', 'fuel'])
    expect(f.intercept).toBe(true)
  })

  it('expands * into main effects and the interaction', () => {
    expect(terms('y ~ a * b')).toEqual(['a', 'b', 'a:b'])
    expect(terms('y ~ a * b * c')).toEqual(['a', 'b', 'a:b', 'c', 'a:c', 'b:c', 'a:b:c'])
  })

  it('treats a:b and b:a as the same term and dedupes', () => {
    expect(terms('y ~ a:b + b:a + a + a')).toEqual(['a:b', 'a'])
  })

  it('binds : tighter than *', () => {
    expect(terms('y ~ a * b:c')).toEqual(['a', 'b:c', 'a:b:c'])
  })

  it('handles grouping', () => {
    expect(terms('y ~ (a + b):c')).toEqual(['a:c', 'b:c'])
  })

  it('removes terms and the intercept', () => {
    expect(terms('y ~ a * b - a:b')).toEqual(['a', 'b'])
    expect(parseFormula('y ~ x - 1').intercept).toBe(false)
    expect(parseFormula('y ~ 0 + x').intercept).toBe(false)
    expect(parseFormula('y ~ -1 + x').intercept).toBe(false)
    expect(parseFormula('y ~ x + 1').intercept).toBe(true)
  })

  it('parses arithmetic inside I() with precedence', () => {
    expect(terms('y ~ I(a + b * c^2) + I(-x^2)')).toEqual(['I(a+(b*(c^2)))', 'I(-(x^2))'])
  })

  it('parses C() with a reference level', () => {
    const f = parseFormula('y ~ C(trim, "Cooper")')
    expect(f.terms[0].factors[0]).toMatchObject({ categorical: true, varName: 'trim', ref: 'Cooper' })
  })

  it('reports helpful errors', () => {
    expect(() => parseFormula('price age')).toThrow(FormulaError)
    expect(() => parseFormula('y ~ foo(x)')).toThrow(/Unknown function/)
    expect(() => parseFormula('y ~ x^2')).toThrow(/I\(x\^2\)/)
    expect(() => parseFormula('y ~ x +')).toThrow(FormulaError)
    expect(() => parseFormula('y ~ 2')).toThrow(/0 or 1/)
    expect(() => parseFormula('y ~ C(log(x))')).toThrow(/C\(\)/)
  })

  it('recognises invertible responses', () => {
    expect(responseKind(parseFormula('log(price) ~ x'))).toEqual({ kind: 'log', variable: 'price' })
    expect(responseKind(parseFormula('price ~ x'))).toEqual({ kind: 'identity', variable: 'price' })
    expect(responseKind(parseFormula('I(price/2) ~ x')).kind).toBe('other')
  })
})

describe('buildDesign', () => {
  const data = [
    { y: 1, x: 1, g: 'a', h: 'p' },
    { y: 2, x: 2, g: 'b', h: 'p' },
    { y: 3, x: 3, g: 'b', h: 'q' },
    { y: 4, x: null, g: 'a', h: 'q' },
    { y: 5, x: 5, g: 'c', h: 'p' },
  ]

  it('dummy-codes categorical columns against the most frequent level', () => {
    const d = buildDesign(parseFormula('y ~ x + g'), data)
    expect(d.columns.map((c) => c.name)).toEqual(['(Intercept)', 'x', 'g[a]', 'g[c]'])
    expect(d.dropped).toBe(1) // x is null in one row
    expect(d.X[0]).toEqual([1, 1, 1, 0])
  })

  it('honours explicit reference levels and aliases', () => {
    const d = buildDesign(parseFormula('y ~ C(group, "c")'), data, { aliases: { group: 'g' } })
    expect(d.columns.map((c) => c.name)).toEqual(['(Intercept)', 'C(group, "c")[a]', 'C(group, "c")[b]'])
  })

  it('builds interaction columns as products', () => {
    const d = buildDesign(parseFormula('y ~ x:h'), data)
    expect(d.columns.map((c) => c.name)).toEqual(['(Intercept)', 'h[q]:x'])
    expect(d.X.map((r) => r[1])).toEqual([0, 0, 3, 0])
  })

  it('drops terms that do not vary', () => {
    const d = buildDesign(parseFormula('y ~ x + k'), data.map((r) => ({ ...r, k: 'same' })))
    expect(d.columns.map((c) => c.name)).toEqual(['(Intercept)', 'x'])
    expect(d.warnings[0]).toMatch(/k doesn't vary/)
  })

  it('treats numeric columns as factors under C(), with consistent level labels', () => {
    const cars = [
      { y: 1, e: 1.6 },
      { y: 2, e: 2 },
      { y: 3, e: 1.5 },
      { y: 4, e: 1.5 },
      { y: 5, e: null },
    ]
    const d = buildDesign(parseFormula('y ~ C(e)'), cars)
    expect(d.columns.map((c) => c.name)).toEqual(['(Intercept)', 'C(e)[1.6]', 'C(e)[2.0]'])
    expect(d.dropped).toBe(1)
    expect(d.encode({ e: 2 })).toEqual([1, 0, 1])
    expect(d.encode({ e: 1.4 })).toBeNull()
    const ref = buildDesign(parseFormula('y ~ C(e, "2.0")'), cars)
    expect(ref.columns.map((c) => c.name)).toEqual(['(Intercept)', 'C(e, "2.0")[1.5]', 'C(e, "2.0")[1.6]'])
  })

  it('rejects unknown columns', () => {
    expect(() => buildDesign(parseFormula('y ~ nope'), data)).toThrow(/Unknown column 'nope'/)
  })

  it('encodes new rows and refuses unseen levels', () => {
    const d = buildDesign(parseFormula('y ~ x + g'), data)
    expect(d.encode({ x: 2, g: 'c' })).toEqual([1, 2, 0, 1])
    expect(d.encode({ x: 2, g: 'zzz' })).toBeNull()
  })
})
