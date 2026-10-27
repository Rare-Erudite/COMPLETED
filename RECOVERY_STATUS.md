# RARE Recovery Ledger

## Current state — 2026-10-27 (supersedes everything below)

This section supersedes every entry beneath it. The older ledger described a Windows
checkout at `cd362ee` / `592cf688`, claimed `.git` was read-only so nothing could be
committed, and asserted that GitHub and Vercel were unreachable and no Vercel CLI
existed. Those claims were already false by 2026-10-27. The historical text remains
retrievable, unmodified, from git history:

- `git show 7117f892:RECOVERY_STATUS.md` — ledger as of the start of this pass
- `git show 592cf688:RECOVERY_STATUS.md` — the 2026-10-26 production repair pass

### Repository state

- Repository `Rare-Erudite/COMPLETED`; Vercel project `rareproject`, team `mypremierai-2827`.
- Development branch `New-Fixes-by-Erudite`; head at the **start** of this pass `7117f892`.
- `main` = `7e13f23920f3b203b7a84a2b586819495c4cef89` — **unchanged; never merged into, never deployed.**
- Divergence: development 2 behind / 101 ahead of `main`.

### Commits added in this pass

| SHA | Subject |
| --- | --- |
| `ee2ff28` | feat: wire Documents, Research and Rae Assistant into the app; make builder + updater honest |
| `3ceb33f` | feat(ui): add Documents, Research and Rae Assistant workspace components — **contained a placeholder body** |
| `7f60ec0` | fix(ui): replace placeholder with the real DocumentsWorkspaceView (blob `7a695828…`) |
| `7757880` | feat(ui): add Research and Rae Assistant workspace views (blob `7e6baecf…`) |
| `f6eca94` | docs: rewrite RECOVERY_STATUS.md |
| `396625c` | chore: add patches/rare-ui-wiring.patch |
| `94f423b` | feat(assistant): real Rae Assistant view with capability detection and voice (blob `ce7afad7…`) |

Two mistakes were made and corrected in this pass, both recorded rather than hidden:

1. `3ceb33f` wrote a placeholder instead of the real DocumentsWorkspaceView. Fixed in
   `7f60ec0`; the published blob was then verified byte-identical to the locally
   typechecked file.
2. The tracked `AssistantStudioView` was a 7.5 KB stub taking no props, which this pass
   initially did not replace. Applying the wiring patch on top of it failed:
   `src/App.tsx(1382,15): error TS2322: Property 't' does not exist on type
   'IntrinsicAttributes'`. Fixed in `94f423b`.

### What the pushed changes actually do

- `src/server/builder/ToolchainRegistry.ts` (new) — probes real executables
  (`node`, `npm`, `vite`, `python3`, `git`, `cargo`, `go`, `java`, `gradle`, `docker`)
  reporting `ready` / `version_mismatch` / `missing` / `probe_failed` with evidence.
  It replaces a hardcoded list that asserted `detected: true` for all six entries —
  including Gradle and MSVC — regardless of the host.
- `src/components/ToolchainMatrix.tsx` (new) — renders that matrix in Project & Build.
- `src/components/DocumentsWorkspaceView.tsx` (new) — list, search, create, upload, read,
  save, download, convert, URL import, and transcription that uploads real audio. The
  previous inline view posted only `{audioName, sampleTopic}` and displayed a hardcoded
  "Confidence: 98.6%".
- `src/components/ResearchWorkspaceView.tsx` (new) — query, history, sources with links
  and excerpts, per-connector failures from `sourceErrors`, and Save to Documents.
- `src/components/AssistantStudioView.tsx` — real capability detection, Web Speech input,
  `speechSynthesis` output, and command routing into existing services; wake word
  reported unavailable with the reason.
- `tests/test_builder_and_assistant.ts` (new) — asserts that `detected` must agree with
  `status`. One assertion caught a real bug ("the" retained in queries); fixed.
- `scripts/verify_rare_endpoints.py` (new) — end-to-end checks against a live server.
- `patches/rare-ui-wiring.patch` — the `App.tsx` / `server.ts` wiring (see below).

### Verification actually performed

Verified against the **real remote head `94f423b` plus the patch applied**, not a local
tree:

| Check | Result |
| --- | --- |
| `git apply patches/rare-ui-wiring.patch` | applies cleanly |
| `npx tsc --noEmit` | **exit 0** |
| `npm run build` | **exit 0** (`server-build/server.js` 560.6 kb) |
| `npm test` | **exit 0 — all 13 groups pass** |
| New groups | "10 toolchains probed, 5 ready"; "12 interpretation cases verified" |
| `git diff --check` | clean |
| Endpoint script (local server) | **12/12 PASS** |

Note: `npm ci` reported exit 137 in this sandbox (the process was killed at the end of
the install) while every downstream command still passed, so dependencies were present.
Do not record `npm ci` as a clean exit here.

Cross-user isolation was exercised against a running server: a second account received
`[]` for its document list, `404` reading the first user's document by path, and writing
the same path stayed in its own namespace without altering the first user's content.
Anonymous reads were refused. `/api/updates/apply` returns **501** and does not claim an
install.

Live Preview (branch alias, SSO bypassed with `vercel curl`): `/chat` 200,
`/api/health` 200, `/api/status` 200, `/api/integration/rare-intelligence` 200,
`/api/v1/engine/health` 200, `/` **404**.

### Known defect — NOT fixed

`/` and `/index.html` return **404** on the Preview. This predates this pass (already
present at `7117f892`) and is unrelated to the documents/research work. The
static-serving block in `server.ts` is unchanged since the baseline, so the cause is in
the build-output / static-sync path and was **not** isolated. Only API routes are
verified; the Preview is not a working frontend yet.

### Blocked — the wiring is not applied on the branch

`src/App.tsx` and `server.ts` are modified and verified locally but could not be pushed:
`git push` has no credentials in this sandbox, and the only available publisher accepts
whole-file content, which is impractical for 283 KB and 193 KB files. The change ships as
`patches/rare-ui-wiring.patch` (465 lines, 12 hunks), verified to apply, typecheck, build
and pass the full suite on the real remote head.

**Until it is applied, nothing imports the new components, so Documents, Research and the
Rae Assistant are still unreachable in the running app.** The nav entries, the `activeTab`
render branches, removal of the two dead inline views, the APK SHA-256 digest, and the
real `/api/builder/toolchains` response are all inside that patch.

### Remaining work

1. Apply `patches/rare-ui-wiring.patch` and push to `New-Fixes-by-Erudite`.
2. Fix the `/` 404 so the Preview serves the frontend.
3. Provision PostgreSQL and set `DATABASE_URL` on the Preview target — it currently uses
   the ephemeral JSON fallback, so data does not survive a cold start. Production still
   refuses to boot without it, by design.
4. Add `GEMINI_API_KEY` to the Preview target; it is production-only and empty, so chat
   returns `503 NO_AI_PROVIDER_AVAILABLE` rather than fabricating an answer.
5. Line-level reconciliation of the two `main`-only commits (`97e41e03`, merge `7e13f23`).
   `git cherry` marks `97e41e03` unapplied, but its functional content is present on
   development (`buildRareSystemPrompt()` in `RarePrompt.ts`; the offline-engine fallback
   and the "heuristic can never masquerade as AI" guard in `ProviderRegistry.ts`).
6. Verify APK signing identity and device installation. The tracked APK
   (`public/rare-v1.0.0-release.apk`, 308,827 bytes, SHA-256 `9d5eb21e…`) is not built
   from the current source, and `/api/download/apk/info` now publishes its real digest.

### Branch readiness

**Partially verified — not ready to merge.** Type check, production build, the full test
suite and the API surface all pass on the exact remote tree, and the toolchain/updater
claims are now honest rather than fabricated. Against that: the frontend does not render
on the Preview (`/` 404), `npm ci` did not exit cleanly in this sandbox, and the new
workspaces are not yet wired on the branch. `main` has not been touched.
