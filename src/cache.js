import crypto from 'node:crypto'

const store = new Map()
let hits = 0
let misses = 0

function hash(code) {
  return crypto.createHash('sha256').update(code).digest('hex')
}

export function getCached(absPath, code) {
  const entry = store.get(absPath)
  if (!entry) {
    misses++
    return null
  }
  const h = hash(code)
  if (entry.contentHash === h) {
    hits++
    return entry.facts
  }
  misses++
  return null
}

export function setCache(absPath, code, facts) {
  store.set(absPath, { contentHash: hash(code), facts })
}

export function invalidate(absPath) {
  store.delete(absPath)
}

export function stats() {
  return {
    entries: store.size,
    hitRate: hits + misses === 0 ? 0 : hits / (hits + misses),
  }
}
