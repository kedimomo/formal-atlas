// ★7 field-sensitive fixture — an object-literal DISPATCH TABLE indexed by a
// COMPUTED key. createHandler/deleteHandler are only ever invoked via
// handlers[k]() — the name-based linker sees `handlers[...]` (a computed member,
// no static name), so it cannot connect the call. Field-sensitive points-to
// stores each function at its field and resolves handlers[k]() to ALL of them.
function createHandler(req) {
  return req.body
}

function deleteHandler(req) {
  return req.id
}

function runOp(req) {
  return req.op
}

export function dispatch(req, k) {
  const handlers = { create: createHandler, delete: deleteHandler }
  return handlers[k](req)
}

// non-computed dispatch: `ops.run()` on an object-literal var resolves to runOp.
export function direct(req) {
  const ops = { run: runOp }
  return ops.run(req)
}
