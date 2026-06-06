import hashlib


def handle_request(req):
    user = authenticate(req)
    return query_db(user)


def authenticate(req):
    token = hashlib.sha256(req["body"]).hexdigest()
    return verify_token(token)


def verify_token(token):
    return token == load_expected()


def load_expected():
    # sensitive literal -> 'hardcoded-sensitive'
    return get_from_cache("api_key=secret-value-123")


# module-level public but never called internally; reachability still works
def query_db(user):
    rows = []
    for r in fetch_rows(user):
        rows.append(r)
    return rows


def _legacy_login(req):  # private + uncalled -> dead-code
    return req.get("user")
