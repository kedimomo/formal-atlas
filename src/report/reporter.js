/**
 * Human-facing reporting for verify/query results.
 */

const SEVERITY = {
  'crypto-in-loop': 'ERROR',
  'hardcoded-sensitive': 'ERROR',
  'intent-effect-mismatch': 'WARN',
  'await-in-loop': 'WARN',
  'external-call': 'INFO',
  'dead-code': 'INFO',
}

export function reportViolations(rows) {
  if (rows.length === 0) return '✅  No violations derived.'
  const byRule = new Map()
  for (const r of rows) {
    const rule = r.Rule || r.rule || '?'
    const subj = r.Scope || r.Subject || r.File || r.Name || '?'
    if (!byRule.has(rule)) byRule.set(rule, new Set())
    byRule.get(rule).add(subj)
  }
  const lines = []
  let errors = 0
  let warnings = 0
  const order = [...byRule.keys()].sort((a, b) => rank(a) - rank(b))
  for (const rule of order) {
    const sev = SEVERITY[rule] || 'WARN'
    if (sev === 'ERROR') errors += byRule.get(rule).size
    else if (sev === 'WARN') warnings += byRule.get(rule).size
    lines.push(`\n[${sev}] ${rule}  (${byRule.get(rule).size})`)
    for (const subj of [...byRule.get(rule)].sort()) lines.push(`    • ${subj}`)
  }
  lines.push(`\n— ${rows.length} solution(s): ${errors} error(s), ${warnings} warning(s)`)
  return lines.join('\n')
}

function rank(rule) {
  const sev = SEVERITY[rule] || 'WARN'
  return sev === 'ERROR' ? 0 : sev === 'WARN' ? 1 : 2
}

export function reportQuery(rows, query) {
  if (rows.length === 0) return `(no solutions for: ${query})`
  if (rows.length === 1 && Object.keys(rows[0]).length === 0) return `true.  (${query})`
  const vars = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const widths = vars.map((v) => Math.max(v.length, ...rows.map((r) => String(r[v] ?? '').length)))
  const head = vars.map((v, i) => v.padEnd(widths[i])).join('  │  ')
  const sep = widths.map((w) => '─'.repeat(w)).join('──┼──')
  const body = rows.slice(0, 200).map((r) => vars.map((v, i) => String(r[v] ?? '').padEnd(widths[i])).join('  │  '))
  const more = rows.length > 200 ? `\n… ${rows.length - 200} more` : ''
  return `${head}\n${sep}\n${body.join('\n')}\n(${rows.length} solution(s))${more}`
}
