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
  formal-atlas verify  <path> [--lift=offline|online|none] [--engine=prolog|datalog]
  formal-atlas query   <path> "<goal>." [--lift=...]
  formal-atlas lift    <path>            (extract + online AI lift)
  formal-atlas refine  <path> [--online] (lift decidable refinements, Z3-check φ_pre ⇒ φ_post)
  formal-atlas explain <path> [--rule=R] [--subject=S]   (derivation/proof tree per violation)
  formal-atlas repair  <path> [--online] [--apply]       (★3 closed loop: LLM patch → re-verify)
  formal-atlas smt     refinement|contract|policy|dafny|faithfulness <spec.json>
  formal-atlas watch   <path>            (monitor changes, auto-verify)

Examples:
  formal-atlas verify examples/sample-project
  formal-atlas query  examples/sample-project "reaches(handleRequest, dbQuery)."
  formal-atlas query  examples/sample-project "dead_code(File, Name)."
  formal-atlas query  examples/sample-project "impact(validateUser, Caller)."
  formal-atlas refine examples/sample-project
  formal-atlas smt    refinement examples/refinement/bank.refine.json
  formal-atlas explain examples/repair
  formal-atlas repair  examples/repair
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
  const engine = flags.engine || 'prolog' // ★5: --engine=datalog materializes closures via the semi-naive engine

  if (!cmd || cmd === 'help' || flags.help) { console.log(HELP); return }
  if (!target) { console.error('error: missing <path>\n'); console.log(HELP); process.exit(2) }

  if (cmd === 'smt') {
    const sub = positional[0]
    const file = positional[1]
    if (!sub || !file) { console.error('usage: formal-atlas smt policy|contract|dafny|refinement|faithfulness <spec.json>'); process.exit(2) }
    const spec = JSON.parse(fs.readFileSync(file, 'utf8'))
    const { checkContract, checkPolicy, toDafny } = await import('./verify/smt-bridge.js')
    if (sub === 'dafny') { console.log(toDafny(spec)); process.exit(0) }
    if (sub === 'refinement') {
      const { checkRefinementsVerbose } = await import('./verify/refinement-check.js')
      const facts = (spec.refinements || []).map((r) => ({ pred: 'refinement', args: [r.routine, r.var, r.phi, r.kind] }))
      const results = await checkRefinementsVerbose(facts)
      const mark = { entailed: '✅', ok: '✅', unchecked: '○', broken: '❌', vacuous: '❌' }
      for (const r of results) {
        console.log(`${mark[r.status] || '?'} ${r.routine}: ${r.status}`)
        if (r.pre.length) console.log(`     pre : ${r.pre.join(' ∧ ')}`)
        if (r.post.length) console.log(`     post: ${r.post.join(' ∧ ')}`)
        if (r.counterexample) console.log(`     counterexample: ${r.counterexample}`)
      }
      const bad = results.filter((r) => r.status === 'broken' || r.status === 'vacuous').length
      console.log(`\n${results.length} refinement specs — ${bad} unsound (broken/vacuous), machine-checked by Z3.`)
      process.exit(0)
    }
    if (sub === 'faithfulness') {
      const { scoreFaithfulness, equiv, conjoin } = await import('./verify/faithfulness.js')
      const r = scoreFaithfulness(spec, spec.samples || [])
      const pct = (x) => `${Math.round(x * 100)}%`
      console.log(`${r.faithful ? '✅' : '❌'} ${r.name}: ${r.mode}  (score ${pct(r.score)}, recall ${pct(r.recall)}, specificity ${pct(r.specificity)}, ${r.total} samples)`)
      if (r.overAccepted.length) console.log(`   ✗ accepts ${r.overAccepted.length} ILLEGAL sample(s) — spec too weak, e.g. ${JSON.stringify(r.overAccepted[0])}`)
      if (r.overRejected.length) console.log(`   ✗ rejects ${r.overRejected.length} LEGAL sample(s) — spec too strong, e.g. ${JSON.stringify(r.overRejected[0])}`)
      if (spec.equivalent) {
        const e = await equiv(spec.vars || {}, conjoin(spec), spec.equivalent)
        console.log(`   round-trip vs "${spec.equivalent}": ${e.equivalent ? '✅ equivalent' : `❌ drifted${e.counterexample ? ' — ' + e.counterexample : ''}`}`)
      }
      process.exit(0)
    }
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

  if (cmd === 'refine') {
    const { checkRefinementsVerbose } = await import('./verify/refinement-check.js')
    const proj = await extractProject(target, { lift, formalize: flags.online ? 'online' : 'offline' })
    const results = await checkRefinementsVerbose(proj.facts)
    console.error(`# refine ${target} — ${proj.fileCount} files, ${results.length} routines carry refinements`)
    const mark = { entailed: '✅', ok: '✅', unchecked: '○', broken: '❌', vacuous: '❌' }
    for (const r of results) {
      console.log(`${mark[r.status] || '?'} ${r.routine}: ${r.status}${r.counterexample ? ` — counterexample: ${r.counterexample}` : ''}`)
    }
    const bad = results.filter((r) => r.status === 'broken' || r.status === 'vacuous').length
    const unchecked = results.filter((r) => r.status === 'unchecked').length
    console.log(`\n${results.length} refinements: ${results.length - bad - unchecked} discharged ✅, ${bad} unsound ❌, ${unchecked} assumptions ○ (need body-level VC, ★8).`)
    return
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
    const proj = await extractProject(target, { lift, engine })
    const program = buildProgram(proj)
    const rows = await runQuery(program, 'violation(Subject, Rule).')
    console.error(`# verify ${target} — ${proj.fileCount} files, ${proj.facts.length} facts ${JSON.stringify(proj.methods)}`)
    console.log(reportViolations(rows))
    const suppressed = await runQuery(program, 'suppressed_xss(N).')
    if (suppressed.length) console.log(`\nℹ  ${suppressed.length} xss false-positive(s) auto-suppressed as JSON responses (★3 content-type refinement).`)
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

  if (cmd === 'explain') {
    const { explainAll, formatExplanation } = await import('./verify/explain.js')
    const proj = await extractProject(target, { lift })
    const expls = await explainAll(buildProgram(proj), { rule: flags.rule, subject: flags.subject })
    console.error(`# explain ${target} — ${proj.fileCount} files, ${expls.length} violation(s)`)
    if (!expls.length) { console.log('✅  No violations to explain.'); return }
    for (const e of expls) console.log('\n' + formatExplanation(e))
    return
  }

  if (cmd === 'repair') {
    const { repairViolations, formatRepair } = await import('./repair/loop.js')
    console.log(formatRepair(await repairViolations(target, { online: !!flags.online, apply: !!flags.apply })))
    return
  }

  if (cmd === 'watch') {
    const { watch: startWatch } = await import('./watch.js')
    await startWatch(target)
    return
  }

  if (cmd === 'formalize') {
    const { extractProject, buildProgram } = await import('./pipeline.js')
    const { runQuery } = await import('./verify/prolog-engine.js')
    const online = argv._[1] === 'online' || process.env.FORMAL_ATLAS_ONLINE === '1'
    const proj = await extractProject(target, { lift: online ? 'online' : 'offline', formalize: online ? 'online' : 'offline' })
    const program = buildProgram(proj)
    console.log(`\n=== Formalization Results (${proj.fileCount} files) ===\n`)
    const pres = await runQuery(program, "precondition(R, C).")
    const posts = await runQuery(program, "postcondition(R, C).")
    const invs = await runQuery(program, "invariant(S, I).")
    const violations = await runQuery(program, "violation(S, R).")
    const contractV = violations.filter(v => ['postcondition-contradiction', 'precondition-not-checked', 'invariant-crypto-contradiction', 'invariant-await-contradiction'].includes(v.R))
    if (pres.length) { console.log('Preconditions:'); pres.forEach(r => console.log(`  ${r.R}: ${r.C}`)) }
    if (posts.length) { console.log('Postconditions:'); posts.forEach(r => console.log(`  ${r.R}: ${r.C}`)) }
    if (invs.length) { console.log('Invariants:'); invs.forEach(r => console.log(`  ${r.S}: ${r.I}`)) }
    if (contractV.length) { console.log('\nContract Violations:'); contractV.forEach(v => console.log(`  ${v.S}: ${v.R}`)) }
    console.log(`\nTotal: ${pres.length} preconditions, ${posts.length} postconditions, ${invs.length} invariants, ${contractV.length} contract violations`)
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
