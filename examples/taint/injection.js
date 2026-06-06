// Taint demo: untrusted req.query flowing to a SQL sink.

// VULNERABLE: req.query.name reaches db.query unsanitized -> taint-reaches-sink
export function searchUsers(req, db) {
  const name = req.query.name
  return db.query('SELECT * FROM users WHERE name = ' + name)
}

// SAFE: the same input is sanitized (db.escape) before the sink -> no violation
export function searchSafe(req, db) {
  const raw = req.query.name
  const clean = db.escape(raw)
  return db.query('SELECT * FROM users WHERE name = ' + clean)
}
