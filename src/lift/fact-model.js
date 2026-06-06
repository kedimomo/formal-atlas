/**
 * Canonical fact model.
 *
 * A Fact is { pred: string, args: Array<string|number|boolean> }.
 * Serialization decides Prolog term shape: numbers stay bare, identifiers that
 * are safe lowercase atoms stay bare, everything else is single-quoted (escaped).
 * Consistency is what matters for unification — the SAME JS value always
 * serializes to the SAME Prolog term, so cross-fact joins work.
 */

const SAFE_ATOM = /^[a-z][a-zA-Z0-9_]*$/

export function termOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  const s = String(v)
  if (SAFE_ATOM.test(s)) return s
  const esc = s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/[\r\n]+/g, ' ')
    .trim()
  return `'${esc}'`
}

export function fact(pred, ...args) {
  return { pred, args }
}

export function factToProlog(f) {
  if (!f.args || f.args.length === 0) return `${f.pred}.`
  return `${f.pred}(${f.args.map(termOf).join(', ')}).`
}

export function factsToProlog(facts, header = []) {
  const lines = header.map((h) => `% ${h}`)
  if (header.length) lines.push('')
  for (const f of facts) lines.push(factToProlog(f))
  return lines.join('\n') + '\n'
}

/** Remove duplicate facts (by serialized form). */
export function dedupe(facts) {
  const seen = new Set()
  const out = []
  for (const f of facts) {
    const k = factToProlog(f)
    if (!seen.has(k)) {
      seen.add(k)
      out.push(f)
    }
  }
  return out
}

/** Count facts grouped by predicate/arity — useful for a quick "shape" summary. */
export function shape(facts) {
  const counts = {}
  for (const f of facts) {
    const key = `${f.pred}/${f.args.length}`
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}
