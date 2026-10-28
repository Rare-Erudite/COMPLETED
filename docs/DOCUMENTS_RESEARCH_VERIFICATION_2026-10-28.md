# RARE Documents / Research — Implementation & Verification Report

**Date:** 2026-10-28
**Branch:** `New-Fixes-by-Erudite`
**Supabase project:** `moxtuqgfhucmnblxensw` (`https://moxtuqgfhucmnblxensw.supabase.co`)

This report records only what was actually executed in this pass. Where a check
could not run, it is labelled **BLOCKED** and is not counted as a pass.

---

## 1. Headline

The Documents and Research workspaces are now **wired end to end** and were
**live-tested against a real PostgreSQL 15 instance** — migrations applied,
documents written through the HTTP API, rows confirmed in the database, search
and cross-user isolation exercised.

**Live testing against the Supabase project itself is BLOCKED.** The project URL
was supplied, but **no anon key, no service-role key, and no `DATABASE_URL`
connection string were provided**. Nothing in this report claims a successful
authenticated Supabase read or write, because none was performed.

---

## 2. What was implemented

### 2.1 Shared content engine (`src/server/content/`)

One pipeline for every source, so Documents and Research cannot diverge:

| File | Role |
| --- | --- |
| `SafeFetcher.ts` | SSRF-safe retrieval: HTTPS-only, DNS-pinned, private-range rejection, redirect revalidation, byte caps |
| `ContentSniffer.ts` | Identifies the payload from **magic bytes**, not the filename or declared MIME |
| `Extractors.ts` | 20+ adapters: text, Markdown, code, HTML, JSON, YAML, CSV/TSV, XML, PDF (text layer + OCR fallback), DOCX, ODT, RTF, XLSX, PPTX, EPUB, ZIP, GZIP, image OCR, EML, subtitles |
| `ContentEngine.ts` | Orchestrates accept → identify → retrieve → extract → fall back → normalise → record provenance; plus page/section-aware chunking |
| `SearchIndex.ts` | Per-owner BM25 + exact-phrase index, rebuilt from persisted documents |

### 2.2 Services

- **`DocumentsService.ts`** — library semantics on top of the owner-scoped store:
  path validation, bounded version history (5 revisions), provenance
  (`sourceUrl`, `finalUrl`, `kind`, `method`, `ocr`, `pages`, `warnings`),
  URL import, buffer import, multi-URL import with dedupe and per-item outcomes,
  convert, rename, delete, reindex.
- **`DeepResearchEngine.ts`** — multi-provider discovery, full-text retrieval,
  claim extraction, corroboration, cited report composition, honest
  `providerErrors` / `unreadable` / `limitations` reporting.
- **`ResearchProviders.ts`** — Wikipedia, Crossref, OpenAlex, arXiv, GitHub,
  Open Library, DuckDuckGo, each with an `available()` probe.

### 2.3 Routes wired in `server.ts`

All behind the existing session guard (`res.locals.rareUserId`), so every read
and write is owner-scoped:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/documents` | List the owner's library |
| `GET` | `/api/documents/capabilities` | Which extractors are available in this runtime |
| `GET` | `/api/documents/*` | Read one document |
| `POST` | `/api/documents` | Save text · import URL · import uploaded file |
| `POST` | `/api/documents/import-many` | Multi-URL import, dedupe, partial failure |
| `POST` | `/api/documents/preview-url` | Read a URL without saving |
| `POST` | `/api/documents/rename` | Rename |
| `DELETE` | `/api/documents/*` | Delete + evict from index |
| `POST` | `/api/documents/reindex` | Rebuild the search index |
| `POST` | `/api/documents/convert` | Convert between text formats |
| `POST` | `/api/documents/transcribe` | Audio → transcript document |
| `GET` | `/api/research/providers` | Provider availability |
| `GET` | `/api/research/items` | Saved research projects |
| `GET` | `/api/research/items/:id` | One research project |
| `DELETE` | `/api/research/items/:id` | Delete a research project |
| `POST` | `/api/research/search` | Deep research run |
| `GET` | `/api/search` | Unified search across documents, transcripts, research |

`DocumentsService` is constructed in `startServer()` against the same
`PersistentJsonStore` the rest of the app uses, so persistence semantics are
identical to conversations, memories and projects.

---

## 3. Verification actually performed

### 3.1 Typecheck

```
npx tsc --noEmit   →  exit 0
```

### 3.2 Migrations against real PostgreSQL 15

A real PostgreSQL 15.19 cluster was initialised locally and the project's own
migration runner was executed against it:

```
npx tsx scripts/migrate_database.ts
  Applied: 20261023_core_schema.sql
  Applied: 20261024_rare_user_state.sql
```

Resulting schema — 13 tables, including `rare_users`, `rare_sessions`,
`rare_user_state`, `rare_persistent_documents`, `projects`, `project_tasks`,
`agent_events`, `artifacts`, `rare_oauth_identities`,
`rare_developer_credentials`, `rare_developer_grants`, `rare_checkpoint_files`,
`rare_schema_migrations`.

Row-level security was applied by the second migration
(`ENABLE` + `FORCE ROW LEVEL SECURITY` on `projects`, `project_tasks`,
`agent_events`, `artifacts`, `rare_user_state`).

### 3.3 Full automated suite

Run with a live server on port 3000 backed by the local PostgreSQL instance:

```
npx tsx tests/run_all_tests.ts   →  exit 0
  ALL AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY
```

All 13 groups passed, including authentication/verification-code security,
durable state and document safety, OAuth validation, model providers, the
RARE-INTELLIGENCE bridge, 12 tool primitives, memory lifecycle, the 10-step
self-development loop, the benchmark suite (6/6), toolchain detection
(10 probed, 5 ready) and assistant command interpretation (12 cases).

`/api/status` reported:

```json
{ "storage": { "type": "postgresql", "databaseConfigured": true,
               "databaseReachable": true, "schemaReady": true } }
```

### 3.4 Content engine probes

```
DOCX  → ok, docx-mammoth, text extracted
CSV   → ok, csv-parse, rendered as a Markdown table
HTML  → ok, html-dom, <script> stripped, title captured
JSON  → ok, json-parse
MISLABEL (PDF bytes named .txt) → identified as pdf from magic bytes
CHUNKS → page/section-aware chunk produced
URL   → ok, html-dom, https://example.com/ (171 chars)
SSRF  → refused, UNSAFE_SCHEME
```

### 3.5 Research engine probe

A real `standard`-depth run against live providers:

```
providers: crossref, openalex, arxiv, github, openlibrary, duckduckgo
stats: discovered 10 · retrieved 10 · fullText 6 · 2159 ms
sources: 6 · claims: 19 · unreadable: 4
providerErrors: [ 'en.wikipedia.org returned HTTP 503.' ]
```

The Wikipedia 503 is reported verbatim rather than hidden — the engine degrades
per-provider and says so.

### 3.6 End-to-end HTTP routes (live server, real PostgreSQL)

| Check | Result |
| --- | --- |
| `POST /api/user/guest-session` | `200` |
| `GET /api/documents` anonymous | **`401`** |
| `GET /api/documents` authenticated | `200`, `[]` |
| `GET /api/documents/capabilities` | `200`, extractor list |
| `POST /api/documents` (save text) | `201`, `version: 1` |
| `GET /api/documents` after save | `200`, document listed |
| `GET /api/documents/notes/architecture.md` | `200`, content + history |
| `GET /api/search?q=provenance` | `200`, 1 hit, `matchedBy: terms` |
| `POST /api/documents` (PDF URL import) | `201`, `kind: pdf`, `method: pdfjs-text`, 1 page |
| `POST /api/documents` (SSRF `http://127.0.0.1`) | **`422`**, `UNSAFE_SCHEME` |
| Second guest lists documents | `[]` — isolation holds |
| Second guest reads first guest's document | **`404`** — isolation holds |
| `GET /api/research/providers` | `200`, providers with availability |
| `POST /api/research/search` as guest | **`403`** — account required |

### 3.7 Persistence confirmed in PostgreSQL

The document written through the API was read back **directly from the
database**, not from application memory:

```sql
SELECT owner_id, state_key, payload->0->>'path', payload->0->>'version'
FROM rare_user_state WHERE state_key='documents' AND jsonb_array_length(payload) > 0;

guest_2868e909-… | documents | notes/architecture.md          | 1
guest_820af545-… | documents | imports/1706-1793162147234.md   | 1
```

`rare_persistent_documents` and `rare_sessions` also held live rows, confirming
the session and state layers are genuinely database-backed.

---

## 4. BLOCKED — Supabase credentials not supplied

`scripts/verify_supabase.mjs` was added to make this state reproducible and
honest. Its output in the real environment:

```
RARE Supabase verification — project moxtuqgfhucmnblxensw

✓ REST endpoint reachable: PASS
    HTTP 401 UNAUTHORIZED_MISSING_API_KEY · sb-project-ref=moxtuqgfhucmnblxensw
    — project exists and is served
⊘ Authenticated REST read (rare_user_state): BLOCKED
    No SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY supplied.
⊘ Direct PostgreSQL persistence: BLOCKED
    DATABASE_URL is not set. No Supabase connection string was supplied.

Summary: 1 passed, 0 failed, 2 blocked.
```

### What this proves

- The project **exists and is reachable**: the gateway returns
  `sb-project-ref: moxtuqgfhucmnblxensw` and `UNAUTHORIZED_MISSING_API_KEY`.
- A bogus key is rejected with `UNAUTHORIZED_INVALID_API_KEY`, so the auth
  layer is live rather than a stub.

### What this does NOT prove

- That the RARE schema exists in **that** project.
- That migrations have been applied to **that** project.
- That any authenticated read or write succeeds against **that** project.

**No Supabase write or read was mocked, simulated, or inferred.** The local
PostgreSQL run in §3 is a genuine live test of the same migrations and the same
`pg`-based persistence code — but it is a *different database* and is not
evidence about the Supabase project's contents.

### To unblock

Provide **either**:

1. **`DATABASE_URL`** — the Supabase pooler connection string, e.g.
   `postgres://postgres.moxtuqgfhucmnblxensw:<DB_PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres`
   This is what the application's persistence layer actually uses. Then run:
   ```
   DATABASE_URL=… npx tsx scripts/migrate_database.ts
   DATABASE_URL=… node scripts/verify_supabase.mjs
   ```

2. **`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`** — only needed for
   REST-level (PostgREST) verification. These do **not** replace
   `DATABASE_URL` for the app's own persistence.

Note: the anon key alone is subject to row-level security and will not see
owner-scoped rows without a matching JWT claim; the service-role key bypasses
RLS and should be used only for verification, never shipped to a client.

---

## 5. Other standing items

1. **The UI wiring is still not on the remote branch.** `src/App.tsx` and
   `server.ts` changes exist locally; `git push` has no credentials in this
   sandbox. `patches/rare-ui-wiring.patch` reproduces the tree byte-for-byte.
   *(Resolved in the second pass below: committed locally, still not pushed.)*
2. **`server-build/server.js` is a stale committed bundle.** `npm start` runs
   it directly, so it must be regenerated (`npm run build:server`) before any
   deployment that uses `npm start`.
   *(Resolved in the second pass below.)*
3. **`GEMINI_API_KEY` is production-only**, so audio transcription and the
   Gemini path return an honest `TRANSCRIPTION_PROVIDER_UNAVAILABLE` on Preview.
4. **APK signing identity is unverified** — `apksigner` is not available here.

---

## 5b. Second pass — 2026-10-28 (later)

### Defects fixed

**Test runner silently passed.** `tests/test_authentication_security.ts` fetched
`http://127.0.0.1:3000` assuming a server was already running. From a clean
checkout nothing was listening, every request threw, and `npm test` still exited
0 — a green suite that tested nothing. `tests/run_all_tests.ts` now:

- allocates a free ephemeral port,
- boots `server.ts` itself and waits for `/api/health`,
- exports `RARE_TEST_BASE_URL` (and `RARE_ALLOWED_ORIGINS` for that port, so the
  existing origin-pinning check is satisfied rather than weakened),
- tears the server down and **exits non-zero** if any suite fails.

`BASE` in the auth suite is now read lazily at call time, not captured at import
time before the env var exists.

**Stale `server-build/`.** The compiled backend was committed, so `npm start`
could serve outdated code. It is now untracked and gitignored, and `npm start`
runs `build:server` first (`start:built` skips the rebuild for containers that
build in their own step).

### Added in this pass

- **Chat/assistant access.** `OPEN_URL`, `READ_DOCUMENT`, `SEARCH_LIBRARY` and
  `START_RESEARCH` are registered on `ToolExecutor` with specs in `TOOL_SPECS`.
  The owner is taken from `options.ownerId` (the authenticated session), never
  from model-supplied arguments; a call without an owner is refused. Verified
  directly through the executor: `OPEN_URL` read a live page, `SEARCH_LIBRARY`
  found a saved document, and a second owner got zero hits and a 404.
- **More formats verified end-to-end:** PPTX (slides + speaker notes), ODS,
  EPUB, EML, SRT, and archive listing. PPTX detection was hardened so a
  presentation is not mistaken for a plain ZIP.
- **UI verified in a real browser.** Documents and Research are in the sidebar
  and render; screenshots were checked for layout breakage.

### Commands re-run in this pass

```
npx tsc --noEmit        → exit 0
npm test                → boots its own server, all suites pass
npm run build:web       → vite build + vercel static sync
npm run build:server    → esbuild → server-build/server.js
```

Note: `build:web` needs roughly 1.5 GB of headroom; it was OOM-killed once in a
2 GB container while a dev server was still resident, and passed after freeing
memory. That is an environment limit, not a code defect.

---

## 6. Reproducing this verification

```bash
# 1. Real PostgreSQL
initdb -D /tmp/pgdata -A trust -U postgres
pg_ctl -D /tmp/pgdata -o '-p 55432 -k /tmp/pgrun' start
createdb -h 127.0.0.1 -p 55432 -U postgres rare_test

# 2. Migrations
DATABASE_URL="postgres://postgres@127.0.0.1:55432/rare_test" \
  npx tsx scripts/migrate_database.ts

# 3. Server
DATABASE_URL="postgres://postgres@127.0.0.1:55432/rare_test" \
RARE_ALLOW_LOCAL_STORAGE_FALLBACK=true PORT=3000 npx tsx server.ts &

# 4. Suite + probes
DATABASE_URL="postgres://postgres@127.0.0.1:55432/rare_test" npx tsx tests/run_all_tests.ts
npx tsx scripts/probe_content.ts
npx tsx scripts/probe_research.ts

# 5. Supabase state (honest: reports BLOCKED without credentials)
node scripts/verify_supabase.mjs
```

---

## 7. Summary

| Area | Status |
| --- | --- |
| Content engine (20+ formats, SSRF-safe) | **Implemented, live-tested** |
| Documents service + 12 routes | **Implemented, live-tested** |
| Deep research engine + 6 routes | **Implemented, live-tested** |
| Unified search | **Implemented, live-tested** |
| Migrations on real PostgreSQL 15 | **Applied, verified** |
| Full test suite (13 groups) | **Passing** |
| Owner isolation (cross-user) | **Verified** |
| Supabase project reachability | **Verified** |
| Supabase authenticated persistence | **BLOCKED — no keys supplied** |
