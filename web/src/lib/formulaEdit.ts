/**
 * Structured edits to a model formula, for the click-to-build UI.
 *
 * Every edit goes through the parser and comes back as canonical text, so the
 * builder can only ever produce formulas the parser accepts. `a * b` comes back
 * expanded as `a + b + a:b`, which means the same thing.
 */
import { parseFormula } from './formula'

export interface FormulaParts {
  response: string
  terms: string[]
  intercept: boolean
}

export function partsOf(text: string): FormulaParts {
  const f = parseFormula(text)
  return { response: f.responseText, terms: f.terms.map((t) => t.key), intercept: f.intercept }
}

export function formatFormula({ response, terms, intercept }: FormulaParts): string {
  const rhs = terms.length ? `${intercept ? '' : '0 + '}${terms.join(' + ')}` : intercept ? '1' : '0'
  return `${response} ~ ${rhs}`
}

/** Re-parse so the result is canonical (and throws if the edit made it invalid). */
const canonical = (p: FormulaParts) => formatFormula(partsOf(formatFormula(p)))

export function addTerm(text: string, term: string): string {
  const p = partsOf(text)
  const key = partsOf(`y ~ ${term}`).terms[0] ?? term
  return p.terms.includes(key) ? formatFormula(p) : canonical({ ...p, terms: [...p.terms, term] })
}

export function removeTerm(text: string, term: string): string {
  const p = partsOf(text)
  return formatFormula({ ...p, terms: p.terms.filter((t) => t !== term) })
}

export function hasTerm(text: string, term: string): boolean {
  try {
    return partsOf(text).terms.includes(partsOf(`y ~ ${term}`).terms[0] ?? term)
  } catch {
    return false
  }
}

export function setResponse(text: string, response: string): string {
  return canonical({ ...partsOf(text), response })
}

export function setIntercept(text: string, intercept: boolean): string {
  return formatFormula({ ...partsOf(text), intercept })
}

/** Ways to enter a numeric column x. */
export function numericVariants(x: string): { term: string; label: string }[] {
  return [
    { term: `log(${x})`, label: 'log' },
    { term: `log1p(${x})`, label: 'log(1 + x), safe at 0' },
    { term: `sqrt(${x})`, label: 'square root' },
    { term: `I(${x}^2)`, label: 'squared (add with x for a curve)' },
    { term: `C(${x})`, label: 'as categories, one effect per value' },
  ]
}

/** A categorical column with an explicit reference level. */
export const withReference = (x: string, level: string) => `C(${x}, ${JSON.stringify(level)})`
