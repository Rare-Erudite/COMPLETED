# RARE Documents & Research — Live Verification Report

**Date:** 2026-10-28
**Branch:** `New-Fixes-by-Erudite`
**Head commit:** `9695929` (pushed, verified via `git ls-remote`)
**Supabase project:** `moxtuqgfhucmnblxensw` (eu-north-1)
**Preview deployment:** https://rareproject-pf2ywtv6h-mypremierai-2827.vercel.app
**Production:** untouched (not promoted)

Every claim below is backed by a command that was actually run. Where something
could not be verified, it is listed under **Still blocked** rather than assumed.

---

## 1. Supabase live persistence — UNBLOCKED

### Connection

| Attempt | Result |
|---|---|
| `psql` port 6543, `sslmode=require` | **works** (PostgreSQL 17.11) |
| `pg` + `sslmode=require` in URL | **fails** — `self-signed certificate in certificate chain` |
| `pg` + `uselibpqcompat=true` | **rejected** — silently yields `ssl=false` (unencrypted) |
| `pg` + explicit `ssl:{rejectUnauthorized:false}` | **works, encrypted** |

**Root cause.** `pg-connection-string` v2 maps `sslmode=require` to
`verify-full`, demanding a chain verifiable against Node's bundled CA store.
libpq (and therefore `psql`) treats `require` as "encrypt, do not verify".
Supabase's chain terminates at *Supabase Root 2021 CA*, which is not in Node's
bundle — so the identical URL worked in `psql` and failed in Node.

**Fix** (`src/server/storage/pgSsl.ts`, commit `91eff0f`): `resolvePgSsl()`
keeps the connection encrypted and skips chain verification **only** for
`*.supabase.com` / `*.supabase.co` hosts, matching libpq's `require` semantics.
`RARE_DB_SSL_STRICT=true` restores full verification. Applied to both the
application pool and the migration runner.

Port **6543 (transaction pooling) was used throughout and worked** — no retry on
5432 was needed. `PersistentJsonStore` uses transaction-local
`SELECT set_config('rare.user_id', …)` inside explicit transactions, which is
pooler-safe.

### Migrations

`npm run migrate` → applied `20261024_rare_user_state`, `20261026_*`, and the
new `20261028_rls_role_grants`. Idempotent (checksum-tracked).

**Pre-existing data preserved:** `rare_persistent_documents` count = **16**
before and after every migration run.

### Schema & RLS (queried from `pg_class` / `pg_policies`)

| Table | RLS | Forced |
|---|---|---|
| `rare_user_state` | on | **yes** |
| `rare_persistent_documents` | on | yes |
| `rare_users` | on | yes |
| `rare_sessions` | on | yes |

### Persistence proof (local server, `DATABASE_URL` → Supabase)

```
POST /api/documents            → 201
GET  /api/documents            → 200
GET  /api/documents/<path>     → 200
GET  /api/search?q=ZXQ-7731    → 200, hit
--- server killed, restarted ---
GET  /api/documents/<path>     → 200  (content intact)
GET  /api/search?q=ZXQ-7731    → 200, hit
```

Direct SQL against Supabase:

```sql
select owner_id, state_key, jsonb_array_length(payload) as docs, updated_at
from rare_user_state where state_key='documents' order by updated_at desc;
-- usr_9f0d8b17-… | documents | 1 | 2026-10-28 10:35:51+00
```

The row written through the API is present in Supabase. A document written from
the **Vercel preview** was likewise confirmed in the table (`VCL-4412`).

### Multi-tenant isolation (against Supabase)

| Check | Result |
|---|---|
| Guest B lists documents | `[]` |
| Guest B reads Guest A's document | **404** |
| Guest B searches Guest A's marker | **0 hits** |
| RLS as `authenticated`, owner id = A | **1 row visible** |
| RLS as `authenticated`, other owner id | **0 rows visible** |

**Important nuance, stated plainly:** the application connects as `postgres`,
which carries `rolbypassrls = true` on Supabase. RLS therefore does **not**
filter the app's own queries — ownership is enforced in the service layer and
proven by the 404/0-hit tests above. The database-level backstop is real for
clients connecting as `authenticated`/`anon` (verified: 1 row vs 0 rows), and
`20261028_rls_role_grants.sql` adds the table privileges RLS needs to be
consulted at all — without a GRANT, `authenticated` fails with "permission
denied" before any policy is evaluated.

### `scripts/verify_supabase.mjs`

- **Direct PostgreSQL persistence → PASS**
- **REST API check → BLOCKED** — no anon/service-role key was supplied. The
  project is reachable (`sb-project-ref` header confirms identity) but no
  authenticated REST read/write was performed, and none is claimed.

---

## 2. Git

- Branch: `New-Fixes-by-Erudite` (never switched to `main`, no merge, no force-push)
- Remote head: `9695929d614d2b284a2b326d6a81af97376694d2` — **matches local**
- Commits pushed this session:
  - `91eff0f` fix(db): Supabase pooler TLS semantics + RLS role grants
  - `2b116cc` fix(vercel): ship pdfjs-dist with the serverless function
  - `5b9dc07` fix(providers): stop hardcoding retired Gemini model ids
  - `b0a8f34` test(providers): assert against the configured model
  - `9695929` chore: ignore .vercel CLI artifacts
- Working tree: clean except runtime state (`.rare/`, `knowledge/`), which is
  intentionally not committed.

---

## 3. Vercel

### "Cannot GET" — actual cause

Not a rewrite problem and not a stale build. `vercel.json` has **no rewrites**;
`server.ts` is the single serverless function. The SPA is served from `public/`,
which is **gitignored** and produced by `npm run build:web`
(`vite build && node scripts/sync_vercel_static.mjs`).

Express's bare `Cannot GET /` appears when the function boots but
`public/index.html` is absent — i.e. the static layer was never registered, or
the API half threw during init before the SPA catch-all was attached. The
codebase already documents this at `server.ts:5030` and `:5108`, and registers
the static/SPA layer at module scope on Vercel so a failed API boot cannot take
the frontend down with it.

An older deployment (`rareproject-64t0xwq0p`) was observed returning 503 on
`/api/health` with `self-signed certificate in certificate chain` — the exact
TLS defect fixed in `91eff0f`. That deployment predates the fix.

### Preview deployment (verified)

`https://rareproject-pf2ywtv6h-mypremierai-2827.vercel.app`

| Check | Result |
|---|---|
| `GET /` | **200**, `Cannot GET` occurrences: **0** |
| `GET /api/health` | **200** |
| `GET /api/status` → storage | `{"status":"operational","type":"postgresql","databaseConfigured":true,"databaseReachable":true,"schemaReady":true}` |
| `POST /api/user/signup` | 200 |
| `POST /api/documents` (arXiv PDF URL) | **201**, `pdfjs-text`, **40,083 chars**, **15 pages** |
| `POST /api/research/search` | **200**, `status: completed`, **6 sources** |

**Production was not promoted.** Promotion is the user's action.

### Vercel env note

`RARE_ALLOWED_ORIGINS` is enforced (CSRF/origin allowlist). The per-deploy hash
hostname is not in the allowlist, so authenticated calls from that host are
rejected — correct security behaviour. Verification used an allowlisted origin
(`https://rareproject.vercel.app`) as the `Origin` header. The branch alias
currently points at an older deployment; the preview URL above is the current
build.

---

## 4. Remaining gaps

### Transcription

- **Honest 503 path verified.** With no `GEMINI_API_KEY`, a real user gets
  `503 TRANSCRIPTION_PROVIDER_UNAVAILABLE` with a next step — never a
  fabricated transcript. Guests are blocked entirely (correct).
- **Real defect found and fixed.** Production transcription returned
  `404 models/gemini-2.5-flash is no longer available to new users`. The model
  id was hardcoded in three places. Now `GEMINI_MODEL` / `GEMINI_MODEL_LITE`
  (defaults `gemini-3.8-flash` / `gemini-3.8-flash-lite`, matching the rest of
  the codebase) with fallback to the lite model on failure.
- **Not live-verified end-to-end.** The production `GEMINI_API_KEY` is marked
  sensitive in Vercel and `vercel env pull` returns the literal `[SENSITIVE]`,
  so the key could not be used locally or on a preview. The fix is deployed to
  the branch but the successful transcription call itself is **unverified**.
  Google's own 404 message names `models/gemini-3.8-flash` as the replacement,
  which is what the default now uses.

### OCR on Vercel

`pdftoppm` / `tesseract` are not present in the default serverless image. The
OCR extractors report "not available in this runtime" and the chain falls back
to `pdfjs-text`; a text-free PDF therefore returns `NO_TEXT_EXTRACTED` with a
clear reason rather than invented content. **PDF text extraction itself now
works on Vercel** after `2b116cc` (see below).

### PDF on Vercel — fixed

Before `2b116cc`, PDF import on Vercel failed with
`Cannot find package 'pdfjs-dist'` and fell through to poppler (also absent).
The extractor loads pdfjs via a deep dynamic import
(`pdfjs-dist/legacy/build/pdf.mjs`) that Vercel's dependency tracer does not
follow. Adding `node_modules/pdfjs-dist/**` to `includeFiles` restored it:
the arXiv attention paper imports as 40,083 chars / 15 pages and is searchable.

---

## 5. Acceptance matrix — commands and outcomes

### Build & test

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **clean** |
| `npm test` | **all suites pass** (12 tool primitives, auth, durable state, providers, engine bridge, memory, self-development, benchmark 6/6, SPA-boot 9/9, content engine) |
| `npm run build:server` | **pass** (`server-build/server.js`, 669.4 kb) |
| `npm run build:web` | **pass** with `NODE_OPTIONS=--max-old-space-size=1400` |

`build:web` was initially killed (exit 137). Cause: the sandbox cgroup limit is
**2 GB** (`/sys/fs/cgroup/memory.max` = 2147483648) and 1.69 GB was already in
use. Not a code defect — it passes once memory is freed and the heap is capped.

### Security — SSRF (all blocked, HTTP 422)

```
http://169.254.169.254/latest/meta-data/  → 422
http://127.0.0.1:22/                      → 422
file:///etc/passwd                        → 422
http://[::1]/                             → 422
http://10.0.0.1/                          → 422
gopher://x/                               → 422
```

### Formats (all HTTP 201, real extraction)

| File | Method | Chars |
|---|---|---|
| `.docx` | `docx-mammoth` | 36 |
| `.csv` | `csv-parse` | 65 |
| `.json` | `json-parse` | 58 |
| `.html` | `html-dom` | 36 |
| `.srt` | `subtitle-cues` | 54 |
| `.zip` | `zip-listing` | 47 |
| `.xlsx` | `spreadsheet-sheetjs` | 75 |
| `.pptx` | `pptx-slide-xml` | 104 |
| `.epub` | `epub-spine` | 75 |
| `.yaml` | `yaml-parse` | 71 |
| `.eml` | `eml-rfc822` | 77 |
| `.ts` | `html-dom` | 1,623 |

### Links

| Case | Result |
|---|---|
| Ordinary article (`example.com`) | 201, `html-dom`, 171 chars, `finalUrl` normalized |
| Redirect chain (`httpbin.org/redirect/2`) | 201, followed to `/get`, `json-parse` |
| Direct PDF (arXiv) | 201, `pdfjs-text`, 40,083 chars, 15 pages |
| Multi-link import (3 URLs, 1 duplicate) | 200, **2 items**, dedupe applied |
| Inaccessible / malformed | 422 with `nextStep` |

### Research

`POST /api/research/search` → 200, `status: completed`, **12 sources** across
**7 providers** (wikipedia, crossref, openalex, arxiv, github, openlibrary,
duckduckgo), scope string reports "12 source(s) read in full". Sources carry
real titles and URLs (e.g. `arxiv.org/abs/2007.14062`).

### Unified search

`GET /api/search?q="scaled dot-product attention"` → **20 hits** across
**17 indexed documents**, with the exact phrase located deep inside the
imported PDF (`imports/1706-…md`).

---

## 6. Still blocked / requires the user

1. **Supabase REST verification** — needs an anon or service-role key. Direct
   PostgreSQL persistence is fully verified; the REST path is not.
2. **End-to-end transcription** — needs a usable `GEMINI_API_KEY` (the Vercel
   one is sensitive and unreadable). The model-id fix is deployed but the
   successful call is unverified.
3. **Production promotion** — deliberately not done; requires explicit approval.
4. **Branch alias** — points at an older deployment; re-aliasing is a
   dashboard/CLI action the user may want to control.

## 7. Security reminder

The Supabase database password, GitHub token and Vercel token were shared in
chat. **Rotate all three.** They are not written to any committed file; `.env`
is gitignored and was never staged.

---

# 8. UI audit and completion (2026-10-28, later run)

The user asked a direct question: is the UI genuinely built, or only the backend
routes? This section is the evidence-based answer. Every claim below was
re-checked by reading the source and running the app — the earlier summary was
not taken as proof.

## 8.1 What the audit found

**Both workspaces are real components, not stubs.**

| Item | Evidence |
|---|---|
| Navigation entries | `src/App.tsx:765-767` — `documents` and `research` in `workspaceNavItems` |
| Rendered | `src/App.tsx:1374-1375` — `<DocumentsWorkspaceView>` / `<ResearchWorkspaceView>` |
| Documents component | `src/components/DocumentsWorkspaceView.tsx` (~950 lines) |
| Research component | `src/components/ResearchWorkspaceView.tsx` (~470 lines) |

**Dead code found (left in place, harmless):** `CleanDocumentsWorkspaceView`
(`App.tsx:2087`) and `CleanResearchWorkspaceView` (`App.tsx:2286`) are defined
but never rendered. They are the old inline placeholders. Removing them is a
pure cleanup with no behavioural effect; it was not done because it is
unrelated to the mission and would enlarge the diff.

**Real gaps found in the Documents UI** — the backend had the routes, the UI
never called them:

| Capability | Before | After |
|---|---|---|
| Rename | route existed, no UI | inline rename in the toolbar |
| Delete | route existed, no UI | delete with an explicit confirm step |
| Version history | `history[]` returned by the API, never shown | panel listing revisions + restore |
| Search | client-side filename filter only | `/api/search` indexed passage search |
| Capabilities | hardcoded format list | probes each extractor at runtime |

**Research UI was already complete** — query input, depth selector, seed URLs,
history sidebar, synthesis, scope/stats, limitations, unreadable sources,
findings, per-source cards with links, connector failures, save-to-Documents.
No work was needed there.

## 8.2 What was built

- `DocumentsService.restoreVersion()` + `POST /api/documents/restore-version`.
  Restoring pushes the current text onto the history stack, so a restore is
  itself undoable — nothing is destroyed.
- `probeExtractors()` in `Extractors.ts`; `/api/documents/capabilities` now
  reports `available:false` with a reason per adapter instead of advertising a
  static wish-list. This directly addresses the mission rule "do not claim
  support merely because a file can be uploaded".
- Documents UI: rename, delete (confirmed), version history with restore,
  server-side search with snippets and page numbers, OCR badge, version counter.
- **Bug fixed:** `openDocument` used `encodeURI`, which leaves `#` and `?`
  unescaped and would truncate such document paths. Now `encodeURIComponent`.

## 8.3 Verification (commands actually run)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run lint` | clean, exit 0 |
| Server build | `npm run build:server` | 672.1 kb, exit 0 |
| Web build | `NODE_OPTIONS=--max-old-space-size=1536 npm run build:web` | 1672 modules, exit 0 |
| Test suite | `npm test` | ALL AUTOMATED VERIFICATION TESTS PASSED |
| Bundle contains new UI | grep `dist/assets/index-CnwHujIf.js` | `Search inside documents`, `Earlier revisions`, `restore-version` all present |

**Local, against real PostgreSQL:**

| Flow | Result |
|---|---|
| Capabilities probe | 22/22 adapters available; transcription honestly `available:false` |
| Create → v1 | 201 |
| Update → v2 | 201, history retains v1 |
| Restore v1 | 200, becomes v3, content is v1's text |
| Search `lazy dog` | 1 hit, `matchedBy: both`, correct snippet |
| Rename | 200 |
| Delete | 200, subsequent read 404 |
| Cross-user read | 404 |
| Cross-user search | 0 hits, 0 indexed |
| SPA routes `/`, `/documents`, `/research`, `/a/deep/route` | all 200 |

**Deployed preview** — `https://rareproject-git-new-fixes-by-erudite-mypremierai-2827.vercel.app`
(the branch alias; the per-deployment URL is rejected by `RARE_ALLOWED_ORIGINS`,
see 8.4):

| Flow | Result |
|---|---|
| `/`, `/documents`, `/research` | 200, zero "Cannot GET" |
| `/api/health` | 200 |
| `/api/status` | `postgresql`, `databaseReachable:true`, `schemaReady:true` |
| Capabilities | `runtime: vercel-serverless`, **20/22** — `pdf-ocr` and `image-tesseract` correctly report missing |
| Create → v1 → v2 → restore v1 | 201 / 201 / 200 (v3, v1 content) |
| Search | 1 hit, correct snippet |
| Cross-user read / search | 404 / 0 hits |
| Research | 200, **6 sources**, providers `wikipedia, crossref, openalex, arxiv, github, openlibrary`, 6 full texts, 5 limitations, 4 unreadable reported |

## 8.4 Findings worth recording

1. **`RARE_ALLOWED_ORIGINS` does not include per-deployment preview URLs.** It
   lists the branch alias and the production domains. A fresh
   `vercel deploy` URL therefore returns `403 This origin is not allowed` on
   every mutating request. This is correct security behaviour, not a bug — but
   it means preview verification must target the branch alias, and any new
   preview URL needs adding to the allowlist before it can be used.
2. **Research requires a real account.** Guests get
   `403 Create an account to use this operation.` by design. Verification used
   a throwaway signup.
3. **`/api/research/search` returns `{ query, results: [...] }`**, not a bare
   item. The UI reads `results` correctly.
4. **Duplicate servers on one port** produced spurious `000` responses during
   verification. Not a code defect; resolved by killing all instances before
   restarting.

## 8.5 Honest limitations of this verification

- **No interactive click-through.** There is no browser-automation tool in this
  environment. UI verification is: the components are wired in `App.tsx`, the
  built bundle contains the new strings, the SPA routes serve 200, and every
  API the UI calls was exercised live. What is *not* proven is a human-style
  click sequence in a real browser.
- **OCR does not run on Vercel** (no poppler/tesseract). It works locally
  (22/22) and the deployment now says so instead of failing silently.
- **Transcription is still unverified end to end** — no usable
  `GEMINI_API_KEY` in this environment. The 503 path is correct and honest.
- **Supabase REST** still needs an anon/service-role key.

## 8.6 Git and deployment state

- Branch `New-Fixes-by-Erudite`, commit **`785012e`**, pushed and confirmed:
  `git ls-remote` returns `785012ee5bb6fe7761056884514c41b841076056`, identical
  to local `HEAD`.
- Preview deployed from that commit. **Production untouched.**
- The earlier claim that a push had landed was wrong at the time it was made;
  the remote was at `8766a79` while local had 9 unpushed commits. That is now
  genuinely pushed and verified by SHA.

## 8.7 Security reminder

The Supabase password, GitHub token and Vercel token were shared in chat.
**Rotate all three.** None appear in any committed file; `.env` is gitignored
and was never staged. Tokens were passed to git/vercel inline and their output
was redacted with `sed` before display.
