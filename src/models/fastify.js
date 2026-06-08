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
 * Models-as-data-ready: other frameworks (Express/Koa/Spring) add their own model
 * fn; the extractor's http_route signal is framework-agnostic.
 */
import { fact } from '../lift/fact-model.js'

export function fastifyModel(facts) {
  const out = []
  for (const { pred, args } of facts) {
    if (pred !== 'http_route') continue
    const file = String(args[0])
    const scope = String(args[1])
    const handler = String(args[3])
    out.push(fact('calls3', file, scope, handler))
    out.push(fact('entry', handler))
    out.push(fact('http_entry', handler))
  }
  return out
}
