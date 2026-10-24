# RARE Recovery Ledger

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
| Sessions and CSRF | In progress: cookie-backed browser sessions; server-issued session cookie is HttpOnly, Secure in production; separate CSRF token; exact-origin validation; credentials-enabled CORS; auth responses no longer include session secrets; client does not store browser session tokens in localStorage. | `git diff --check` passed. Type check and security suite not run yet because no project dependencies are installed. |
| User ownership | In progress: owner-keyed PostgreSQL state covers memories, documents, conversations, settings, schedules, plugins, image galleries, and research. Project reads and writes now use owner-scoped relational queries and forced RLS; project reports are saved in the owner’s document collection. Guest sessions have explicit resource limits and account-required expensive actions. | Added cross-user API cases and isolated storage tests for project persistence, private memories/documents/chats/settings/schedules/plugins, developer operations, and guest/session behavior. Test suite is blocked by unavailable project dependencies; no runtime claim. |
| PostgreSQL and RLS | In progress: added ordered repeatable `20261023_core_schema.sql` and `20261024_rare_user_state.sql` migrations; ownership columns, foreign keys, indexes, forced RLS, OAuth identities, per-account developer credentials, grants, and private state. Migration runner uses advisory locking and immutable checksums. | Migration application, persistence restart, and RLS behavior are not run: no reachable configured test database. No live Supabase verification. |
| OAuth identity | In progress: identity association is provider plus stable subject; email linking is permitted only when provider verification says the email is verified; accounts without verified email are supported; unique constraints protect database races. Microsoft subject includes tenant issuer scope. | Added local regression cases for unverified email isolation, stable subject across email changes, and verified linking. Not run. No provider credentials or live callback test. |
| Developer access | In progress: credentials are stored hashed per developer account; grants are bound to server sessions; the authenticated persisted role is checked; account-scoped passkey attempt throttling and grant revocation on credential change are implemented. | Added ordinary-user denial assertions. Not runtime-tested; DB migration and external secret configuration are unverified. |
| Document import | In progress: HTTPS-only import checks public DNS, rejects private/special-use addresses, pins the validated address for TLS requests, limits redirects/time/bytes, and validates response types. | Added local rejection tests for HTTP, loopback, and IPv4-mapped private IPv6. Not run. |
| Vercel | Adapter/configuration implemented: `server.ts` exports the Express app, performs one-time initialization, and skips creating a listener under Vercel; root `vercel.json` runs the project build and points static output at `dist`. | Configuration has not been exercised by Vercel CLI/build. Production environment variables, function packaging, platform routing, and live behavior remain unverified. |
| Chat, production deployment | Main-only chat/provider improvements and open PRs were reviewed; reconciliation remains pending until the development work is protected and checks can run. | No provider/database credentials, dependency install, deployment, or live URL checks performed. |

## Toolchain diagnosis

- `package.json` scripts are `build`, `lint` (`tsc --noEmit`), and `test` (`tsx tests/run_all_tests.ts`). The repository has a valid npm v3 `package-lock.json`; there is no `pnpm-lock.yaml`, `.npmrc`, or package workspace file.
- Runtime observed: Node `v24.22.1`; `npm` and Corepack are unavailable. `pnpm` is supplied by the Codex runtime. `typescript`, `tsx`, `express`, `pg`, and `vite` are not installed in the repository or resolved from the runtime.
- The current pnpm content store exists, but no project `node_modules` directory exists and the npm CLI is not installed. Node `v24.22.1` and the Codex-provided pnpm are available.
- Read-only connectivity check to the configured trusted registry `https://registry.npmjs.org/` failed with `EACCES`; earlier pnpm package fetches also failed `EACCES`, and a single npm-CLI bootstrap stalled. No repeated install was attempted, no partial `node_modules` was created, and the valid npm lockfile was preserved.
- Available verification so far: `git diff --check` passed; Node `--experimental-strip-types --check` passed for the changed `.ts` files that were checked. TypeScript type-check, lint, app test suite, production build, and Vercel build are blocked/not run because project packages are unavailable. Runtime database and provider tests are not run.
- Safe next toolchain step: enable the configured npm registry access (or provide an authorized pre-populated package cache/npm CLI), then run `npm ci` strictly from the existing `package-lock.json`.

## GitHub history review

- PR #3 is open and mergeable but its broad patch uses a separate in-memory session model; it will not be merged wholesale. Individual changes will be considered only when they improve the current implementation and can be verified.
- PR #4 is open and currently marked non-mergeable; it carries offline-brain recent-history changes that require review against development and the already merged chat work.
- PR #5 is merged to `main`; its purpose is system prompt, conversation history, and honest offline fallback. The main-only commits remain unmerged into the development branch while the working changes are being secured and tested.

## Milestone history

- No recovery milestone commits or pushes yet. This ledger and all in-progress edits remain uncommitted on `New-Fixes-by-Erudite`; they are preserved in the local working tree.
