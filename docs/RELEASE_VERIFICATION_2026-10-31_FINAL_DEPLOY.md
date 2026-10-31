# RARE — Final Release Verification Report

**Date:** 2026-10-31
**Repository:** `Rare-Erudite/COMPLETED`
**Working branch:** `New-Fixes-by-Erudite`
**Production domain:** https://rareproject.vercel.app
**Vercel project:** `rareproject` (`prj_362nUbmvvjkLYEuGKTuV8agADQzF`), team `mypremierai-2827` (`team_6EF6Dxce6xr00Gc64dDPMHA0`)

Status labels used: **VERIFIED** (directly tested and passed) · **IMPLEMENTED — NOT VERIFIED** · **BLOCKED** · **FAILED** · **NOT IMPLEMENTED**.
No credentials or secrets appear in this report.

---

## A. Repository and Git

| Item | Value |
|---|---|
| Starting commit (remote HEAD at run start) | `5ac037c` |
| Local HEAD at run start | `db16661` (5 commits ahead of origin) |
| Final release commit (pushed + deployed) | **`4d74eeb463dc3c9a20b3cc6a51c8c1be78648e3a`** |
| Working branch | `New-Fixes-by-Erudite` |
| `main` protected during development | **Yes** — never merged, never switched to, no force-push, no reset |
| `Rare-Erudite/RARE-INTELLIGENCE-MODEL` | Untouched |

**Commits created this run (all on `New-Fixes-by-Erudite`):**

| SHA | Subject | Pushed |
|---|---|---|
| `d12ec8f` | fix(build): run each stack's own build/test stage and report non-zero exits as failures | ✅ |
| `d98b9c6` | fix(android): make the APK build reproducible, signed with a stable key, pointed at the real backend | ✅ |
| `8d4d1cc` | fix(updates): make the release/update system able to report a real update | ✅ |
| `4d74eeb` | fix(server): stop large uploads failing with EPIPE on a pooled connection | ✅ |
| `db16661` | ci: add the missing verification and Android build workflows | ❌ **BLOCKED** |

**`db16661` — BLOCKED (environment limitation).** The provided GitHub token lacks the `workflow` scope, so GitHub rejects any push that creates/updates `.github/workflows/ci.yml`:
`refusing to allow a Personal Access Token to create or update workflow .github/workflows/ci.yml without workflow scope`.
The commit is preserved locally and tagged **`ci-workflow-pending`**; the workflow file is also saved outside the repo. The branch was moved to `4d74eeb` (the deployable application commit) so the release is not blocked by a CI-only file. **No retry with a different token scope was attempted.**

**Files changed `5ac037c..4d74eeb` (14 files, +664 / −62):** `.gitignore`, `docs/ANDROID_BUILD.md`, `exports/rare-v1.0.0-release.apk`, `knowledge/updates.json`, `public/rare-v1.0.0-release.apk`, `scripts/build_apk.sh`, `server.ts`, `src/server/builder/ProjectScaffolder.ts`, `src/server/storage/UpdateStore.ts`, `src/server/tools/ToolExecutor.ts`, `tests/run_all_tests.ts`, `tests/test_keepalive.ts`, `tests/test_project_build.ts`, `tests/test_update_store.ts`.

---

## B. Application completion — per area

### Chat — VERIFIED (production)
- **Existed:** real provider responses, streaming, persistence, research-intent routing.
- **Tested (production):** conversation create **HTTP 201**; `/stream` **HTTP 200**, `content-type: text/event-stream`, 2 SSE events; conversation read-back **HTTP 200 with 3 persisted messages**.
- **Status: VERIFIED.** (Note: the deployed environment has no online model-provider key, so the *answer text* path is exercised by the provider registry's honest fallback; the streaming/persistence/routing mechanics are verified. See §F.)

### Documents — VERIFIED (production)
- **Existed:** ingestion/extraction, PDF/Office, grounded Q&A, export, owner-scoped storage.
- **Tested (production):** upload **HTTP 201** (`ok:true`, `chars:113`, `method:text-utf8`); grounded Q&A **HTTP 200** — answer *"The internal project codename is ORION-7 [1]. The lead engineer is Adaora Okonkwo [1]."* (grounded + cited); **real DOCX export HTTP 200**, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, 2527 bytes, magic `504b0304`; **real PDF export HTTP 200**, `application/pdf`, 1121 bytes, magic `25504446`.
- **Status: VERIFIED.**

### Research — VERIFIED (production)
- **Existed:** dedicated workspace, providers, full-text retrieval, evidence reports, history, owner scoping.
- **Tested (production):** `/api/research/providers` **HTTP 200, 7 providers**; `/api/research/search` **HTTP 200** — **6 sources read in full**, `status: completed`, `providersUsed: [wikipedia, crossref, openalex, arxiv, github, openlibrary]`; report renders **Scope and method**; **honest disclosure** of `providerErrors: ["Unexpected end of JSON input"]` and `limitations: ["4 discovered source(s) could not be read…", "1 discovery provider(s) failed…"]`; history **HTTP 200, 1 item**.
- **Status: VERIFIED.**

### Transcription — VERIFIED (production)
- **Existed:** LocalWhisperProvider, timestamps, segmentation, bundled FFmpeg/FFprobe.
- **Tested (production):** capabilities **HTTP 200** `{available:true, provider:"gemini"}`; short real-speech fixture (20.8 s, **not** the 364 s recording) → **HTTP 200 in 145.7 s**, `model: gemini-flash-latest`, **1 turn**, `coverage: 1`, `durationSeconds: 20.844`, real transcript text with `startClock/endClock` timestamps.
- **Status: VERIFIED.** Speaker diarisation: **NOT IMPLEMENTED** (not claimed).

### Project & Build — IMPLEMENTED — NOT VERIFIED (in production)
- **Existed:** scaffolder + `SCAFFOLD_PROJECT` / `RUN_PROJECT_STAGE`.
- **Changed:** stack-aware build/test runner (Node/Python/static), non-zero exit now reported as failure.
- **Tested (local):** `python-cli`, `node-api`, `node-cli` scaffolds build and test with exit 0; a deliberately failing Python test returns `success:false, exitCode:1`. Regression tests `test_project_build.ts` pass.
- **Status: IMPLEMENTED — NOT VERIFIED** against the deployed instance (verified locally + regression-tested only).

### Protected self-development — PARTIALLY VERIFIED
- **Tested (production):** developer-only `/api/tools/execute` as an ordinary user → **HTTP 403** (server-enforced, not UI-hidden).
- **Not exercised:** the full edit → test → checkpoint → rollback loop.
- **Status: PARTIALLY VERIFIED** (access denial VERIFIED; workflow IMPLEMENTED — NOT VERIFIED).

### Assistant — IMPLEMENTED — NOT VERIFIED
- Voice endpoints exist (`/api/voice/chat`, `/api/voice/transcribe`, `/api/voice/tts`) and fail honestly when no provider is configured. Wake-word, background listening and native device bridges were **not** testable (no Android/Windows device).
- **Status: IMPLEMENTED — NOT VERIFIED.**

### Other surfaces — VERIFIED (production)
- **Scheduled tasks:** create **201**, toggle **200**, delete **200**.
- **Owner isolation:** user B reading user A's conversation → **404**; B's schedules → **0**.
- **Navigation/deep links:** `/`, `/chat`, `/documents`, `/research`, `/a/deep/spa/route` all **HTTP 200** serving the SPA shell.

---

## C. Project & Build (detail)

- **Toolchains:** Node.js/npm, TypeScript, Python, static-site tooling exercised. Detection + per-stack command selection implemented in `ProjectScaffolder` + `ToolExecutor`.
- **Lifecycle:** requirements → spec → scaffold → real source files → dependency install → build → test → artifact, with real exit codes.
- **Demonstrated builds (local):** `python-cli`, `node-api`, `node-cli` — build + test exit 0.
- **Checkpoints/rollback:** `.rare/checkpoints/` present and preserved (not deleted).
- **Status: IMPLEMENTED — NOT VERIFIED** in production.

---

## D. Protected self-development (detail)

- **Access:** server-enforced. Ordinary user → **403** on `/api/tools/execute` (VERIFIED in production).
- **Integrations:** GitHub/Vercel/Supabase developer integrations exist in source; end-to-end developer workflow not exercised.
- **Status: PARTIALLY VERIFIED.**

---

## E. Assistant (detail)

- Voice endpoints present; honest failure when unconfigured. Wake word "Rae" configurable in source.
- **Device behaviour: BLOCKED** — no physical Android/Windows device available.
- **Status: IMPLEMENTED — NOT VERIFIED.**

---

## F. Android

| Item | Value |
|---|---|
| Project location | `scripts/build_apk.sh` + `docs/ANDROID_BUILD.md` (build infrastructure) |
| Package ID | `com.rare.ai.intelligence` |
| Version | versionName `1.0.0`, versionCode `1` |
| SDK | minSdk 21 / targetSdk 34 |
| Signing | v1+v2+v3 (keystore from `RARE_ANDROID_KEYSTORE`) |
| APK size | 247,387 bytes |
| SHA-256 | `322edd949c420ab2c4bb4fefa86d330eb41054870d92737ebeee0ea871c67ba6` |
| Backend URL | `https://rareproject.vercel.app` (present in `assets/www/index.html`) |

- **Endpoints (production):** `/api/download/apk/info` **HTTP 200** `{ok:true,size:247387,filename:"RARE-v1.0.0-release.apk"}`; `/api/download/apk` **HTTP 200**, 247,387 bytes, magic `504b` (genuine APK), sha256 matches the built artifact; `/api/updates/check?currentVersion=1.0.0` **HTTP 200** `{hasUpdate:false, latestVersion:"1.0.0"}`.
- **Update compatibility: BLOCKED.** The available keystore's certificate (`ED:86:18:79…`) does **not** match the previously shipped APK (`8C:8A:D9:F0…`). The original signing key is not in the repository, so this build **cannot update an existing install**. The original keystore is required from the owner.
- **Device installation: NOT PERFORMED** (no device available).
- **Status: build infrastructure VERIFIED (reproducible, correctly configured); update compatibility BLOCKED; device install NOT PERFORMED.**

---

## G. Transcription (detail)

- **FFmpeg/FFprobe solution:** bundled binaries repaired in place, else copied to a writable temp dir at 0755 (read-only `/var/task` + 0644 binary). Production logs show `ffprobe=/tmp/rare-media-bin/…`; capability probe reports `media.decoding: true`.
- **Genuine audio test (production):** 20.8 s real speech → **HTTP 200 in 145.7 s**, real transcript, 1 turn, coverage 1.0.
- **Persistence/ownership:** transcript saved; owner isolation enforced (B cannot read A's resources → 404).
- **Status: VERIFIED.**

---

## H. Security and database

- **Database:** PostgreSQL **17.11**; **16** public tables; **RLS enabled 16/16**; migrations present. No schema altered; no destructive migration run.
- **Auth (production):** signup **200**; session continuity `/api/user/me` **200**; logout **200** clearing the cookie; after logout **401**.
- **CSRF / origin:** bad Origin **403**; missing CSRF **403**; no session **401**.
- **Developer-only:** `/api/tools/execute` as ordinary user **403**.
- **Owner isolation:** cross-owner conversation **404**; cross-owner schedules **0**.
- **PostgREST caveat:** the application uses a direct `pg` Pool only and never PostgREST — **not a release blocker**.
- **Status: VERIFIED.**

---

## I. CI and release tests

| Command | Exit code | Result |
|---|---|---|
| `npm ci` | **0** | PASS |
| `npm run lint` (`tsc --noEmit`) | **0** | PASS |
| `npm run build` | **0** | PASS (server-build 828.7 kb) |
| `npm test` | **0** | **91 assertions, 0 failed** (Documents 43, Research 31, serverless-frontend 9/9, Project & Build, keep-alive 3/3) |

- **Environment limitation:** the sandbox is capped at 2 GB; the full suite now completes because the keep-alive/EPIPE defect (not memory) was the real cause of the earlier long-audio failure. No test was modified, skipped or weakened.
- **CI workflow:** `.github/workflows/ci.yml` added but **BLOCKED** from push (token scope) and therefore **never executed on GitHub** — IMPLEMENTED — NOT VERIFIED.

---

## J. Deployment

| Item | Value |
|---|---|
| Release commit | **`4d74eeb463dc3c9a20b3cc6a51c8c1be78648e3a`** |
| Vercel deployment ID | **`dpl_CjphVCtrAA8E1TM475Tju9AWpvEE`** |
| Deployment URL | `rareproject-pcp55ljhe-mypremierai-2827.vercel.app` |
| Target | `production` |
| State | **READY** |
| Production alias | **https://rareproject.vercel.app** |
| Previous production | `dpl_8PMUHFE9RwY7pF5pUR549vab2cN2` (SHA `5ac037c`) — superseded |

**Production smoke test (all against `https://rareproject.vercel.app`, release `4d74eeb`):**

| Check | Result |
|---|---|
| `/`, `/chat`, `/documents`, `/research`, deep link | **200** (SPA shell) |
| `/api/status` ×3 | **200 / 200 / 200** — `healthy`, `storage: postgresql`, `dbReachable: true`, `schemaReady: true` |
| Auth signup / session / logout / post-logout | **200 / 200 / 200 / 401** |
| CSRF / bad Origin / no session / dev-only | **403 / 403 / 401 / 403** |
| Chat create + stream + persistence | **201 / 200 (SSE) / 3 messages** |
| Documents upload + grounded Q&A | **201 / 200 (grounded + cited)** |
| Documents DOCX / PDF export | **200 (real DOCX) / 200 (real PDF)** |
| Research providers / search / history | **200 (7) / 200 (6 sources) / 200 (1 item)** |
| Transcription (20.8 s real speech) | **200 in 145.7 s, real transcript** |
| Owner isolation (conversation / document / schedules) | **404 / 400 / 0** |
| Scheduled tasks create / toggle / delete | **201 / 200 / 200** |
| APK info / download / update check | **200 / 200 (247,387 B, sha256 match) / 200** |
| Keep-alive: 3 MB upload + follow-up status | **201 in 3.3 s / 200** |

**Database health after deploy:** healthy, PostgreSQL, schema ready.
**Keep-alive/EPIPE fix in production:** **VERIFIED** — repeated status probes consistent, 3 MB upload succeeds with no connection reset.

---

## Outstanding items (explicit)

1. **`db16661` (CI workflow) not pushed — BLOCKED.** GitHub token lacks `workflow` scope. Preserved at tag `ci-workflow-pending`. Requires a token with `workflow` scope.
2. **Chat end-to-end answer text — BLOCKED.** No online model-provider key in the deployed environment; only the honest-failure path is exercised. Requires a provider key.
3. **APK update compatibility — BLOCKED.** Original Android signing keystore unavailable; the current build cannot update an existing install.
4. **Assistant device behaviour — BLOCKED.** No physical Android/Windows device.
5. **Project & Build / self-development full workflow — IMPLEMENTED — NOT VERIFIED** in production.
6. **Speaker diarisation — NOT IMPLEMENTED** (not claimed).

---

*Report generated 2026-10-31. All statuses are evidence-backed; no secrets are included.*
