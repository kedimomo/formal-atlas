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
 * Run a single goal on an already-consulted session.
 * Returns a Promise that resolves with an array of variable-binding objects.
 */
function querySession(session, goal, limit) {
  return new Promise((resolve, reject) => {
    session.query(goal, {
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
  })
}

/**
 * @param {string} programText  rules + facts, one Prolog program
 * @param {string} query        e.g. "violation(Scope, Rule)."
 * @returns {Promise<Array<Object>>} variable bindings per solution
 */
export async function runQuery(programText, query, { limit = 5000, steps = 5_000_000 } = {}) {
  const pl = await loadProlog()
  if (!pl) throw new Error('tau-prolog not installed — run `npm install` inside formal-atlas/')

  const session = pl.create(steps)

  await new Promise((resolve, reject) => {
    session.consult(programText, {
      success() { resolve() },
      error(err) { reject(new Error('consult error: ' + termToString(err))) },
    })
  })

  const results = await querySession(session, query, limit)

  // Enrich violation results with fix suggestions from suggestion/2
  const ruleIds = new Set()
  for (const r of results) {
    if (r.Rule) ruleIds.add(r.Rule)
    if (r.R) ruleIds.add(r.R)
  }
  if (ruleIds.size > 0) {
    const suggestionMap = {}
    for (const ruleId of ruleIds) {
      try {
        const suggs = await querySession(session, `suggestion('${ruleId}', Text).`, limit)
        if (suggs.length > 0 && suggs[0].Text) {
          suggestionMap[ruleId] = suggs[0].Text
        }
      } catch { /* ignore suggestion query errors */ }
    }
    for (const r of results) {
      const rid = r.Rule || r.R
      if (rid && suggestionMap[rid]) {
        r.suggestion = suggestionMap[rid]
      }
    }
  }

  return results
}

export async function hasProlog() {
  return (await loadProlog()) != null
}
