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

export function compile(ast, Z3, vars) {
  switch (ast.t) {
    case 'num': return Z3.Int.val(ast.v)
    case 'bool': return Z3.Bool.val(ast.v)
    case 'var': {
      const z = vars[ast.v]
      if (!z) throw new Error(`unknown variable: ${ast.v}`)
      return z
    }
    case 'un': {
      const e = compile(ast.e, Z3, vars)
      return ast.op === '!' ? Z3.Not(e) : e.neg()
    }
    case 'bin': return bin(ast.op, compile(ast.l, Z3, vars), compile(ast.r, Z3, vars), Z3)
    default: throw new Error('bad ast')
  }
}
