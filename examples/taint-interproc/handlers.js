// Fixture for ★6 interprocedural taint (within-file tainted-RETURN summaries).
//
// getName RETURNS untrusted input → show()'s `name` is tainted across the call →
// the .innerHTML sink is a TRUE positive (intra-function analysis would miss it).
//
// rows() RETURNS a db.query RESULT, not the input itself → it is NOT a taint
// conduit, so consume()'s `r` must stay clean (no false positive). This is the
// precision guard from docs/10 §三.

function getName(req) {
  const n = req.query.name
  return n
}

function show(req) {
  const name = getName(req)
  document.getElementById('x').innerHTML = name // TRUE positive: tainted via getName
}

function rows() {
  return db.query('select * from t') // constant query → returns a RESULT, carries no taint
}

function consume(req) {
  const r = rows()
  document.getElementById('y').innerHTML = r // NOT tainted: rows returns a result, not input
}
