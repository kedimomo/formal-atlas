// stage-1 framework-model slice-2 (刀2) fixture: per-route hook chains + the
// request as an entry taint source.
//
// WITHOUT --framework: the preHandler hooks (requireAuth/rebacCheck) are not
// reachable from their handlers, and the handler's bare `req` is not a source —
// so nothing is flagged. WITH --framework the model emits calls3(handler→hook)
// + entry(hook) (the auth/rebac security core enters the analyzed call graph)
// and source(req) (the request flows from the handler into the sql param-sinks).
import { externalSink } from './lib.js'

// SQL param-sink: formal `q` (idx 0) → db.query. param_sink(writeDb, 0, sql, na).
// `db` is a free variable, not a parameter, so `q` is the idx-0 value position.
function writeDb(q) {
  db.query(q)
}

// A preHandler hook — framework-invoked before the handler, never called locally.
function requireAuth(req) {
  return req.headers.authorization
}

// A second preHandler hook (used in the array form).
function rebacCheck(req) {
  return check(req.user)
}

// Handler: its first param `req` flows, bare, into the LOCAL sql param-sink.
function listHandler(req, reply) {
  return writeDb(req)
}

// Handler: its `req` flows, bare, into a CROSS-FILE sql param-sink (lib.js).
function sendHandler(req, reply) {
  return externalSink(req)
}

export function registerRoutes(app) {
  app.get('/list', { preHandler: [requireAuth, rebacCheck] }, listHandler)
  app.post('/send', { preHandler: requireAuth }, sendHandler)
}
