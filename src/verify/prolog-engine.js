/**
 * tau-prolog engine wrapper.
 *
 * Consults a combined program (rules + facts) and runs a query, returning an
 * array of variable-binding objects. This is the "symbolic" half of the
 * neurosymbolic loop: deterministic, explainable, runs locally with no tokens.
 */

async function loadProlog() {
  try {
    const m = await import('tau-prolog')
    return m.default || m
  } catch {
    return null
  }
}

function termToString(t) {
  if (t == null) return ''
  // tau-prolog Num has .value and no .args; atoms/compounds have toString.
  if (typeof t === 'object') {
    if (t.value !== undefined && t.args === undefined) return String(t.value)
    if (typeof t.toString === 'function') {
      try { return t.toString({ quoted: false, ignore_ops: false }) } catch { return t.toString() }
    }
  }
  return String(t)
}

function bindingsOf(answer) {
  const out = {}
  if (!answer || !answer.links) return out
  for (const k of Object.keys(answer.links)) {
    const t = answer.links[k]
    if (t == null) continue
    out[k] = termToString(t)
  }
  return out
}

/**
 * @param {string} programText  rules + facts, one Prolog program
 * @param {string} query        e.g. "violation(Scope, Rule)."
 * @returns {Promise<Array<Object>>} variable bindings per solution
 */
export async function runQuery(programText, query, { limit = 5000, steps = 5_000_000 } = {}) {
  const pl = await loadProlog()
  if (!pl) throw new Error('tau-prolog not installed — run `npm install` inside formal-atlas/')

  return new Promise((resolve, reject) => {
    const session = pl.create(steps)
    session.consult(programText, {
      success() {
        session.query(query, {
          success() {
            const results = []
            session.answers((answer) => {
              if (answer === false || answer == null) { resolve(results); return }
              if (answer.id === 'throw') { reject(new Error('prolog runtime: ' + termToString(answer))); return }
              results.push(bindingsOf(answer))
              if (results.length >= limit) { resolve(results); return }
            })
          },
          error(err) { reject(new Error('query error: ' + termToString(err))) },
        })
      },
      error(err) { reject(new Error('consult error: ' + termToString(err))) },
    })
  })
}

export async function hasProlog() {
  return (await loadProlog()) != null
}
