# RARE Recovery Ledger

## Production repair pass — 2026-10-26

### Verified checkout and source history

- Repository: `C:\Users\Erudite\Documents\GitHub\COMPLETED`, remote `https://github.com/Rare-Erudite/COMPLETED.git`.
- Starting commit: `592cf688f37e8c1a7e8fc599d0f5944baa877b28` on `New-Fixes-by-Erudite`; the working tree was clean.
- Local branch comparison: development is 99 commits ahead of `main`; `main` is 2 commits ahead. The missing commits are `97e41e03a335649df8c1edcacc997e820485f2cc` and `7e13f23920f3b203b7a84a2b586819495c4cef89`. The first contains the chat/prompt/history changes; development has since substantially diverged, so neither commit was merged wholesale.
- `main` has not been changed, merged, or rewritten. Changes from this pass are uncommitted because this workspace exposes `.git` as read-only; `git add` failed with `Unable to create .git/index.lock: Permission denied`.
- The previous ledger entries below describe an earlier checkout and are historical; their SHA and dirty-tree claims do not describe this clean starting checkout.

### Changes made in this pass

- Release storage no longer seeds fabricated public/developer releases. Old records lacking artifact metadata are excluded from update listings.
- Publishing now requires a supported platform, a HTTPS GitHub Releases URL for `Rare-Erudite/COMPLETED`, a positive measured byte size, and a SHA-256 checksum. Display size is derived from the byte count; no fixed APK size or `/api/download/apk` placeholder is generated.
- The Developer Space form now collects those artifact fields and defaults to the developer channel; the API requires an explicit channel before publication. Public releases still require a developer session and explicit `public` selection.
- Update downloads now use actual response bytes, compare the byte count and SHA-256, and report only “Download verified.” The UI makes clear that installation/activation is a separate step.
- `/api/updates/apply` now returns HTTP 501 and does not write an “installed” audit event because the web server cannot confirm platform installation.
- The diagnostics panel no longer displays a hardcoded test pass count; it explains that the app does not have a live test result.

### Verification and external limitations

- The previous run reported `pnpm run lint` passing, but a fresh `pnpm run lint` attempt on this continuation produced no result after about one minute and was stopped. Do not count this continuation's type check as passing.
- `git diff --check` passed. The working tree still contains only the five repair files listed above; the temporary build-script experiment was reverted.
- The checkout has `node_modules` and a usable pnpm runtime, so the earlier “dependencies absent” diagnosis was stale. The lockfile is npm v3 `package-lock.json`; no `pnpm-lock.yaml` exists. `pnpm run build:web` stalled without output; direct Vite build printed plugin timing but did not finish. The server bundle failed because esbuild could not read `../../..` (`Access is denied`) and then could not resolve the entry point. No fresh production build is claimed.
- Normal `tsx` startup fails before running tests because Node 24.22.1 `os.userInfo()` raises `uv_os_get_passwd returned ENOMEM`. With a temporary runner-only preload in the OS temp folder, the focused provider test passed. The complete test runner then passed backend URL/health and standalone conversation/research groups but failed at authentication integration because `127.0.0.1:3000` was not listening. A separate runner completed all ten non-auth groups successfully: backend configuration, standalone research, durable workflows/document safety, OAuth validation, model providers, RARE bridge, tools, memory, development, and evaluation. Auth integration remains unrun. An isolated local server startup with local JSON fallback did not reach listening/readiness within a bounded minute and was stopped. No full-suite pass is claimed.
- `git diff --check` passed. Git status confirms this branch remains `New-Fixes-by-Erudite` at `592cf688f37e8c1a7e8fc599d0f5944baa877b28`; only the five repair files are modified. The stale zero-byte index lock disappeared and no Git process remained, but the sandbox marks `.git` read-only, so changes remain uncommitted. `main` was not changed.
- The non-auth tests generated three checkpoint snapshots and test-only memory/trajectory records in the checkout. I verified these files were clean before the run, removed only those three generated snapshots, and restored the checkpoint registry, memories, and trajectories to their exact pre-test contents. Final status no longer includes those test side effects.
- GitHub access remains unavailable: a fresh `git ls-remote` failed to connect to `github.com:443`. No Vercel CLI is installed. No push, Vercel configuration inspection, preview deployment, live route check, database migration, or live provider inference was performed.
- No canonical Android/Flutter/Gradle/Capacitor source project exists in the checkout. Two identical APKs are present at `exports/rare-v1.0.0-release.apk` and `public/rare-v1.0.0-release.apk`, each 308,827 bytes with SHA-256 `9d5eb21e27c7d2a8556bb58cf6d1b20fceb6469757b4e5a1d7394201c51b2c38`. Their manifest says package `com.rare.ai.intelligence`, version code 1 / version `1.0.0`, min SDK 21, target SDK 34. They were last modified 2026-10-23 and are not a build from the current source; signature files are present but signing identity and device installation were not verified.
- The repair changes remain uncommitted on `New-Fixes-by-Erudite` and have not been pushed. No changes were made to `main`.

### Remaining work

- Resolve sandbox process/user lookup and esbuild filesystem access so type-check, production builds, and the full test suite can finish; run authentication tests only after the isolated server reaches readiness.
- Confirm Vercel environment variable names and values in the owner-authorized dashboard; verify Preview deploy, runtime logs, routes, and database readiness.
- Apply and verify PostgreSQL migrations only after an authorized connection and backup procedure are available.
- Run live Gemini, email/OTP, Google OAuth, Microsoft OAuth, and session/security checks after confirming their provider configuration without exposing secrets.
- Connect GitHub Releases artifact publication and upload a real package before enabling release publication. The modal currently verifies a supplied package download but does not install an APK or Windows package.
- Locate the canonical Android project, confirm its package/signing identity, configure its public backend, build and verify a new APK, and test on an emulator/device. The two existing v1.0.0 APKs are old artifacts and were not rebuilt.
- Verify a real GitHub Release URL and checksum against the actual artifact before enabling release publication in a deployed environment. The local code validates metadata shape and trusted repository path, but no artifact existence or upload was verified here.

## Checkout baseline

- Local repository: `C:\Users\Erudite\Documents\GitHub\COMPLETED`
- Development branch: `New-Fixes-by-Erudite`
- Starting commit: `cd362ee26fa43d69c66f3e6d7dc1658690d3dd14`
- Starting remote: `origin` at `https://github.com/Rare-Erudite/COMPLETED.git`
- Starting working tree: existing modifications in `.env.example`, `database/schema.sql`, `server.ts`, `src/server/storage/PersistentJsonStore.ts`, and `tests/test_authentication_security.ts`, plus untracked `database/migrations/`. All were present before this recovery turn and have been preserved.
- Starting `git diff --check`: passed. No commits, pushes, branch changes, merges, or deployments have been performed in this recovery turn.
- Current checkout after recovery edits: still `New-Fixes-by-Erudite` at `cd362ee26fa43d69c66f3e6d7dc1658690d3dd14`; pre-existing edits were retained. `git diff --check` passed again after the current edits. No commits, pushes, branch changes, merges, or deployments have been performed in this recovery turn.
- Branch relation at start: development had 87 commits not on `main`; `main` had two commits not on development (`97e41e0` and merge `7e13f23`). The current branch remains unchanged while this work is prepared.

## Workstream status

| Workstream | Concrete changes | Verification |
| --- | --- | --- |
| Sessions and CSRF | In progress: cookie-backed browser sessions; server-issued session cookie is HttpOnly, Secure in production; separate CSRF token; exact-origin validation; credentials-enabled CORS; auth responses no longer include session secrets; client does not store browser session tokens in localStorage. | Auth integration stops because the isolated server did not reach listening; static type check did not finish in this continuation. No live authentication claim. |
| User ownership | In progress: owner-keyed PostgreSQL state covers memories, documents, conversations, settings, schedules, plugins, image galleries, and research. Project reads and writes now use owner-scoped relational queries and forced RLS; project reports are saved in the owner’s document collection. Guest sessions have explicit resource limits and account-required expensive actions. | Added isolated storage and cross-user cases remain unverified in this pass; no database-backed or live ownership claim. |
| PostgreSQL and RLS | In progress: added ordered repeatable `20261023_core_schema.sql` and `20261024_rare_user_state.sql` migrations; ownership columns, foreign keys, indexes, forced RLS, OAuth identities, per-account developer credentials, grants, and private state. Migration runner uses advisory locking and immutable checksums. | Migration application, persistence restart, and RLS behavior are not run: no reachable configured test database. No live Supabase verification. |
| OAuth identity | In progress: identity association is provider plus stable subject; email linking is permitted only when provider verification says the email is verified; accounts without verified email are supported; unique constraints protect database races. Microsoft subject includes tenant issuer scope. | Local OAuth validation group passed with the temporary runner shim. No live provider callback or production credential test. |
| Developer access | In progress: credentials are stored hashed per developer account; grants are bound to server sessions; the authenticated persisted role is checked; account-scoped passkey attempt throttling and grant revocation on credential change are implemented. | Added ordinary-user denial assertions. Not runtime-tested; DB migration and external secret configuration are unverified. |
| Document import | In progress: HTTPS-only import checks public DNS, rejects private/special-use addresses, pins the validated address for TLS requests, limits redirects/time/bytes, and validates response types. | Durable workflow and document safety test group passed with the temporary runner shim. |
| Vercel | Adapter/configuration implemented: `server.ts` exports the Express app, performs one-time initialization, and skips creating a listener under Vercel; root `vercel.json` runs the project build and points static output at `dist`. | Configuration has not been exercised by Vercel CLI/build. Production environment variables, function packaging, platform routing, and live behavior remain unverified. |
| Chat, production deployment | Compared the main-only chat commits with the current development branch. Current development already contains the newer prompt/context and real-provider failover path; the older commit also removes durable session checks and restrictive CORS, so it was not applied. | Focused mocked/provider fallback test passed with the temporary TSX startup shim. Live model inference, production routes, and deployment remain unverified. |

## Toolchain diagnosis

- `package.json` scripts are `build`, `lint` (`tsc --noEmit`), and `test` (`tsx tests/run_all_tests.ts`). The repository has npm v3 `package-lock.json`; there is no `pnpm-lock.yaml`, `.npmrc`, or package workspace file.
- Runtime observed: Node `v24.22.1`, pnpm `11.25.0`; `node_modules` contains the locked TypeScript `7.0.2`, tsx `4.23.15`, Vite `8.3.4`, esbuild `0.28.2`, and server dependencies. `npm` was unavailable in the prior pass.
- The normal tsx launcher calls `os.userInfo()` and fails in this sandbox with `uv_os_get_passwd returned ENOMEM` before executing tests. A temporary preload in the OS temp directory supplies a runner-only username; with it, the focused provider test passes. Do not add that shim to the application or test sources.
- The complete suite with the shim passes the first two groups and then fails because its auth integration expects a service at `127.0.0.1:3000`. A separate runner completed the other ten groups successfully. Authentication integration remains unverified. A local server launched with isolated JSON fallback did not reach readiness within one minute; the exact startup await that stalls remains undiagnosed.
- A fresh type-check attempt stalled for one minute. `pnpm run build:web` stalled without output; the direct Vite build emitted plugin timing output but did not complete. `node scripts/build_server.mjs` and direct esbuild CLI both failed with `Cannot read directory "../../..": Access is denied` and could not resolve the server entry point. No successful production build is confirmed.
- `git diff --check` passed. External provider, database, deployment, and Vercel checks remain unverified; no package install was attempted.

## GitHub history review

- PR #3 is open and mergeable but its broad patch uses a separate in-memory session model; it will not be merged wholesale. Individual changes will be considered only when they improve the current implementation and can be verified.
- PR #4 is open and currently marked non-mergeable; it carries offline-brain recent-history changes that require review against development and the already merged chat work.
- PR #5 is merged to `main`; its purpose is system prompt, conversation history, and honest offline fallback. The main-only commits remain unmerged into the development branch while the working changes are being secured and tested.

## Milestone history

- No recovery milestone commits or pushes yet. This ledger and all in-progress edits remain uncommitted on `New-Fixes-by-Erudite`; they are preserved in the local working tree.


## Continuation verification — 2026-10-26

- Reconfirmed repository root C:\Users\Erudite\Documents\GitHub\COMPLETED, branch New-Fixes-by-Erudite, HEAD 592cf688f37e8c1a7e8fc599d0f5944baa877b28, and exactly five modified files: this ledger, server.ts, src/App.tsx, src/UpdateModal.tsx, and src/server/storage/UpdateStore.ts. No untracked files or .git/index.lock were present. The prior git add attempt was denied when creating .git/index.lock; no repeated write attempt was made.
- Fresh pnpm run lint / tsc --noEmit exited 0. Fresh git diff --check passed.
- Fresh full test command was run with a temporary OS-temp-only preload for the sandbox os.userInfo() ENOMEM. Backend URL/health and standalone conversation/research groups passed; authentication integration failed with ECONNREFUSED 127.0.0.1:3000. The run stopped there; this is not a full-suite pass.
- Documented development startup is pnpm run dev (tsx server.ts); PORT defaults to 3000, and the production migration script requires DATABASE_URL. An unshimmed startup failed before application code in tsx with Node 24.22.1 uv_os_get_passwd returned ENOMEM. With a temporary runner-only shim and isolated RARE_APP_ROOT, engine initialization logged and reported missing DATABASE_URL with local JSON fallback, but the server did not listen within a 60-second bounded attempt; /api/health refused the connection at 40 seconds. No source exception identified the later wait. No database was reachable or migration applied.
- The application chat path is POST /api/conversations/:id → generateAssistantReply → ProviderRegistry.generateOnline; the handler rejects offline-cognitive results and returns 503 when no real provider can respond. Gemini uses GEMINI_API_KEY; no live inference was performed. Provider behavior remains covered only by the previously passing focused mock/provider test.
- Vercel configuration was inspected: Express framework, npm run build, server.ts function with 60-second max duration and public/index.html inclusion. Vercel CLI is absent; no hosted configuration, deployment, or live health route was verified.
- Fresh web build remained stalled after Vite plugin-timing output and was stopped after a bounded wait. Fresh server bundle failed because esbuild could not read parent directory ../../.. (Access is denied) and could not resolve ./server.ts. No production build passed.
- Branch, HEAD, and diff remain unchanged by these checks; no commit or push occurred, and main remains untouched. Existing APK findings and signing/build limitations above remain in effect.
