export async function dbQuery(sql, params) {
  const conn = await getConnection()
  const rows = await conn.execute(sql, params)
  return rows
}

async function getConnection() {
  let conn = null
  // await inside a loop -> 'await-in-loop' violation (serial latency)
  for (let i = 0; i < 3; i++) {
    conn = await connect()
    if (conn) break
  }
  return conn
}
