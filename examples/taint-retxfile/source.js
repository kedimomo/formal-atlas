// ★6d cross-file fixture — the tainted-RETURN conduits live HERE; the callers
// that consume their results live in consumer.js. summarizeReturns marks getName
// a conduit (it returns a bare var holding req.query.*); rows() returns a
// db.query RESULT, not the input, so it is NOT a conduit — the slice-1 precision
// guard (docs/10 §三) carried across the file boundary.

export function getName(req) {
  const n = req.query.name
  return n // returns untrusted input → a tainted-RETURN conduit
}

export function rows() {
  return db.query('select * from t') // returns a query RESULT → carries no taint
}
