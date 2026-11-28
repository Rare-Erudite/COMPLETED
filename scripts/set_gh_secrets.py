#!/usr/bin/env python3
"""Set GitHub Actions secrets for Rare-Erudite/COMPLETED using libsodium sealed boxes."""
import base64, json, os, sys, urllib.request
from nacl import encoding, public

TOKEN = os.environ["GH_TOKEN"]
REPO = "Rare-Erudite/COMPLETED"
API = f"https://api.github.com/repos/{REPO}/actions/secrets"

def gh(method, url, data=None):
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, body) as r:
        raw = r.read()
        return r.status, (json.loads(raw) if raw else {})

def encrypt(public_key_b64: str, secret_value: str) -> str:
    pk = public.PublicKey(public_key_b64.encode(), encoding.Base64Encoder())
    sealed = public.SealedBox(pk).encrypt(secret_value.encode())
    return base64.b64encode(sealed).decode()

def main():
    secrets = json.load(open(sys.argv[1]))
    _, keydata = gh("GET", f"{API}/public-key")
    key_id, key = keydata["key_id"], keydata["key"]
    for name, value in secrets.items():
        if value is None or value == "":
            print(f"SKIP {name} (empty)")
            continue
        enc = encrypt(key, value)
        status, _ = gh("PUT", f"{API}/{name}", {"encrypted_value": enc, "key_id": key_id})
        print(f"{'OK ' if status in (201,204) else 'ERR'} {name} -> {status}")

if __name__ == "__main__":
    main()
