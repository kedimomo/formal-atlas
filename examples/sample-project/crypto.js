import crypto from 'node:crypto'

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

// Synchronous crypto INSIDE a loop -> 'crypto-in-loop' violation (membrane breach)
export function hashAll(items) {
  const out = []
  for (const it of items) {
    const h = createHash('sha256')
    out.push(h.update(it).digest('hex'))
  }
  return out
}
