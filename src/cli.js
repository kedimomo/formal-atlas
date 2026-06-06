#!/usr/bin/env node
/**
 * formal-atlas CLI — lift code into logic, verify with Prolog.
 *
 *   extract <path>        emit the Prolog fact base for a project
 *   verify  <path>        derive violation(Subject, Rule) and report
 *   query   <path> "G."   run an arbitrary Prolog goal over the fact base
 *   lift    <path>        extract + online AI semantic lift
 */
import fs from 'node:fs'
import { extractProject, buildProgram } from './pipeline.js'
import { factsToProlog, shape } from './lift/fact-model.js'
import { runQuery, hasProlog } from './verify/prolog-engine.js'
import { reportViolations, reportQuery } from './report/reporter.js'

const HELP = `formal-atlas — lift code into logic, verify with Prolog/Datalog.

Usage:
  formal-atlas extract <path> [--out=facts.pl] [--lift=offline|online|none]
  formal-atlas verify  <path> [--lift=offline|online|none]
  formal-atlas query   <path> "<goal>." [--lift=...]
  formal-atlas lift    <path>            (extract + online AI lift)

Examples:
  formal-atlas verify examples/sample-project
  formal-atlas query  examples/sample-project "reaches(handleRequest, dbQuery)."
  formal-atlas query  examples/sample-project "dead_code(File, Name)."
  formal-atlas query  examples/sample-project "impact(validateUser, Caller)."
`

function parseFlags(args) {
  const flags = {}
  const positional = []
  for (const a of args) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      flags[k] = v === undefined ? true : v
    } else positional.push(a)
  }
  return { flags, positional }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { flags, positional } = parseFlags(rest)
  const target = positional[0]
  const lift = flags.lift || 'offline'

  if (!cmd || cmd === 'help' || flags.help) { console.log(HELP); return }
  if (!target) { console.error('error: missing <path>\n'); console.log(HELP); process.exit(2) }

  if (cmd === 'smt') {
    const sub = positional[0]
    const file = positional[1]
    if (!sub || !file) { console.error('usage: formal-atlas smt policy|contract|dafny <spec.json>'); process.exit(2) }
    const spec = JSON.parse(fs.readFileSync(file, 'utf8'))
    const { checkContract, checkPolicy, toDafny } = await import('./verify/smt-bridge.js')
    if (sub === 'dafny') { console.log(toDafny(spec)); process.exit(0) }
    if (sub === 'contract') {
      const r = await checkContract(spec)
      console.log(`contract "${r.name}": preconditions ${r.preSat === 'sat' ? 'satisfiable' : 'UNSAT (vacuous!)'}`)
      console.log(r.entailed
        ? '  ✅ postcondition is GUARANTEED by preconditions (machine-checked by Z3)'
        : `  ❌ postcondition NOT guaranteed — counterexample: ${r.counterexample}`)
      process.exit(0)
    }
    if (sub === 'policy') {
      const r = await checkPolicy(spec)
      console.log(`safe assignment (meets requirements + respects SoD): ${r.safe}` + (r.safeModel ? `\n  model: ${r.safeModel}` : '  → requirements FORCE a separation-of-duty breach'))
      console.log(`SoD violation reachable under these grants: ${r.violationReachable}` + (r.violModel ? `\n  witness: ${r.violModel}` : ''))
      process.exit(0)
    }
    console.error(`unknown smt sub: ${sub}`); process.exit(2)
  }

  if (cmd === 'extract' || cmd === 'lift') {
    const useLift = cmd === 'lift' ? 'online' : lift
    const proj = await extractProject(target, { lift: useLift })
    const header = [`formal-atlas ${cmd}: ${proj.fileCount} files`, `methods: ${JSON.stringify(proj.methods)}`]
    const text = factsToProlog(proj.facts, header) + (proj.rawLines.length ? proj.rawLines.join('\n') + '\n' : '')
    if (flags.out) { fs.writeFileSync(flags.out, text); console.error(`wrote ${proj.facts.length} facts -> ${flags.out}`) }
    else process.stdout.write(text)
    console.error(`\nshape: ${JSON.stringify(shape(proj.facts), null, 0)}`)
    return
  }

  if (!(await hasProlog())) { console.error('tau-prolog unavailable — run `npm install` inside formal-atlas/'); process.exit(1) }

  if (cmd === 'verify') {
    const proj = await extractProject(target, { lift })
    const rows = await runQuery(buildProgram(proj), 'violation(Subject, Rule).')
    console.error(`# verify ${target} — ${proj.fileCount} files, ${proj.facts.length} facts ${JSON.stringify(proj.methods)}`)
    console.log(reportViolations(rows))
    return
  }

  if (cmd === 'query') {
    const goal = positional[1]
    if (!goal) { console.error('error: missing "<goal>."'); process.exit(2) }
    const proj = await extractProject(target, { lift })
    const g = goal.trim().endsWith('.') ? goal.trim() : goal.trim() + '.'
    const rows = await runQuery(buildProgram(proj), g)
    console.error(`# query over ${proj.facts.length} facts: ${g}`)
    console.log(reportQuery(rows, g))
    return
  }

  if (cmd === 'fdrs') {
    const { runFdrsBridge } = await import('./integrations/fdrs-bridge.js')
    const res = await runFdrsBridge(target, { run: !flags['no-run'], out: flags.out })
    console.error(`# FDRS bridge: ${target} → ${res.factCount} concept facts (${res.fileCount} files) → ${res.outFile}`)
    if (res.checkOutput != null) {
      console.log('=== existing tools/lint/prolog-check.js, fed formal-atlas-derived facts ===')
      console.log(res.checkOutput.trim())
    } else {
      console.log(res.text)
    }
    return
  }

  console.error(`unknown command: ${cmd}\n`)
  console.log(HELP)
  process.exit(2)
}

main().catch((e) => { console.error('fatal:', e.message); process.exit(1) })
