# RARE Recovery Ledger

## Current state — 2026-10-27

This section supersedes every entry below it. The previous ledger (which describes a
Windows checkout at `cd362ee` and `592cf688`, claims `.git` was read-only, and states
that GitHub and Vercel were unreachable) is **historical**. It remains retrievable,
unmodified, from git history:

- `git show 7117f892:RECOVERY_STATUS.md` — the ledger as of the start of this pass
- `git show 592cf688:RECOVERY_STATUS.md` — the 2026-10-26 production repair pass

Those entries are no longer descriptions of the current branch. In particular, the
claims "GitHub access remains unavailable" and "No Vercel CLI is installed" were both
false by 2026-10-27: GitHub reads and authenticated commits work, and the Vercel
Preview has been inspected repeatedly.

### Verified repository state

- Repository: `Rare-Erudite/COMPLETED` (Vercel project `rareproject`, team `mypremierai-2827`).
- Development branch: `New-Fixes-by-Erudite`.
- Head at the start of this pass: `7117f892314ec71802108a41f20c969d9b1daf93`.
- `main`: `7e13f23920f3b203b7a84a2b586819495c4cef89` — **unchanged, not merged into, not deployed.**
- Divergence: development 2 behind / 101 ahead of `main`.

### Commits added in this pass

| SHA | Subject | State |
| --- | --- | --- |
| `ee2ff28` | feat: wire Documents, Research and Rae Assistant into the app; make builder + updater honest | pushed |
| `3ceb33f` | feat(ui): add Documents, Research and Rae Assistant workspace components | pushed (contained a placeholder body) |
| `7f60ec0` | fix(ui): replace placeholder with the real DocumentsWorkspaceView implementation | pushed — blob verified `7a6958287497ab10b9a8d9f66efb78dcf71b3937` |
| `7757880` | feat(ui): add Research and Rae Assistant workspace views | pushed — blob verified `7e6baecf88c1e665356a69e86ab8ff6d52d15a8f` |

`3ceb33f` wrote a placeholder instead of the real file. It was corrected in `7f60ec0`
and the published blob was confirmed byte-identical to the locally typechecked file.

### What these commits actually change

- `src/server/builder/ToolchainRegistry.ts` (new): probes real executables
  (`node`, `npm`, `vite`, `python3`, `git`, `cargo`, `go`, `java`, `gradle`, `docker`)
  and reports `ready` / `version_mismatch` / `missing` / `probe_failed` with evidence.
  Replaces a hardcoded list that claimed `detected: true` for all six entries,
  including Gradle and MSVC, regardless of the host.
- `src/components/ToolchainMatrix.tsx` (new): renders that matrix inside Project & Build.
- `src/components/DocumentsWorkspaceView.tsx` (new): list, search, create, upload, read,
  save, download, convert, URL import, and real audio transcription through the existing
  `/api/documents` routes. Transcription uploads actual audio; the previous inline view
  posted only `{audioName, sampleTopic}`.
- `src/components/ResearchWorkspaceView.tsx` (new): query, history, sources with links
  and excerpts, per-connector failure reporting from `sourceErrors`, and Save to
  Documents writing a cited Markdown report.
- `src/components/AssistantStudioView.tsx`: real capability detection, Web Speech voice
  input and `speechSynthesis` output with honest unavailable states, and natural-language
  commands routed into the existing document / research / URL / task services. Wake word
  is reported unavailable with the reason rather than claimed.
- `tests/test_builder_and_assistant.ts` (new): asserts the honest-reporting invariant
  (`detected` must agree with `status`; an unavailable tool exposes no version and does
  explain the install) plus command-interpretation routing. One assertion caught a real
  bug — "the" was not stripped from "find the document about X" — now fixed.
- `scripts/verify_rare_endpoints.py` (new): end-to-end checks against a live server.

### Verification actually performed

| Check | Command | Result |
| --- | --- | --- |
| Type check | `npx tsc --noEmit` | **exit 0** (local) |
| Type check on remote | `npx tsc --noEmit` in a fresh clone of `7757880` | **exit 0** |
| Production build | `npm run build` | **exit 0** |
| Full suite | `npm test` | **12/12 groups pass** (requires a server on :3000) |
| Whitespace | `git diff --check` | clean |
| Endpoint script | `python3 scripts/verify_rare_endpoints.py` | **12/12 PASS** |
| Live Preview | `vercel curl` on the branch alias | `/chat` 200, `/api/health` 200, `/api/status` 200, `/api/integration/rare-intelligence` 200, `/api/v1/engine/health` 200; `/` **404** |

Cross-user isolation was exercised against the running server: a second account received
`[]` for its document list, `404` when reading the first user's document by path,
and writing the same path landed in its own namespace without altering the first user's
content. Anonymous reads were refused. `/api/updates/apply` returns **501** and does not
claim an install.

### Known defect — NOT fixed

`/` returns **404** on the live Preview (and `/index.html`). This predates this pass: it
was already present at `7117f892` and is unrelated to the documents/research work. The
static-serving block in `server.ts` is unchanged since the baseline, so the cause is in
the build-output / static-sync path and was **not** isolated. Do not treat the Preview
as a working frontend until this is fixed — only the API routes are verified.

### Blocked — wiring not pushed

`src/App.tsx` and `server.ts` are modified locally and verified, but **could not be
pushed**. `git push` has no credentials in this sandbox (it prompts for a username), and
the only available publisher, the GitHub MCP integration, accepts whole-file content
only — `src/App.tsx` is 283 KB and `server.ts` 193 KB, too large to re-send reliably.
The change is therefore prepared as `rare-ui-wiring.patch` (465 lines, 12 hunks) and
verified with `git apply --check --reverse`.

Until it is applied, the three new workspace components exist on the branch but nothing
imports them, so **Documents, Research and the Rae Assistant are still unreachable in the
running app**. The nav entries, the `activeTab` render branches, the removal of the two
dead inline views, the APK SHA-256 digest and the real `/api/builder/toolchains` response
are all in that patch.

### Remaining work

1. Apply `rare-ui-wiring.patch` and push to `New-Fixes-by-Erudite` (needs a GitHub token
   with `repo` write, or a local clone with push access).
2. Fix the `/` 404 regression so the Preview serves the frontend.
3. Provision PostgreSQL and set `DATABASE_URL` on the Preview target — the Preview
   currently runs on the ephemeral JSON fallback, so data does not survive a cold start.
   Production still refuses to boot without it (by design).
4. Add `GEMINI_API_KEY` to the Preview target for genuine AI chat; it is currently
   production-only and empty. Chat on Preview returns `503 NO_AI_PROVIDER_AVAILABLE`
   rather than fabricating a reply.
5. Line-level reconciliation of the two `main`-only commits (`97e41e03`, merge `7e13f23`).
   `git cherry` marks `97e41e03` as not applied, but its functional content is present on
   development (`buildRareSystemPrompt()` in `RarePrompt.ts`, the offline-engine fallback
   and the "heuristic can never masquerade as AI" guard in `ProviderRegistry.ts`).
6. Verify APK signing identity and device installation; the tracked APK
   (`public/rare-v1.0.0-release.apk`, 308,827 bytes, SHA-256
   `9d5eb21e27c7d2a8556bb58cf6d1b20fceb6469757b4e5a1d7394201c51b2c38`) is not built
   from the current source.

### Branch readiness

**Partially verified — not ready to merge.** The build, type check, test suite and API
surface are verified, and the toolchain/updater claims are now honest. The frontend does
not render on the Preview (`/` 404), and the new workspaces are not yet wired on the
remote branch. `main` has not been touched.
