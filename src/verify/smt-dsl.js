/**
 * Tiny expression DSL → z3 terms. The bridge between human-writable contracts
 * (`x > 0 && y >= x`) and the SMT solver. Supports int & bool variables.
 *
 * Grammar (precedence low→high):  ->  ||  &&  == != < <= > >=  + -  * / %  unary(! -)
 */

const PREC = { '->': 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 }

function tokenize(src) {
  const re = /\s*([0-9]+|[A-Za-z_]\w*|->|<=|>=|==|!=|&&|\|\||[()+\-*/%<>!])/g
  const toks = []
  let m
  while ((m = re.exec(src)) !== null) toks.push(m[1])
  return toks
}

export function parseExpr(src) {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const next = () => toks[p++]

  function prefix() {
    const x = next()
    if (x === '(') { const e = expr(0); next() /* ) */; return e }
    if (x === '!' || x === '-') return { t: 'un', op: x, e: prefix() }
    if (x === 'true' || x === 'false') return { t: 'bool', v: x === 'true' }
    if (/^[0-9]+$/.test(x)) return { t: 'num', v: Number(x) }
    // Function call: f(args...) where the identifier is followed by '('
    if (/^[A-Za-z_]\w*$/.test(x) && peek() === '(') {
      const args = []
      next() // skip '('
      while (peek() !== ')') {
        args.push(expr(0))
        if (peek() === ',') next()
      }
      next() // skip ')'
      return { t: 'call', fn: x, args }
    }
    return { t: 'var', v: x }
  }

  function expr(min) {
    let left = prefix()
    while (peek() !== undefined && PREC[peek()] !== undefined && PREC[peek()] >= min) {
      const op = next()
      const right = expr(PREC[op] + 1)
      left = { t: 'bin', op, l: left, r: right }
    }
    return left
  }

  return expr(0)
}

function bin(op, l, r, Z3) {
  switch (op) {
    case '+': return l.add(r)
    case '-': return l.sub(r)
    case '*': return l.mul(r)
    case '%': return l.mod(r)
    case '/': return l.div(r)
    case '>': return l.gt(r)
    case '>=': return l.ge(r)
    case '<': return l.lt(r)
    case '<=': return l.le(r)
    case '==': return l.eq(r)
    case '!=': return Z3.Not(l.eq(r))
    case '&&': return Z3.And(l, r)
    case '||': return Z3.Or(l, r)
    case '->': return Z3.Implies(l, r)
    default: throw new Error(`unsupported op ${op}`)
  }
}

/** Free variables of an expression (identifiers minus the bool literals). */
export function varsOf(src) {
  const set = new Set()
  for (const t of tokenize(src)) {
    if (/^[A-Za-z_]\w*$/.test(t) && t !== 'true' && t !== 'false') set.add(t)
  }
  return [...set]
}

export function compile(ast, Z3, vars, ufs = {}) {
  switch (ast.t) {
    case 'num': return Z3.Int.val(ast.v)
    case 'bool': return Z3.Bool.val(ast.v)
    case 'var': {
      const z = vars[ast.v]
      if (!z) throw new Error(`unknown variable: ${ast.v}`)
      return z
    }
    case 'call': {
      const fd = ufs[ast.fn]
      if (!fd) throw new Error(`unknown UF: ${ast.fn}`)
      return fd(...ast.args.map((a) => compile(a, Z3, vars, ufs)))
    }
    case 'un': {
      const e = compile(ast.e, Z3, vars, ufs)
      return ast.op === '!' ? Z3.Not(e) : e.neg()
    }
    case 'bin': return bin(ast.op, compile(ast.l, Z3, vars, ufs), compile(ast.r, Z3, vars, ufs), Z3)
    default: throw new Error('bad ast')
  }
}

/**
 * Evaluate a parsed expression at a CONCRETE environment (var → int|bool).
 * Pure, decidable, solver-free — the engine for ★4 faithfulness scoring, which
 * runs a generated predicate over labeled sample points. Integer `/` truncates
 * toward zero to mirror evaluation on machine integers.
 */
export function evalExpr(ast, env) {
  switch (ast.t) {
    case 'num': return ast.v
    case 'bool': return ast.v
    case 'var':
      if (!(ast.v in env)) throw new Error(`unbound variable: ${ast.v}`)
      return env[ast.v]
    case 'un': {
      const e = evalExpr(ast.e, env)
      return ast.op === '!' ? !e : -e
    }
    case 'bin': {
      const l = evalExpr(ast.l, env)
      const r = evalExpr(ast.r, env)
      switch (ast.op) {
        case '+': return l + r
        case '-': return l - r
        case '*': return l * r
        case '/': return Math.trunc(l / r)
        case '%': return l % r
        case '>': return l > r
        case '>=': return l >= r
        case '<': return l < r
        case '<=': return l <= r
        case '==': return l === r
        case '!=': return l !== r
        case '&&': return Boolean(l) && Boolean(r)
        case '||': return Boolean(l) || Boolean(r)
        case '->': return !l || Boolean(r)
        default: throw new Error(`unsupported op ${ast.op}`)
      }
    }
    default: throw new Error('bad ast')
  }
}
