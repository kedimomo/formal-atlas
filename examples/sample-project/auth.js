import { sha256 } from './crypto.js'

export async function validateUser(user) {
  if (!user) return false
  // hardcoded secret literal -> 'hardcoded-sensitive' violation
  const token = sha256(user.id + 'secret-key-123')
  return token === user.token
}

// Never exported, never called -> 'dead-code' violation
function legacyCheck(user) {
  return user && user.role === 'admin'
}
