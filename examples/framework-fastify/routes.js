// stage-1 framework-model fixture (Fastify). Route handlers are invoked by the
// framework, never by local code — so without a framework model, dbWrite/audit
// are NOT reachable from the registration entry. With --framework, the model
// emits calls3(registerRoutes → handler) + entry/http_entry, so reaches connects
// registerRoutes → handler → deep call (the "what can an HTTP request reach" query).
function dbWrite(data) {
  return data
}

function audit(x) {
  return x
}

function requireAuth(req) {
  return req.headers
}

function namedHandler(req, reply) {
  return audit(req.body)
}

export function registerRoutes(app) {
  app.get('/items', async (req, reply) => {
    return dbWrite(req.query.id)
  })
  app.post('/items', { preHandler: [requireAuth] }, namedHandler)
}
