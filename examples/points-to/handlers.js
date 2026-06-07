// ★7 points-to fixture (docs/12): a call through a variable that aliases a
// function. The name-based linker sees `h(req)` and cannot resolve `h` (it is a
// variable, not a defined name); points-to resolves h → realHandler, yielding a
// real call edge dispatch→realHandler (more than addr_taken's "not dead" flag —
// this edge lets reaches/impact/taint flow through the dynamic dispatch).

export function realHandler(req) {
  document.getElementById('x').innerHTML = req.query.name
}

export function dispatch(req) {
  const h = realHandler // alias the function into a variable
  h(req) // dynamic dispatch — resolved to realHandler via points-to
}
