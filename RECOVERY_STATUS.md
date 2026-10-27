# RARE Recovery Ledger

## Current state — 2026-10-27, second pass (supersedes everything below)

This section supersedes every entry beneath it. It records only what was actually
observed in this pass. Where something could not be verified, that is stated plainly
rather than papered over.

### Repository state

- Repository `Rare-Erudite/COMPLETED`; Vercel project `rareproject`, team `mypremierai-2827`.
- Development branch `New-Fixes-by-Erudite`.
- Remote head at the **start** of this pass: `29ae94d34c6991df371a03b7e33be7c9f3386e65`.
- Remote head at the **end** of this pass: `c822d2e8a1485a53c3a05b7364cf8f3b0fe4eb82`
  plus this docs commit.
- `main` = `7e13f23920f3b203b7a84a2b586819495c4cef89` — **unchanged; never merged into, never deployed.**
- Divergence: development 2 behind / 101 ahead of `main`.

### The headline finding of this pass

`patches/rare-ui-wiring.patch` had **never been applied**. It had been committed to the
repository as a file and verified as a patch, but the running application never imported
the new components. Everything about Documents / Research / Rae Assistant being
"unreachable in the app" traced back to that single fact.

The patch was applied in this pass and is verified to apply cleanly to `29ae94d` and to
produce a tree that typechecks, builds, and passes the full suite.

### Commits

| SHA | Location | Subject |
| --- | --- | --- |
| `1c8b24c` | local only | feat: wire Documents, Research and Rae Assistant into the app |
| `e12f77d` | local only | fix(vercel): bundle the whole public/ directory into the function |
| `c822d2e8` | **remote** | the same `vercel.json` change, published on its own |

`c822d2e8` carries the `vercel.json` fix only. Its blob SHA was verified to match
`git hash-object vercel.json` (`5a029833…`) exactly.

`1c8b24c` touches `src/App.tsx`, `server.ts`, `server-build/server.js`,
`server-build/server.js.map` and is **not** on the remote.

### What the local change does

- `src/App.tsx` imports and routes `DocumentsWorkspaceView`, `ResearchWorkspaceView`,
  `AssistantStudioView` and `ToolchainMatrix`; adds Documents, Research and Rae Assistant
  to the workspace navigation. The existing **Projects** entry (`id: 'projects'`) is
  untouched, so the general Project & Build section is preserved and stays distinct from
  the developer-restricted Command Center.
- Removes `CleanDocumentsWorkspaceView` (296 lines), the old decorative view that posted
  `{audioName, sampleTopic}` and displayed a hardcoded "Confidence: 98.6%". It is fully
  superseded by the real `DocumentsWorkspaceView`; no other file referenced it.
- `server.ts` exposes `GET /api/builder/toolchains`, backed by the real `detectToolchains()`
  probe instead of a hardcoded capability list, and adds a cached SHA-256 digest plus
  release metadata to `/api/download/apk/info`, keyed on `path:size:mtime` so a stale hash
  is never served.

### Second finding: the committed server bundle was stale

`server-build/server.js` in the repository was last committed on **2026-10-13**, thirteen
days older than the `server.ts` it represents (last changed 2026-10-26). `npm start` runs
`node server-build/server.js --production`, so the committed bundle served pre-recovery
code — including, during this pass, a build in which the `/api/documents` session guard
was absent and anonymous reads and writes both succeeded.

**Anything reading `server-build/server.js` without rebuilding is reading stale code.**
That is a standing hazard for this repository, not only for this pass.

### Verification actually performed

Run in a clean worktree of the real remote head `29ae94d` with the patch applied, after
`npm ci` from the committed lockfile:

| Command | Exit code |
| --- | --- |
| `npm ci` | **0** |
| `npm run lint` (`tsc --noEmit`) | **0** |
| `npm run build` (`vite build` + `sync_vercel_static.mjs` + `build_server.mjs`) | **0** |
| `npm test` | **0 — all 13 groups pass** |
| `git diff --check` | **0** |

Test groups all reported passing, including "10 toolchains probed, 5 ready" and
"12 interpretation cases verified". The suite requires a live server on port 3000; it
fails with `ECONNREFUSED` otherwise, which is what an earlier run recorded before the
server was up.

### Security behaviour exercised

Against a live server built from the patched source:

- `GET /api/documents` anonymous → **401**
- `POST /api/documents` anonymous → **401**
- The authentication/verification-code group passes, covering session cookie
  `HttpOnly`/`SameSite`, CSRF issuance, replay prevention, rate limiting, forged
  Google/Microsoft token rejection, salted password verification, and refusal of
  privilege escalation via an email string.
- The durable-state / document-safety group passes, covering cross-user ownership.
- `/api/builder/toolchains` on the live Preview → **401** unauthenticated, so the new
  endpoint sits behind the session guard rather than being public.

### Environment configuration (presence only — no values read or recorded)

| Variable | Targets | Type |
| --- | --- | --- |
| `DATABASE_URL` | production, **preview** | sensitive |
| `RARE_ALLOWED_ORIGINS` | preview | plain |
| `RARE_ALLOW_LOCAL_STORAGE_FALLBACK` | preview | plain |
| `GEMINI_API_KEY` | **production only** | sensitive |

`DATABASE_URL` is configured for Preview **and reachable** — the git-built deployment
reports `storage.type: "postgresql"` in `/api/status`. `GEMINI_API_KEY` is not on Preview,
so the AI path is unavailable there.

### The real frontend defect — the asset bundles were never served

This is the finding that matters most, and it is not the 404 that earlier reports chased.

The served `index.html` references `/assets/index-…js`. Fetching that path returned
**status 200, `Content-Type: text/html`, 5,661 bytes** — the contents of `index.html`, not
the 612,091-byte JavaScript bundle. The CSS was the same.

Cause: `vercel.json` declared

```json
"functions": { "server.ts": { "includeFiles": "public/index.html" } }
```

`includeFiles` is a whitelist of what ships inside the serverless function. Naming one
file shipped `index.html` and nothing else, so `/assets/*` did not exist inside the
function. `express.static('public')` found no file, the request fell through to the SPA
catch-all `app.get('*')`, and the catch-all returned `index.html` with status 200.

**The consequence: the app loaded its HTML and then rendered blank.** A status-code check
reported "200, working" throughout. It was only found by fetching the asset the served
HTML points at and comparing bytes and MIME type.

Fixed by widening the whitelist to `public/**`.

### Live Preview — verified from a git-triggered build

After `c822d2e8` landed, Vercel built it from GitHub: `dpl_GDFpp4L2SWZGfyz3zoCsuHinUBbq`,
READY, at `https://rareproject-5nejjy0hy-mypremierai-2827.vercel.app`.

| Route | Status | Content-Type |
| --- | --- | --- |
| `/` | 200 | `text/html` (5,824 bytes) |
| `/chat` | 200 | `text/html` |
| `/assets/index-B_lpyho7.js` | **200** | **`application/javascript`** (563,920 bytes) |
| `/assets/index-72BfxOsX.css` | **200** | **`text/css`** (114,276 bytes) |
| `/api/health` | 200 | `application/json` |
| `/api/status` | 200 | `application/json` |
| `/api/builder/toolchains` | 401 | `application/json` |
| `/api/integration/rare-intelligence` | 200 | `application/json` |
| `/api/v1/engine/health` | 200 | `application/json` |
| `/api/unknown-xyz` | 401 | `application/json` — not HTML |

The bundle is real JavaScript (`var e=Object.create,…`), not HTML, so the fix is
effective on a build produced from the repository rather than from a local tree. The nav
labels are correctly absent from it, because `c822d2e8` contains the `vercel.json` fix
only.

SSO protection is on for the project, so routes were reached with `vercel curl`; a plain
`curl` returns 302 to the Vercel authentication wall.

One transient observation: an immediate request to `/` on this deployment returned **404**
while the function was still cold-starting, then 200 once warm. Cold-start 404s are a
separate, milder issue than the `includeFiles` bug and were not investigated further.

### Blocked — the wiring is not on the remote

`git push` has no credentials in this sandbox: HTTPS returns `remote: No anonymous write
access`, SSH returns `Permission denied (publickey)`, and there is no `gh` config or
`~/.git-credentials`.

The connected GitHub publisher accepts whole-file content only with no binary support.
`vercel.json` (218 bytes) went through it. `src/App.tsx` (288 KB), `server.ts` (193 KB) and
`server-build/server.js` (574 KB) are past its practical limit and did not.

Applying `patches/rare-ui-wiring.patch` (already in the repository) to `29ae94d` was
tested and reproduces the local tree **byte-for-byte** — `git hash-object` matches
`28e6f304…` for `server.ts` and `2420d146…` for `src/App.tsx`.

**The exact action needed** — from a checkout with push access:

```
git apply patches/rare-ui-wiring.patch
npm ci && npm run lint && npm run build && npm test
npm run build:server                 # regenerate the stale bundle
git add server.ts src/App.tsx server-build/
git commit -m "feat: wire Documents, Research and Rae Assistant into the app"
git push origin New-Fixes-by-Erudite
```

`vercel.json` no longer needs anything: `c822d2e8` already carries that change.

### APK — what is and is not verified

`public/rare-v1.0.0-release.apk`, 308,827 bytes, SHA-256
`9d5eb21e27c7d2a8556bb58cf6d1b20fceb6469757b4e5a1d7394201c51b2c38`.

Verified: a genuine APK container (`Android package (APK), with AndroidManifest.xml,
with APK Signing Block`) carrying a v1 signature pair (`META-INF/RAREKEY.SF`,
`META-INF/RAREKEY.RSA`). `/api/download/apk/info` returns that real digest at `STATUS=200`,
with `version: null` and `signedBy: null` because no release has been published to the
update store.

**Not verified:** the signing identity (`apksigner` is not installed here, so the
certificate subject and v2/v3 verification were not checked), that the APK was built from
current source, or that it installs on a device. Do not treat this artifact as a current,
signed, installable build on the strength of the above.

### Remaining work

1. **Push the App.tsx / server.ts wiring to `New-Fixes-by-Erudite`.** Until it lands,
   Documents, Research and Rae Assistant stay unreachable in the deployed app even though
   their components are in the repository. See the command block above.
2. Add `GEMINI_API_KEY` to the **Preview** target. Without it the AI path returns an honest
   `NO_AI_PROVIDER_AVAILABLE`, so online chat remains unverified.
3. Mark `server-build/` as a build output (or make `start` build first) so a stale
   committed bundle can never again serve code that does not match `server.ts`. Related:
   `includeFiles` is a whitelist, so a new top-level static path under `public/` will
   silently 404 unless the glob covers it.
4. Verify the APK signing identity and a real device install before any release claim.
5. Line-level reconciliation of the two `main`-only commits (`97e41e03`, merge `7e13f23`).
   Its functional content is present on development (`buildRareSystemPrompt()` in
   `RarePrompt.ts`; the offline-engine fallback and the "heuristic can never masquerade as
   AI" guard in `ProviderRegistry.ts`), but a hunk-by-hunk check has not been done.
6. Exercise cross-user isolation through the **deployed** Preview with two real sessions.
   It passes locally; on Vercel it has not been run.

### Branch readiness

**Partially verified — not ready to merge.** On the real remote tree with both changes
applied: `npm ci` 0, `npm run lint` 0, `npm run build` 0, `npm test` 0 with all 13 groups,
`git diff --check` 0. The deployed Preview serves the frontend properly — HTML at 200 and
both bundles at 200 with correct MIME types — and the API surface answers as expected.

Against that, four things remain and none is cosmetic:

1. **The wiring is not on the remote branch.** Only `vercel.json` landed, as `c822d2e8`.
2. **No genuine AI request has been verified** — `GEMINI_API_KEY` is production-only.
3. **Cross-user isolation has not been exercised through the deployed Preview.**
4. **The two `main`-only commits have not been reconciled hunk by hunk.**

`main` has not been touched at any point: still `7e13f23`, never merged into, never
deployed to production.

---

## Historical — superseded, retained for traceability

Earlier entries in this file described a Windows checkout at `cd362ee` / `592cf688` and
asserted that GitHub and Vercel were unreachable and that no Vercel CLI existed. Both
claims were false by 2026-10-27. A later entry correctly retracted the claim that the
wiring was applied, but still attributed the broken frontend to a `/` 404, which was not
the cause. Retrieve any earlier state from history:

- `git show 29ae94d:RECOVERY_STATUS.md` — ledger at the start of this pass
- `git show 7117f892:RECOVERY_STATUS.md` — ledger at `7117f892`
- `git show 592cf688:RECOVERY_STATUS.md` — the 2026-10-26 production repair pass
