#!/usr/bin/env python3
"""End-to-end verification of the RARE Preview/local API surface.

Exercises the real server with a real account: signup, document write/read,
research (live connectors), cross-user isolation, and the updater endpoints.
Prints status codes and short bodies. No secrets are written to disk.
"""
import json
import time
import urllib.error
import urllib.request
import http.cookiejar

BASE = "http://127.0.0.1:3000"
ORIGIN = BASE


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )
        self.csrf = ""

    def request(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        req.add_header("Origin", ORIGIN)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if self.csrf:
            req.add_header("X-CSRF-Token", self.csrf)
        try:
            with self.opener.open(req, timeout=60) as resp:
                token = resp.headers.get("X-CSRF-Token")
                if token:
                    self.csrf = token
                raw = resp.read().decode("utf-8", "replace")
                return resp.status, raw
        except urllib.error.HTTPError as exc:
            token = exc.headers.get("X-CSRF-Token")
            if token:
                self.csrf = token
            return exc.code, exc.read().decode("utf-8", "replace")

    def get(self, path):
        return self.request("GET", path)


def short(text, limit=220):
    text = " ".join(text.split())
    return text[:limit] + ("…" if len(text) > limit else "")


def main():
    stamp = int(time.time())
    results = []

    # --- account creation -------------------------------------------------
    alice = Client()
    email_a = f"alice{stamp}@rare.test"
    status, body = alice.request(
        "POST", "/api/user/signup",
        {"email": email_a, "password": "Str0ngPass2026x", "name": "Alice"},
    )
    results.append(("signup (Alice)", status, short(body)))

    status, body = alice.get("/api/user/me")
    results.append(("session lookup (Alice)", status, short(body)))

    # --- document write / read -------------------------------------------
    status, body = alice.request(
        "POST", "/api/documents",
        {"path": "notes/private-plan.md", "text": "# Alice plan\n\nSecret roadmap detail."},
    )
    results.append(("create document (Alice)", status, short(body)))

    status, body = alice.get("/api/documents")
    results.append(("list documents (Alice)", status, short(body)))

    status, body = alice.get("/api/documents/notes/private-plan.md")
    results.append(("read document (Alice)", status, short(body)))

    # --- research (REAL connectors) ---------------------------------------
    status, body = alice.request(
        "POST", "/api/research/search",
        {"query": "What is the Rust programming language?", "maxResults": 3},
    )
    detail = ""
    try:
        payload = json.loads(body)
        item = (payload.get("results") or [{}])[0]
        sources = item.get("sources") or []
        detail = f"{len(sources)} sources; errors={item.get('sourceErrors')}"
        if sources:
            detail += " | first=" + short(str(sources[0].get("url")), 70)
    except Exception:
        detail = short(body)
    results.append(("research search (real connectors)", status, detail))

    status, body = alice.get("/api/research/items")
    results.append(("research history (Alice)", status, short(body)))

    # --- save research to documents --------------------------------------
    status, body = alice.request(
        "POST", "/api/documents",
        {"path": "research/report.md", "text": "# Research\n\nreport body"},
    )
    results.append(("save research report to documents", status, short(body)))

    # --- cross-user isolation --------------------------------------------
    bob = Client()
    email_b = f"bob{stamp}@rare.test"
    status, body = bob.request(
        "POST", "/api/user/signup",
        {"email": email_b, "password": "Str0ngPass2026y", "name": "Bob"},
    )
    results.append(("signup (Bob)", status, short(body)))

    status, body = bob.get("/api/documents")
    results.append(("list documents (Bob must be empty)", status, short(body)))

    status, body = bob.get("/api/documents/notes/private-plan.md")
    results.append(("read Alice's document as Bob (must 404)", status, short(body)))

    status, body = bob.request(
        "POST", "/api/documents",
        {"path": "notes/private-plan.md", "text": "OVERWRITTEN BY BOB"},
    )
    results.append(("Bob writes same path (own namespace)", status, short(body)))

    status, body = alice.get("/api/documents/notes/private-plan.md")
    intact = "Alice plan" in body
    results.append(
        ("Alice's document still intact", status,
         f"intact={intact} | {short(body, 90)}")
    )

    status, body = bob.get("/api/research/items")
    results.append(("research history (Bob must be empty)", status, short(body)))

    # --- unauthenticated access ------------------------------------------
    anon = Client()
    status, body = anon.get("/api/documents")
    results.append(("documents without a session (must 401/403)", status, short(body)))

    status, body = anon.request(
        "POST", "/api/research/search", {"query": "anything"}
    )
    results.append(("research without a session (must be refused)", status, short(body)))

    # --- updater ----------------------------------------------------------
    plain = Client()
    status, body = plain.get("/api/download/apk/info")
    results.append(("APK metadata (public)", status, short(body)))

    status, body = plain.get("/api/updates/check?clientVersion=1.0.0&channel=public")
    results.append(("update check (public)", status, short(body)))

    status, body = alice.request("POST", "/api/updates/apply", {})
    results.append(("update apply (must not claim install)", status, short(body)))

    # --- capability matrix ------------------------------------------------
    status, body = alice.get("/api/builder/toolchains")
    try:
        payload = json.loads(body)
        status_detail = f"ready={payload.get('ready')}/{payload.get('total')}"
    except Exception:
        status_detail = short(body)
    results.append(("builder toolchains (real probes)", status, status_detail))

    width = max(len(name) for name, _, _ in results)
    print(f"{'CHECK'.ljust(width)}  STATUS  DETAIL")
    print("-" * (width + 60))
    for name, status, detail in results:
        print(f"{name.ljust(width)}  {status:>6}  {detail}")

    # Machine-readable verdict. Expectations are declared explicitly rather than
    # inferred from wording, so a correct refusal is never reported as a failure.
    expectations = {
        "read Alice's document as Bob (must 404)": {404},
        "documents without a session (must 401/403)": {401, 403},
        "research without a session (must be refused)": {401, 403},
        "update apply (must not claim install)": {501},
        "session lookup (Alice)": {200},
        "signup (Alice)": {200, 201},
        "create document (Alice)": {200, 201},
        "research search (real connectors)": {200},
        "builder toolchains (real probes)": {200},
        "APK metadata (public)": {200},
    }

    failures = []
    print("\nVERDICT")
    for name, status, detail in results:
        expected = expectations.get(name)
        if expected is None:
            continue
        verdict = "PASS" if status in expected else "FAIL"
        if verdict == "FAIL":
            failures.append(f"{name}: got {status}, expected {sorted(expected)}")
        print(f"  {verdict} {name} -> {status}")

    # Empty-by-construction checks: a second user must own nothing.
    for name, status, detail in results:
        if "(Bob must be empty)" in name:
            empty = detail.strip() == "[]"
            print(f"  {'PASS' if empty and status == 200 else 'FAIL'} {name} -> {detail}")
            if not (empty and status == 200):
                failures.append(f"{name}: {detail}")

    if failures:
        print("\nUNRESOLVED:")
        for item in failures:
            print(f"  - {item}")
        return 1

    print("\nAll expected outcomes observed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
