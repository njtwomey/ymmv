import { describe, expect, it } from 'vitest'
import { DEFAULT_FORMULA } from './config'
import { addTerm, formatFormula, hasTerm, partsOf, removeTerm, setIntercept, setResponse, withReference } from './formulaEdit'

describe('formula edits', () => {
  const base = 'log(price) ~ age + mileage'

  it('adds terms once, canonically', () => {
    expect(addTerm(base, 'trim')).toBe('log(price) ~ age + mileage + trim')
    expect(addTerm(base, 'mileage')).toBe(base)
    expect(addTerm(base, 'I(age ^ 2)')).toBe('log(price) ~ age + mileage + I(age^2)')
    expect(addTerm(base, withReference('trim', 'Cooper'))).toBe('log(price) ~ age + mileage + C(trim, "Cooper")')
    expect(addTerm(base, 'fuel:transmission')).toBe('log(price) ~ age + mileage + fuel:transmission')
  })

  it('removes terms and keeps a valid formula when empty', () => {
    expect(removeTerm(base, 'age')).toBe('log(price) ~ mileage')
    expect(removeTerm(removeTerm(base, 'age'), 'mileage')).toBe('log(price) ~ 1')
    expect(() => partsOf(removeTerm(removeTerm(base, 'age'), 'mileage'))).not.toThrow()
  })

  it('changes the response and the intercept', () => {
    expect(setResponse(base, 'price')).toBe('price ~ age + mileage')
    expect(setIntercept(base, false)).toBe('log(price) ~ 0 + age + mileage')
    expect(partsOf(setIntercept(base, false)).intercept).toBe(false)
  })

  it('knows what is in the formula', () => {
    expect(hasTerm(base, 'age')).toBe(true)
    expect(hasTerm(base, 'trim')).toBe(false)
    expect(hasTerm('not a formula', 'age')).toBe(false)
  })

  it('round-trips the default formula', () => {
    expect(partsOf(formatFormula(partsOf(DEFAULT_FORMULA)))).toEqual(partsOf(DEFAULT_FORMULA))
  })
})
