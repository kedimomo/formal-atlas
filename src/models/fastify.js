/**
 * Fastify framework model (stage-1, docs/15). A route handler recorded by the
 * extractor as `http_route(File, Scope, Method, Handler)` is INVOKED by the
 * framework on each request — the analyzed source never calls it. We model that
 * runtime fact statically:
 *   calls3(File, Scope, Handler)  — the registering scope leads to the handler,
 *                                   so the linker forms rcall(Scope, Handler) and
 *                                   reaches/impact see the handler's deep calls.
 *   entry(Handler)                — the handler is a call-graph root (not dead).
 *   http_entry(Handler)           — a marker so "what can an HTTP request reach"
 *                                   queries start from the route handlers.
 * 刀2 — per-route hook chains + the request as an entry taint source:
 *   http_hook(File, Handler, Hook) → calls3(File, Handler, Hook) + entry(Hook):
 *     a preHandler/onRequest hook (auth/rebac) is framework-invoked before the
 *     handler, so it is reachable from the handler and is not dead — its body
 *     (the security core) now enters the analyzed call graph.
 *   entry_param(File, Handler, Node) → source(Node): the handler's first param
 *     (req) is untrusted request input, so its taint flows into the handler's
 *     sinks/param-sinks (the dataflow edges from Node are already laid down inert).
 * Models-as-data-ready: other frameworks (Express/Koa/Spring) add their own model
 * fn; the extractor's http_route/http_hook/entry_param signals are framework-agnostic.
 */
import { fact } from '../lift/fact-model.js'

export function fastifyModel(facts) {
  const out = []
  const handlers = new Set() // 'file\thandler' of every route handler (gates entry_param → source)
  const entryParams = [] // { file, fn, node } — a handler first-param node to source
  for (const { pred, args } of facts) {
    if (pred === 'http_route') {
      const file = String(args[0]); const scope = String(args[1]); const handler = String(args[3])
      handlers.add(`${file}\t${handler}`)
      out.push(fact('calls3', file, scope, handler), fact('entry', handler), fact('http_entry', handler))
    } else if (pred === 'http_hook') {
      const file = String(args[0]); const handler = String(args[1]); const hook = String(args[2])
      out.push(fact('calls3', file, handler, hook), fact('entry', hook)) // hook is framework-invoked: reachable from the handler + not dead
    } else if (pred === 'entry_param') {
      entryParams.push({ file: String(args[0]), fn: String(args[1]), node: String(args[2]) })
    }
  }
  // A handler's req is a confirmed untrusted source (only for params of an actual
  // route handler — entry_param is already gated to handlers by the extractor, but
  // re-check here so the model stays correct if that gating ever loosens).
  for (const { file, fn, node } of entryParams) if (handlers.has(`${file}\t${fn}`)) out.push(fact('source', node))
  return out
}
