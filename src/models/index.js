/**
 * Framework-model registry (stage-1, docs/15). Each model maps the extractor's
 * framework-agnostic `http_route/4` (and future register/hook signals) into the
 * rule-consumed facts (calls3/entry/http_entry/source). Activated only under the
 * `--framework` flag (pipeline gate) so default verify stays bit-identical
 * (the raw http_route facts are inert until a model interprets them).
 *
 * To add a framework: write its model fn and push it here — no extractor change.
 */
import { fastifyModel } from './fastify.js'

const MODELS = [fastifyModel]

/** Apply every framework model to the fact base; returns the synthesized facts. */
export function applyModels(facts) {
  const out = []
  for (const model of MODELS) out.push(...model(facts))
  return out
}
