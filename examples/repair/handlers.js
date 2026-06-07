// Fixture for the ★3 closed-loop tests. Two xss-shaped sinks carrying untrusted
// input: one is a Fastify JSON response (a FALSE POSITIVE the content-type
// refinement suppresses), the other a real reflected DOM-xss sink (kept).

export async function listUsers(req, reply) {
  const name = req.query.name
  const users = lookupUsers(name)
  return reply.send(users) // FP: Fastify serializes to JSON — not an HTML sink
}

export function renderProfile(req) {
  const bio = req.query.bio
  document.getElementById('bio').innerHTML = bio // REAL reflected DOM xss
}
