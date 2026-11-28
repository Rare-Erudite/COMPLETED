# Scheduler Tick Failure — Root Cause, Fix, and Current State

**Date:** 2026-11-28
**Repo:** Rare-Erudite/COMPLETED
**main HEAD at time of writing:** `7cb1228c4acf68d3e5df6d4021f25d13876a7e36`
**Live deployment serving:** `f18ae02bec399bbf7686dbcd7bb6ff72881a4f80` — **NOT the current main**

---

## 1. The GitHub Actions "Scheduler Tick" failure

### What the logs actually said

Read from the GitHub API, run `46103153545` (scheduled, `c7c6944`), job `140849932591`:

```
STEP 1 Set up job                    success
STEP 2 Check the secret is configured failure
STEP 3 Call the tick endpoint         skipped
STEP 4 Summarise                      success
```

The step log:

```
env:
  SCHEDULER_SECRET:
##[error]RARE_SCHEDULER_SECRET is not set. Add it under Settings > Secrets and variables > Actions.
##[error]Process completed with exit code 1.
```

The secret is empty. The job failed in 4–5 seconds because it never reached the network.

### Confirmed against repository settings

`GET /repos/Rare-Erudite/COMPLETED/actions/secrets` returns exactly four secrets:

```
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

`RARE_SCHEDULER_SECRET` is **not present**. Repository variables: `total_count: 0`, so `RARE_BASE_URL` is also unset and the workflow falls back to its hardcoded default.

**Status: BLOCKED — owner action required.** No code change can supply a secret.

### But the missing secret was hiding two real code defects

Investigating why the endpoint would still fail *with* a correct secret, I found:

**Defect 1 — the session gate rejected every tick before the secret was read.**

`/api/scheduler/tick` was not in `PUBLIC_API_PATHS`, so the global `/api` middleware ran `requireAuthenticatedSession` first. GitHub Actions has no user session. The live endpoint proved it:

```
POST https://rareproject.vercel.app/api/scheduler/tick
→ 401 {"error":{"message":"A valid RARE session is required."}}
```

That is a **401**, not the **403** the route's own secret check would produce. The production trigger was unreachable by design — it could never have worked, secret or no secret.

**Defect 2 — an unset secret meant no gate at all.**

```ts
const secret = process.env.RARE_SCHEDULER_SECRET;
if (secret) { ...check... }   // unset ⇒ no check
```

A deployment that forgot the variable exposed an unauthenticated endpoint that runs every due task. A missing secret is a misconfiguration, not permission.

### The fix (commit `7cb1228`)

1. `/api/scheduler/tick` added to `PUBLIC_API_PATHS` in `server.ts` — the route's own secret gate is now the only gate, which is correct for a machine-to-machine endpoint.
2. The route **fails closed**: no secret ⇒ `503` with an explicit message, never an open endpoint.
3. `src/api.ts` public-path list updated to mirror the server. A regression test (`Session bootstrap`) caught this drift — it failed with `every server-public path is also public on the client — /api/scheduler/tick` until fixed.
4. The workflow now reports a missing secret as a titled error plus a step summary with the exact four setup steps.

### Verified locally against a real server

```
POST /api/scheduler/tick  (no header)          → 403 Invalid scheduler secret.
POST /api/scheduler/tick  (wrong secret)       → 403 Invalid scheduler secret.
POST /api/scheduler/tick  (correct secret)     → 200
  {"success":true,"report":{"scanned":30,"claimed":0,"executed":0,
   "succeeded":0,"failed":0,"missed":0,"skipped":0,"errors":[]}}
```

**Status: PASS** (local, real server, real secret).

### Re-run after the fix

Dispatched `workflow_dispatch` on `7cb1228` → run `46108027218`, job `140865061342`:

```
STEP 2 Check the secret is configured  failure
##[error]The repository secret RARE_SCHEDULER_SECRET is not set, so the tick
endpoint cannot be authenticated. Add it under Settings > Secrets and
variables > Actions. Its value must be identical to the RARE_SCHEDULER_SECRET
environment variable on the Vercel deployment.
```

**Status: BLOCKED** — same cause, now with an actionable message instead of a bare exit. The workflow cannot pass until the secret exists.

### What the owner must do

1. Generate a value: `openssl rand -hex 32`.
2. Add it as repository secret **`RARE_SCHEDULER_SECRET`** (Settings → Secrets and variables → Actions).
3. Add the **same** value as environment variable **`RARE_SCHEDULER_SECRET`** in the Vercel project.
4. Re-run the workflow.

Do not paste the value into a message, an issue or a commit.

---

## 2. DATABASE_URL / PostgreSQL concurrency

### Is a connection configured?

**No.** `DATABASE_URL` is unset in this environment; no `.env` file exists (only `.env.example`); no `postgres`/`supabase` environment variables are present. The live `/api/health` reports no database field.

**Status: BLOCKED for the deployed environment** — only the owner can supply the connection, through a secure channel.

### But the concurrency tests were run anyway, against a real PostgreSQL

PostgreSQL 15.20 is installed in this sandbox. I initialised a real cluster on port 5433 and ran the two-worker suite against it — no mocks, no in-memory substitute. Two independent `PostgresScheduleStore` instances, each with its own connection pool, so the claim race is decided by the database.

`tests/scheduler/test_postgres_concurrency.ts`:

| Test | Result | Evidence |
|---|---|---|
| PostgreSQL reachable | **PASS** | `PostgreSQL 15.20 (Debian 15.20-0+deb12u1) on x86_64-pc-linux-gnu` |
| Two workers, one task — exactly one claim | **PASS** | `winners=1 (worker-A); A=claimed B=null` |
| Live lease blocks a second claim | **PASS** | second claim correctly refused |
| Worker termination — lease expires and is reclaimed | **PASS** | `blocked while lease live=true; reclaimed after expiry=true` |
| Restart recovery — new process reads persisted task | **PASS** | `task race_1 recovered (status=active)` |
| Persisted history survives restart | **PASS** | `run_count=7 last_status=success` |
| Concurrent scheduling — 40 tasks, 2 workers | **PASS** | `claimed=40/40 doubleClaimed=0` |
| Delete is owner-scoped | **PASS** | `wrongOwner=false rightOwner=true` |

**8 passed, 0 failed.**

One genuine bug surfaced while writing this: `save()` reads `owner_id` off the task object, and a task without it lands under the reserved `__scheduler__` owner, so owner-scoped delete can never match. That is a real sharp edge in the store's contract, not a test artefact — worth noting for whoever wires task creation.

**Status: PASS against a real PostgreSQL 15 instance in this sandbox. NOT verified against the owner's Supabase/PostgreSQL deployment**, because no connection string is available.

---

## 3. Merge and deploy

| Check | Result |
|---|---|
| `origin/main` HEAD | `7cb1228c4acf68d3e5df6d4021f25d13876a7e36` |
| Local HEAD | `7cb1228c4acf68d3e5df6d4021f25d13876a7e36` |
| Ahead/behind | `0 0` |
| Working tree | clean |
| **Live `/api/health` commit_sha** | **`f18ae02bec399bbf7686dbcd7bb6ff72881a4f80`** |
| Match? | **NO** |

**Status: FAIL — the live deployment is serving an older commit.**

The site loads (`/` → 200, 7,730 bytes) and `/api/health` → 200 `status: healthy`, but it is the `f18ae02` build. Proof it is stale, not merely cached:

- `/api/plugins/catalog` → **404** `API endpoint not found` (the route exists on main)
- `/api/scheduler/tick` → **401** `A valid RARE session is required` (the pre-fix behaviour)
- `uptimeSeconds` resets to ~40 on every probe, so a fresh instance is being created and serving old code

I could not fix this: `VERCEL_TOKEN` is unset, `scripts/deploy.mjs status` refuses to run, and there is no Vercel API access to read the build log or trigger a deploy.

**Owner action:** open the Vercel dashboard for `rareproject` → Deployments. Either the Git integration is disconnected or the latest build failed. Redeploy `7cb1228` manually. `/api/health` should then report `7cb1228`.

---

## 4. Plugins / MCP integration

Verified against a **local server running the current main code** (the live deployment is too old to answer these routes).

### `/api/mcp/servers`

```json
{
  "configured": true,
  "configurationError": null,
  "servers": [{
    "id": "rare-reference",
    "name": "RARE Reference Tools",
    "transport": "stdio",
    "target": "/usr/bin/node",
    "connected": true,
    "toolCount": 6,
    "serverInfo": { "name": "rare-reference", "version": "1.0.0" }
  }]
}
```

**PASS** — configured and connected. The server is `scripts/mcp_reference_server.mjs`, a genuine MCP server over stdio: no account, no API key, no network, no billing.

### `/api/mcp/tools`

6 tools discovered: `echo`, `add`, `now`, `word_count`, `sha256`, `rare_version`.

**PASS**

### Real tool invocations

Tool names must be qualified `serverId__toolName`. With a real account session and CSRF token:

```
POST /api/mcp/call {"tool":"rare-reference__add","arguments":{"a":17,"b":25}}
→ 200 {"ok":true,"content":[{"type":"text","text":"42"}]}

POST /api/mcp/call {"tool":"rare-reference__sha256","arguments":{"text":"abc"}}
→ 200 {"ok":true,"content":[{"type":"text","text":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}]}

POST /api/mcp/call {"tool":"rare-reference__word_count","arguments":{"text":"one two three four"}}
→ 200 {"ok":true,"content":[{"type":"text","text":"{\"words\":4,\"characters\":18,\"lines\":1}"}]}
```

`42` is correct arithmetic. The SHA-256 is the true digest of `"abc"`. The word count is correct. These are computed, not canned.

**PASS** — a real tool call succeeds and returns a real computed result.

### `/api/plugins/catalog`

```json
{
  "summary": {
    "builtInCount": 8,
    "integrationCount": 1,
    "connectedIntegrations": 1,
    "discoveredTools": 6,
    "configurationError": null
  }
}
```

**The exact numbers:**

| Category | Count | What it means |
|---|---|---|
| **Built-in capabilities** | **8** | RARE's own features, listed as `builtIn`. Not external integrations. |
| **Connected integrations** | **1** | `rare-reference` — a real MCP server, genuinely connected. |
| **Discovered tools** | **6** | Real tools from that one server. |

The 8 built-ins (`plugin_compiler_pro`, `plugin_visioncraft`, `plugin_live_audio`, `plugin_infinite_memory`, `plugin_smart_scheduler`, `plugin_speech_transcribe`, `plugin_github_bridge`, `plugin_security_sandbox`) are RARE's own capability labels. They are **not** connected third-party integrations and the catalog no longer presents them as such.

**PASS** — the count is derived from the live MCP manager, not a hardcoded array.

### What is genuinely integrated vs. only coded

| Item | Status |
|---|---|
| MCP client, handshake, discovery, invocation | **PASS** — real, exercised |
| One free local stdio server connected | **PASS** — 6 real tools |
| Real tool call returning computed result | **PASS** |
| Plugin catalog separating built-in from connected | **PASS** |
| Invocation from **Chat** | **NOT TESTED** on the live deployment (stale build) |
| Invocation from **Assistant** | **NOT TESTED** |
| Invocation from **Scheduler** | **NOT TESTED** |
| Invocation from **Agents** | **NOT IMPLEMENTED** — no MCP binding in `src/server/agents/` |
| External (non-bundled) MCP server | **NOT CONFIGURED** — `RARE_MCP_SERVERS` unset |

---

## 5. Test suite

```
npx tsc --noEmit          clean (exit 0)
npm test                  EXIT:0 — all sections pass
```

Notable sections: Navigation 18/18, Session bootstrap 10/10, Self-build 17/17, Intent router 35/35, Documents increment 56/56, Research increment 31/31, Scheduler capability 24/24, completion phase 34/34, natural language 24/24.

The Session bootstrap section initially failed on my change and was fixed properly rather than by weakening the assertion.

---

## 6. Summary

| Question | Answer | Status |
|---|---|---|
| Is DATABASE_URL configured? | No | **BLOCKED** — owner only |
| PostgreSQL concurrency verified? | Yes, against real PG 15 in sandbox | **PASS** (not against owner's DB) |
| main HEAD | `7cb1228` | — |
| Live deployed commit | `f18ae02` | **FAIL** — mismatch |
| Working tree clean? | Yes | **PASS** |
| MCP server configured/connected? | Yes, 1 server | **PASS** |
| Tools discovered? | 6 | **PASS** |
| Real tool call succeeds? | Yes, computed results | **PASS** |
| Built-in capabilities | 8 | — |
| Connected integrations | 1 | — |
| Scheduler tick workflow | Fails on missing secret | **BLOCKED** — owner action |
| Scheduler tick code | Fixed, verified locally | **PASS** |

### Owner actions outstanding

1. **`RARE_SCHEDULER_SECRET`** — repository secret *and* Vercel env var, same value.
2. **Redeploy `7cb1228`** in Vercel — the live site is stale.
3. **`DATABASE_URL`** — secure channel only, never in a message.
4. **`VERCEL_TOKEN`** — so deploys can be triggered and inspected without the dashboard.
