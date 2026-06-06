% formal-atlas extract: 5 files
% methods: {"acorn-ast":5}

file('auth.js', javascript).
imports('auth.js', './crypto.js').
exports('auth.js', validateUser).
defines('auth.js', validateUser, routine, 3).
async_fn(validateUser).
param(validateUser, 0, user).
calls(validateUser, sha256).
string_lit('auth.js', 'secret-key-123', 6).
defines('auth.js', legacyCheck, routine, 11).
param(legacyCheck, 0, user).
file('crypto.js', javascript).
imports('crypto.js', 'node:crypto').
exports('crypto.js', sha256).
defines('crypto.js', sha256, routine, 3).
param(sha256, 0, input).
calls(sha256, digest).
calls(sha256, update).
calls(sha256, createHash).
exports('crypto.js', hashAll).
defines('crypto.js', hashAll, routine, 8).
param(hashAll, 0, items).
has_loop(hashAll, 10).
calls(hashAll, createHash).
crypto_in_loop(hashAll).
calls(hashAll, push).
calls(hashAll, digest).
calls(hashAll, update).
file('db.js', javascript).
exports('db.js', dbQuery).
defines('db.js', dbQuery, routine, 1).
async_fn(dbQuery).
param(dbQuery, 0, sql).
param(dbQuery, 1, params).
calls(dbQuery, getConnection).
calls(dbQuery, execute).
defines('db.js', getConnection, routine, 7).
async_fn(getConnection).
has_loop(getConnection, 10).
awaits_in_loop(getConnection).
calls(getConnection, connect).
file('server.js', javascript).
imports('server.js', './auth.js').
imports('server.js', './db.js').
exports('server.js', handleRequest).
defines('server.js', handleRequest, routine, 5).
async_fn(handleRequest).
param(handleRequest, 0, req).
calls(handleRequest, validateUser).
calls(handleRequest, dbQuery).
string_lit('server.js', 'tenant-1', 8).
exports('server.js', ping).
defines('server.js', ping, routine, 12).
file('util.js', javascript).
exports('util.js', reportMetric).
defines('util.js', reportMetric, routine, 1).
async_fn(reportMetric).
param(reportMetric, 0, name).
param(reportMetric, 1, value).
calls(reportMetric, fetch).
calls_external(reportMetric, fetch).
calls(reportMetric, stringify).
defines('util.js', formatBytes, routine, 10).
param(formatBytes, 0, n).
calls(formatBytes, toFixed).
intent(validateUser, validate).
side_effect(validateUser, crypto).
pure(legacyCheck).
side_effect(sha256, crypto).
intent(hashAll, compute).
side_effect(hashAll, crypto).
side_effect(dbQuery, database).
intent(getConnection, read).
pure(handleRequest).
pure(ping).
side_effect(reportMetric, network).
pure(formatBytes).
