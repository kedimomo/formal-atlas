// read-named routine that only READS from the DB — NOT a contradiction.
export async function getThings(db) {
  return db.thing.findMany({ where: { active: true } })
}

// read-named routine that MUTATES persistent state (bulk delete) — this IS a
// real intent-effect-mismatch: the name says "get" but it writes.
export async function getAndPurge(db) {
  return db.thing.deleteMany({ where: { stale: true } })
}
