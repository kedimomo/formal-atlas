import { validateUser } from './auth.js'
import { dbQuery } from './db.js'

// Entry point: handleRequest -> validateUser, handleRequest -> dbQuery -> ...
export async function handleRequest(req) {
  const ok = await validateUser(req.user)
  if (!ok) return { status: 403 }
  const rows = await dbQuery('SELECT * FROM todos WHERE tenant = ?', ['tenant-1'])
  return { status: 200, rows }
}

export function ping() {
  return 'pong'
}
