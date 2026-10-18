import { describe, expect, it } from 'vitest'
import { ols, predictRow, tCritical, tPValue } from './ols'

describe('ols', () => {
  it('recovers exact coefficients', () => {
    const X = Array.from({ length: 20 }, (_, i) => [1, i, (i * 7) % 5])
    const y = X.map(([, a, b]) => 3 + 2 * a - 0.5 * b)
    const f = ols(X, y, true)
    expect(f.beta[0]).toBeCloseTo(3, 8)
    expect(f.beta[1]).toBeCloseTo(2, 8)
    expect(f.beta[2]).toBeCloseTo(-0.5, 8)
    expect(f.r2).toBeCloseTo(1, 8)
  })

  it('matches a textbook fit with noise (standard errors)', () => {
    // y = 1 + 2x + e, with fixed residuals so the answer is known.
    const x = [1, 2, 3, 4, 5]
    const e = [0.1, -0.2, 0.05, 0.2, -0.15]
    const y = x.map((v, i) => 1 + 2 * v + e[i])
    const f = ols(
      x.map((v) => [1, v]),
      y,
      true,
    )
    // Closed form: slope = Sxy/Sxx, se = sigma/sqrt(Sxx)
    const mx = 3
    const my = y.reduce((a, b) => a + b) / 5
    const sxx = x.reduce((a, v) => a + (v - mx) ** 2, 0)
    const slope = x.reduce((a, v, i) => a + (v - mx) * (y[i] - my), 0) / sxx
    const resid = y.map((v, i) => v - (my - slope * mx) - slope * x[i])
    const sigma = Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / 3)
    expect(f.beta[1]).toBeCloseTo(slope, 10)
    expect(f.se[1]).toBeCloseTo(sigma / Math.sqrt(sxx), 10)
  })

  it('drops exactly collinear columns instead of failing', () => {
    const X = Array.from({ length: 10 }, (_, i) => [1, i, 2 * i, i % 3])
    const y = X.map(([, a, , c]) => 1 + a + c)
    const f = ols(X, y, true)
    expect(f.kept).toEqual([true, true, false, true])
    expect(Number.isNaN(f.beta[2])).toBe(true)
    // Like R's predict.lm: the dropped column contributes 0, reproducing the fit.
    expect(predictRow(f, [1, 2, 4, 1])).toBeCloseTo(4, 8)
    X.forEach((x, i) => expect(predictRow(f, x)).toBeCloseTo(y[i], 8))
  })

  it("won't predict a category level the fit never saw", () => {
    // Column 2 is a dummy that is all zero in the training data.
    const X = Array.from({ length: 10 }, (_, i) => [1, i, 0])
    const y = X.map(([, a]) => 1 + a)
    const f = ols(X, y, true)
    expect(f.unseen).toEqual([false, false, true])
    expect(predictRow(f, [1, 3, 1])).toBeNull()
    expect(predictRow(f, [1, 3, 0])).toBeCloseTo(4, 8)
  })
})

describe('t distribution', () => {
  it('gives the familiar critical values', () => {
    expect(tCritical(1e6)).toBeCloseTo(1.96, 2)
    expect(tCritical(10)).toBeCloseTo(2.228, 3)
  })
  it('gives two-sided p-values', () => {
    expect(tPValue(2.228, 10)).toBeCloseTo(0.05, 3)
    expect(tPValue(0, 10)).toBeCloseTo(1, 6)
  })
})
