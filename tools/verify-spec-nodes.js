#!/usr/bin/env node
/**
 * SPEC node-type self-verifier — feeds minimal sample code through each language's
 * tree-sitter WASM grammar, walks the AST, and reports every observed node type.
 * Compares against the SPEC blocks in src/extract/treesitter.js and flags mismatches.
 *
 * Run:  node tools/verify-spec-nodes.js [lang]   (omit for all)
 * Zero new installs needed — all grammars are already in node_modules.
 */
import { createRequire } from 'module'
import path from 'path'
import fs from 'fs'

const require = createRequire(import.meta.url)
const GRAMMAR_DIR = (() => {
  try { return path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out') } catch { return null }
})()

const SPEC = {
  c:          { fn: ['function_definition'], lam: [], cls: [], call: ['call_expression'], callField: 'function', imp: ['preproc_include'], loop: ['for_statement','while_statement','do_statement'] },
  cpp:        { fn: ['function_definition','template_declaration'], lam: ['lambda_expression'], cls: ['class_specifier','struct_specifier'], call: ['call_expression','template_function'], callField: 'function', imp: ['preproc_include','using_declaration'], loop: ['for_statement','while_statement','do_statement'] },
  c_sharp:    { fn: ['method_declaration','local_function_statement'], lam: ['lambda_expression','anonymous_method_expression'], cls: ['class_declaration','interface_declaration','struct_declaration'], call: ['invocation_expression'], callField: 'function', imp: ['using_directive'], loop: ['for_statement','for_each_statement','while_statement','do_statement'] },
  ruby:       { fn: ['method'], lam: [], cls: ['class','module'], call: ['call'], callField: 'method', imp: [], loop: ['for','while','until'] },
  php:        { fn: ['function_definition','method_declaration'], lam: ['arrow_function'], cls: ['class_declaration','interface_declaration','trait_declaration'], call: ['function_call_expression','member_call_expression'], callField: 'function', imp: ['use_declaration','namespace_use_clause'], loop: ['for_statement','foreach_statement','while_statement','do_statement'] },
  scala:      { fn: ['function_definition','function_declaration'], lam: ['lambda_expression'], cls: ['class_definition','object_definition','trait_definition'], call: ['call_expression'], callField: 'function', imp: ['import_declaration'], loop: ['for_expression','while_expression'] },
  swift:      { fn: ['function_declaration'], lam: ['closure_expression'], cls: ['class_declaration','struct_declaration','protocol_declaration','extension_declaration'], call: ['call_expression'], callField: 'function', imp: ['import_declaration'], loop: ['for_statement','while_statement','repeat_while_statement'] },
  kotlin:     { fn: ['function_declaration'], lam: ['lambda_literal','anonymous_function'], cls: ['class_declaration','object_declaration'], call: ['call_expression'], callField: null, imp: ['import_header'], loop: ['for_statement','while_statement','do_while_statement'] },
}

// Minimal sample code with the constructs we care about.
const SAMPLES = {
  c:          'int add(int a, int b) { for (int i=0;i<10;i++) add(i,0); return a+b; }',
  cpp:        'class A { void m() { add(1); } }; template<class T> T id(T x) { return x; } auto f = [](){}; for(;;){}',
  csharp:     'class A { void M() { Invoke(1); Action f = () => {}; } } using System; foreach(var x in xs){}',
  ruby:       'def add(a,b) a+b; end; class C; def m; add(1,2); end; end; for i in [1,2] do puts i end',
  php:        '<?php function add($a,$b) { return $a+$b; } class X { function m() { $f = fn()=>1; add(1,2); } } foreach($xs as $x){}',
  scala:      'object A { def add(a:Int,b:Int)=a+b; val f=(x:Int)=>x+1; add(1,2) } import scala.io._; for(i<-1 to 10){}',
  swift:     'func add(_ a:Int, _ b:Int)->Int { return a+b } class C { func m() { add(1,2); let f={ (x:Int) in x+1 } } } import Foundation',
  kotlin:    'fun add(a:Int,b:Int)=a+b; class A { fun m() { add(1,2); val f={ x:Int->x+1 } } } import kotlin.math.*; for(i in 1..10){}',
}

async function main() {
  if (!GRAMMAR_DIR) { console.error('tree-sitter-wasms not found'); process.exit(1) }

  let target = process.argv[2]
  const langs = target ? [target] : Object.keys(SAMPLES)

  const { default: Parser } = await import('web-tree-sitter')
  await Parser.init()

  let issues = 0, ok = 0

  for (const lang of langs) {
    const spec = SPEC[lang]
    if (!spec) { console.log(`${lang}: no SPEC defined — skipping`); continue }

    const wasmPath = path.join(GRAMMAR_DIR, `tree-sitter-${lang}.wasm`)
    if (!fs.existsSync(wasmPath)) { console.log(`${lang}: WASM not found at ${wasmPath}`); continue }

    const parser = new Parser()
    const Lang = await Parser.Language.load(wasmPath)
    parser.setLanguage(Lang)

    const tree = parser.parse(SAMPLES[lang] || '')
    const observed = new Set()

    function walk(n) {
      observed.add(n.type)
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(tree.rootNode)

    // Check SPEC entries against observed node types — report missing ones
    const missing = { fn: [], lam: [], cls: [], call: [], imp: [], loop: [] }
    for (const cat of ['fn','lam','cls','call','imp','loop']) {
      for (const nt of (spec[cat] || [])) {
        if (!observed.has(nt)) missing[cat].push(nt)
      }
    }
    const report = []
    for (const [cat, ms] of Object.entries(missing)) if (ms.length) report.push(`${cat}=[${ms.join(', ')}]`)

    if (report.length) {
      console.log(`\n⚠ ${lang}: SPEC node-types NOT OBSERVED in sample — may need correction:`)
      for (const r of report) console.log(`   ${r}`)
      console.log(`   Observed types: ${[...observed].sort().join(', ')}`)
      issues++
    } else {
      console.log(`✅ ${lang}: all SPEC node-types confirmed in sample (${observed.size} observed)`)
      ok++
    }
  }

  console.log(`\n=== ${ok} ok, ${issues} with warnings ===`)
  if (issues) console.log('Warnings mean a SPEC node-type name may be wrong for this grammar version. Fix by cross-checking with the grammar\'s node-types.json or by testing a richer sample.')
}

main().catch((e) => { console.error(e); process.exit(1) })
