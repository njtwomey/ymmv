/**
 * R-style model formulas (Wilkinson notation) and design matrices.
 *
 *   log(price) ~ age + I(age^2) + log1p(mileage) + trim * transmission - 1
 *
 * Supported:
 *   response    any arithmetic expression, e.g. log(price), sqrt(price), price
 *   a + b       add terms            a - b   remove terms (`- 1` drops the intercept)
 *   a:b         interaction          a * b   a + b + a:b
 *   0 / 1       no intercept / intercept     ( ... )  grouping
 *   log, log1p, sqrt, exp, abs        numeric transforms of a column
 *   I(expr)     arithmetic: + - * / ^ and numbers, e.g. I(age^2), I(mileage / 1000)
 *   C(x), C(x, "ref")   treat x as categorical, optionally choosing its reference level
 *
 * String/boolean columns are categorical automatically, with treatment (dummy)
 * contrasts. The reference level is the most frequent one unless C(x, "ref")
 * or the `refs` option says otherwise. Levels or columns that don't vary in the
 * data are dropped with a warning instead of failing.
 */

export class FormulaError extends Error {
  pos?: number
  constructor(message: string, pos?: number) {
    super(message)
    this.name = 'FormulaError'
    this.pos = pos
  }
}

// ------------------------------------------------------------------ tokens
type TokType = 'num' | 'ident' | 'str' | 'op'
interface Tok {
  type: TokType
  value: string
  pos: number
}

const OPS = new Set(['~', '+', '-', '*', '/', '^', ':', '(', ')', ','])

export function tokenize(text: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (/\s/.test(c)) {
      i++
    } else if (/[0-9.]/.test(c) && /[0-9]/.test(text.slice(i, i + 2).replace('.', ''))) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i))!
      out.push({ type: 'num', value: m[0], pos: i })
      i += m[0].length
    } else if (/[A-Za-z_.]/.test(c)) {
      const m = /^[A-Za-z_.][A-Za-z0-9_.]*/.exec(text.slice(i))!
      out.push({ type: 'ident', value: m[0], pos: i })
      i += m[0].length
    } else if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1)
      if (end < 0) throw new FormulaError('Unterminated string', i)
      out.push({ type: 'str', value: text.slice(i + 1, end), pos: i })
      i = end + 1
    } else if (OPS.has(c)) {
      out.push({ type: 'op', value: c, pos: i })
      i++
    } else {
      throw new FormulaError(`Unexpected character '${c}'`, i)
    }
  }
  return out
}

// ------------------------------------------------------------------ expressions
export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'var'; name: string }
  | { kind: 'neg'; arg: Expr }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Expr; right: Expr }
  | { kind: 'call'; fn: string; args: Expr[] }

export const FUNCTIONS: Record<string, (x: number) => number> = {
  log: Math.log,
  log1p: Math.log1p,
  sqrt: Math.sqrt,
  exp: Math.exp,
  abs: Math.abs,
}

export function printExpr(e: Expr): string {
  const wrap = (x: Expr) => (x.kind === 'bin' || x.kind === 'neg' ? `(${printExpr(x)})` : printExpr(x))
  switch (e.kind) {
    case 'num':
      return String(e.value)
    case 'str':
      return JSON.stringify(e.value)
    case 'var':
      return e.name
    case 'neg':
      return `-${wrap(e.arg)}`
    case 'bin':
      return `${wrap(e.left)}${e.op}${wrap(e.right)}`
    case 'call':
      return `${e.fn}(${e.args.map(printExpr).join(', ')})`
  }
}

export function exprVars(e: Expr, out = new Set<string>()): Set<string> {
  if (e.kind === 'var') out.add(e.name)
  else if (e.kind === 'neg') exprVars(e.arg, out)
  else if (e.kind === 'bin') {
    exprVars(e.left, out)
    exprVars(e.right, out)
  } else if (e.kind === 'call') e.args.forEach((a) => exprVars(a, out))
  return out
}

export type Value = number | string | null

/** Evaluate an expression against a row. `get` resolves a column name to its value. */
export function evalExpr(e: Expr, get: (name: string) => unknown): Value {
  switch (e.kind) {
    case 'num':
      return e.value
    case 'str':
      return e.value
    case 'var': {
      const v = get(e.name)
      if (v === null || v === undefined) return null
      if (typeof v === 'number') return Number.isFinite(v) ? v : null
      if (typeof v === 'boolean') return String(v)
      return String(v)
    }
    case 'neg': {
      const v = evalExpr(e.arg, get)
      return typeof v === 'number' ? -v : null
    }
    case 'bin': {
      const a = evalExpr(e.left, get)
      const b = evalExpr(e.right, get)
      if (typeof a !== 'number' || typeof b !== 'number') return null
      const r =
        e.op === '+' ? a + b : e.op === '-' ? a - b : e.op === '*' ? a * b : e.op === '/' ? a / b : Math.pow(a, b)
      return Number.isFinite(r) ? r : null
    }
    case 'call': {
      if (e.fn === 'I') return evalExpr(e.args[0], get)
      const f = FUNCTIONS[e.fn]
      const v = evalExpr(e.args[0], get)
      if (!f || typeof v !== 'number') return null
      const r = f(v)
      return Number.isFinite(r) ? r : null
    }
  }
}

// ------------------------------------------------------------------ terms
export interface Factor {
  /** canonical text, e.g. "log1p(mileage)", "trim", "C(trim, \"Cooper\")" */
  key: string
  expr: Expr
  /** forced categorical by C() */
  categorical: boolean
  /** the single column behind a bare variable or C(x); null for transforms */
  varName: string | null
  ref: string | null
}

export interface Term {
  key: string
  factors: Factor[]
}

export interface Formula {
  text: string
  response: Expr
  responseText: string
  terms: Term[]
  intercept: boolean
}

interface TermSet {
  terms: Term[]
  intercept?: boolean
}

function makeTerm(factors: Factor[]): Term {
  const byKey = new Map(factors.map((f) => [f.key, f]))
  const sorted = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
  return { key: sorted.map((f) => f.key).join(':'), factors: sorted }
}

function union(a: Term[], b: Term[]): Term[] {
  const keys = new Set(a.map((t) => t.key))
  return [...a, ...b.filter((t) => !keys.has(t.key))]
}

function interact(a: TermSet, b: TermSet): TermSet {
  if (!a.terms.length || !b.terms.length) throw new FormulaError("':' and '*' need variables on both sides")
  const terms: Term[] = []
  for (const x of a.terms) for (const y of b.terms) terms.push(makeTerm([...x.factors, ...y.factors]))
  return { terms: union([], terms) }
}

class Parser {
  i = 0
  toks: Tok[]
  constructor(toks: Tok[]) {
    this.toks = toks
  }

  peek(value?: string): Tok | undefined {
    const t = this.toks[this.i]
    return value === undefined || t?.value === value ? t : undefined
  }
  take(value?: string): Tok {
    const t = this.toks[this.i]
    if (!t) throw new FormulaError(value ? `Expected '${value}' at end of formula` : 'Unexpected end of formula')
    if (value !== undefined && t.value !== value) throw new FormulaError(`Expected '${value}' but found '${t.value}'`, t.pos)
    this.i++
    return t
  }
  done(): boolean {
    return this.i >= this.toks.length
  }

  // arithmetic ---------------------------------------------------------
  expr(): Expr {
    let left = this.mul()
    while (this.peek('+') || this.peek('-')) {
      const op = this.take().value as '+' | '-'
      left = { kind: 'bin', op, left, right: this.mul() }
    }
    return left
  }
  mul(): Expr {
    let left = this.unary()
    while (this.peek('*') || this.peek('/')) {
      const op = this.take().value as '*' | '/'
      left = { kind: 'bin', op, left, right: this.unary() }
    }
    return left
  }
  unary(): Expr {
    if (this.peek('-')) {
      this.take()
      return { kind: 'neg', arg: this.unary() }
    }
    const base = this.primary()
    if (this.peek('^')) {
      this.take()
      return { kind: 'bin', op: '^', left: base, right: this.unary() }
    }
    return base
  }
  primary(): Expr {
    const t = this.take()
    if (t.type === 'num') return { kind: 'num', value: Number(t.value) }
    if (t.type === 'str') return { kind: 'str', value: t.value }
    if (t.type === 'ident') {
      if (this.peek('(')) return this.call(t)
      return { kind: 'var', name: t.value }
    }
    if (t.value === '(') {
      const e = this.expr()
      this.take(')')
      return e
    }
    throw new FormulaError(`Unexpected '${t.value}'`, t.pos)
  }
  call(name: Tok): Expr {
    this.take('(')
    const args: Expr[] = []
    if (!this.peek(')')) {
      args.push(this.expr())
      while (this.peek(',')) {
        this.take()
        args.push(this.expr())
      }
    }
    this.take(')')
    const fn = name.value
    if (fn === 'C') {
      if (args.length < 1 || args.length > 2 || args[0].kind !== 'var')
        throw new FormulaError('C() takes a column and an optional reference level: C(trim, "Cooper")', name.pos)
      if (args[1] && args[1].kind !== 'str') throw new FormulaError('C() reference level must be a quoted string', name.pos)
    } else if (fn === 'I' || fn in FUNCTIONS) {
      if (args.length !== 1) throw new FormulaError(`${fn}() takes one argument`, name.pos)
    } else {
      throw new FormulaError(
        `Unknown function '${fn}'. Use one of ${['I', 'C', ...Object.keys(FUNCTIONS)].join(', ')}`,
        name.pos,
      )
    }
    return { kind: 'call', fn, args }
  }

  // terms ----------------------------------------------------------------
  termSum(): TermSet {
    let acc: TermSet = { terms: [] }
    let sign: '+' | '-' = '+'
    if (this.peek('-')) {
      this.take()
      sign = '-'
    }
    for (;;) {
      const next = this.termProd()
      if (sign === '+') {
        acc = { terms: union(acc.terms, next.terms), intercept: next.intercept ?? acc.intercept }
      } else {
        const remove = new Set(next.terms.map((t) => t.key))
        let intercept = acc.intercept
        if (next.intercept === true) intercept = false
        if (next.intercept === false) intercept = true
        acc = { terms: acc.terms.filter((t) => !remove.has(t.key)), intercept }
      }
      if (this.peek('+') || this.peek('-')) sign = this.take().value as '+' | '-'
      else return acc
    }
  }
  termProd(): TermSet {
    let acc = this.termInter()
    while (this.peek('*')) {
      this.take()
      const b = this.termInter()
      const both = interact(acc, b)
      acc = { terms: union(union(acc.terms, b.terms), both.terms) }
    }
    return acc
  }
  termInter(): TermSet {
    let acc = this.termAtom()
    while (this.peek(':')) {
      this.take()
      acc = interact(acc, this.termAtom())
    }
    return acc
  }
  termAtom(): TermSet {
    const t = this.peek()
    if (!t) throw new FormulaError('Formula ends after an operator')
    if (t.value === '(') {
      this.take()
      const inner = this.termSum()
      this.take(')')
      return inner
    }
    if (t.type === 'num') {
      this.take()
      if (t.value === '0') return { terms: [], intercept: false }
      if (t.value === '1') return { terms: [], intercept: true }
      throw new FormulaError(`A number on the right-hand side must be 0 or 1 (use I() for arithmetic)`, t.pos)
    }
    if (t.type === 'ident') {
      this.take()
      const e: Expr = this.peek('(') ? this.call(t) : { kind: 'var', name: t.value }
      if (this.peek('^')) throw new FormulaError(`Use I(${printExpr(e)}^2) for powers`, this.peek()!.pos)
      return { terms: [makeTerm([factorOf(e)])] }
    }
    throw new FormulaError(`Unexpected '${t.value}'`, t.pos)
  }
}

function factorOf(e: Expr): Factor {
  if (e.kind === 'call' && e.fn === 'C') {
    const v = (e.args[0] as { name: string }).name
    const ref = e.args[1]?.kind === 'str' ? e.args[1].value : null
    return { key: printExpr(e), expr: e.args[0], categorical: true, varName: v, ref }
  }
  return { key: printExpr(e), expr: e, categorical: false, varName: e.kind === 'var' ? e.name : null, ref: null }
}

export function parseFormula(text: string): Formula {
  const toks = tokenize(text)
  const tilde = toks.findIndex((t) => t.value === '~')
  if (tilde < 0) throw new FormulaError("A formula needs '~', e.g. log(price) ~ age + mileage")
  if (toks.filter((t) => t.value === '~').length > 1) throw new FormulaError("Only one '~' allowed", toks[tilde].pos)
  if (tilde === 0) throw new FormulaError("Missing response before '~'", toks[0].pos)

  const lhs = new Parser(toks.slice(0, tilde))
  const response = lhs.expr()
  if (!lhs.done()) throw new FormulaError(`Unexpected '${lhs.peek()!.value}' in the response`, lhs.peek()!.pos)

  const rhs = new Parser(toks.slice(tilde + 1))
  if (rhs.done()) throw new FormulaError("Missing terms after '~' (use 1 for intercept only)")
  const set = rhs.termSum()
  if (!rhs.done()) throw new FormulaError(`Unexpected '${rhs.peek()!.value}'`, rhs.peek()!.pos)
  return { text, response, responseText: printExpr(response), terms: set.terms, intercept: set.intercept ?? true }
}

/** Every column name a formula refers to. */
export function formulaVars(f: Formula): Set<string> {
  const out = exprVars(f.response)
  for (const t of f.terms) for (const fa of t.factors) exprVars(fa.expr, out)
  return out
}

// ------------------------------------------------------------------ response transforms
export type ResponseKind = 'identity' | 'log' | 'log1p' | 'sqrt' | 'other'

export function responseKind(f: Formula): { kind: ResponseKind; variable: string | null } {
  const r = f.response
  if (r.kind === 'var') return { kind: 'identity', variable: r.name }
  if (r.kind === 'call' && r.args[0]?.kind === 'var' && (r.fn === 'log' || r.fn === 'log1p' || r.fn === 'sqrt'))
    return { kind: r.fn, variable: r.args[0].name }
  return { kind: 'other', variable: null }
}

export function inverseResponse(kind: ResponseKind): ((y: number) => number) | null {
  switch (kind) {
    case 'identity':
      return (y) => y
    case 'log':
      return Math.exp
    case 'log1p':
      return Math.expm1
    case 'sqrt':
      return (y) => y * y
    case 'other':
      return null
  }
}

// ------------------------------------------------------------------ design matrix
export interface ColumnPart {
  factor: string
  varName: string | null
  level: string | null
}

export interface DesignColumn {
  name: string
  parts: ColumnPart[]
}

interface Encoding {
  factor: Factor
  kind: 'numeric' | 'categorical'
  levels: string[] // categorical: non-reference levels, in column order
  ref: string | null
  allLevels: string[]
  /** numeric columns used as factors keep a fixed number of decimals: 1.5 / 2.0, not 1.5 / 2 */
  decimals: number
}

export interface Design {
  formula: Formula
  columns: DesignColumn[]
  X: number[][]
  y: number[]
  /** index into the input rows for each design row */
  rows: number[]
  intercept: boolean
  dropped: number
  warnings: string[]
  encodings: Map<string, Encoding>
  /** encode another row with the same coding; null if a value is missing or a level unseen */
  encode(row: Record<string, unknown>): number[] | null
}

export interface DesignOptions {
  /** column name aliases, e.g. { price: 'price_gbp' } */
  aliases?: Record<string, string>
  /** reference levels by column, e.g. { seller_type: 'PRIVATE' } */
  refs?: Record<string, string>
}

function isCategoricalColumn(rows: Record<string, unknown>[], col: string): boolean {
  for (const r of rows) {
    const v = r[col]
    if (v === null || v === undefined) continue
    return typeof v === 'string' || typeof v === 'boolean'
  }
  return false
}

export function buildDesign(f: Formula, data: Record<string, unknown>[], opts: DesignOptions = {}): Design {
  const aliases = opts.aliases ?? {}
  const resolve = (name: string) => aliases[name] ?? name
  const known = new Set<string>()
  for (const r of data.slice(0, 50)) for (const k of Object.keys(r)) known.add(k)
  for (const v of formulaVars(f)) {
    if (data.length && !known.has(resolve(v)))
      throw new FormulaError(`Unknown column '${v}'. Available: ${[...known, ...Object.keys(aliases)].sort().join(', ')}`)
  }
  const getter = (row: Record<string, unknown>) => (name: string) => row[resolve(name)]

  const factors = new Map<string, Factor>()
  for (const t of f.terms) for (const fa of t.factors) factors.set(fa.key, fa)
  const kinds = new Map<string, 'numeric' | 'categorical'>()
  for (const fa of factors.values()) {
    const cat = fa.categorical || (fa.varName !== null && isCategoricalColumn(data, resolve(fa.varName)))
    kinds.set(fa.key, cat ? 'categorical' : 'numeric')
  }

  // Numbers used as categories get a consistent label precision ("1.5", "2.0").
  const decimals = new Map<string, number>()
  for (const fa of factors.values()) {
    if (kinds.get(fa.key) !== 'categorical') continue
    let d = 0
    for (const row of data) {
      const v = evalExpr(fa.expr, getter(row))
      if (typeof v === 'number') d = Math.max(d, (String(v).split('.')[1] ?? '').length)
    }
    decimals.set(fa.key, Math.min(d, 6))
  }
  const levelOf = (key: string, v: number | string) => (typeof v === 'number' ? v.toFixed(decimals.get(key) ?? 0) : v)

  // Complete cases
  const values: { y: number; f: Map<string, number | string> }[] = []
  const rowIdx: number[] = []
  data.forEach((row, i) => {
    const get = getter(row)
    const y = evalExpr(f.response, get)
    if (typeof y !== 'number') return
    const fv = new Map<string, number | string>()
    for (const fa of factors.values()) {
      const v = evalExpr(fa.expr, get)
      if (v === null) return
      if (kinds.get(fa.key) === 'numeric') {
        if (typeof v !== 'number') return
        fv.set(fa.key, v)
      } else fv.set(fa.key, levelOf(fa.key, v))
    }
    values.push({ y, f: fv })
    rowIdx.push(i)
  })

  const warnings: string[] = []
  const encodings = new Map<string, Encoding>()
  const constant = new Set<string>()
  for (const fa of factors.values()) {
    if (kinds.get(fa.key) === 'categorical') {
      const counts = new Map<string, number>()
      for (const v of values) {
        const l = v.f.get(fa.key) as string
        counts.set(l, (counts.get(l) ?? 0) + 1)
      }
      const all = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k)
      let ref = fa.ref ?? (fa.varName ? opts.refs?.[fa.varName] : undefined) ?? all[0] ?? null
      if (ref !== null && !counts.has(ref)) {
        warnings.push(`Reference level '${ref}' of ${fa.key} isn't in the data; using '${all[0]}'`)
        ref = all[0] ?? null
      }
      if (all.length < 2) constant.add(fa.key)
      encodings.set(fa.key, { factor: fa, kind: 'categorical', levels: all.filter((l) => l !== ref), ref, allLevels: all, decimals: decimals.get(fa.key) ?? 0 })
    } else {
      const first = values[0]?.f.get(fa.key)
      if (values.every((v) => v.f.get(fa.key) === first)) constant.add(fa.key)
      encodings.set(fa.key, { factor: fa, kind: 'numeric', levels: [], ref: null, allLevels: [], decimals: 0 })
    }
  }

  const terms = f.terms.filter((t) => {
    const bad = t.factors.find((fa) => constant.has(fa.key))
    if (bad) warnings.push(`Dropped ${t.key}: ${bad.key} doesn't vary in the filtered data`)
    return !bad
  })

  // Columns: the cartesian product of each term's factor encodings.
  const columns: DesignColumn[] = f.intercept ? [{ name: '(Intercept)', parts: [] }] : []
  for (const t of terms) {
    let combos: ColumnPart[][] = [[]]
    for (const fa of t.factors) {
      const enc = encodings.get(fa.key)!
      const parts: ColumnPart[] =
        enc.kind === 'numeric'
          ? [{ factor: fa.key, varName: fa.varName, level: null }]
          : enc.levels.map((l) => ({ factor: fa.key, varName: fa.varName, level: l }))
      combos = combos.flatMap((c) => parts.map((p) => [...c, p]))
    }
    for (const parts of combos)
      columns.push({ name: parts.map((p) => (p.level === null ? p.factor : `${p.factor}[${p.level}]`)).join(':'), parts })
  }

  const rowVector = (fv: Map<string, number | string>): number[] =>
    columns.map((c) =>
      c.parts.reduce((acc, p) => {
        const v = fv.get(p.factor)
        return acc * (p.level === null ? (v as number) : v === p.level ? 1 : 0)
      }, 1),
    )

  const encode = (row: Record<string, unknown>): number[] | null => {
    const get = getter(row)
    const fv = new Map<string, number | string>()
    for (const enc of encodings.values()) {
      const v = evalExpr(enc.factor.expr, get)
      if (v === null) return null
      if (enc.kind === 'numeric') {
        if (typeof v !== 'number') return null
        fv.set(enc.factor.key, v)
      } else {
        const l = levelOf(enc.factor.key, v)
        if (!enc.allLevels.includes(l)) return null
        fv.set(enc.factor.key, l)
      }
    }
    return rowVector(fv)
  }

  return {
    formula: f,
    columns,
    X: values.map((v) => rowVector(v.f)),
    y: values.map((v) => v.y),
    rows: rowIdx,
    intercept: f.intercept,
    dropped: data.length - values.length,
    warnings,
    encodings,
    encode,
  }
}
