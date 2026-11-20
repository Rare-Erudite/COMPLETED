# RARE Recovery Ledger

## Current state — 2026-11-20 (supersedes everything below)

This section supersedes every entry beneath it. It records only what was actually
observed in this pass. Where something could not be verified, that is stated plainly
rather than papered over.

### Repository state (verified against the live remote)

- Repository `Rare-Erudite/COMPLETED`; Vercel project `rareproject`, team `mypremierai-2827`.
- `main` = `c9346c5` (`Merge fix-trigger: build APK only on explicit dispatch`).
- `New-Fixes-by-Erudite` = `22e3360`. `main` is **5 ahead / 0 behind** development —
  the merge that earlier entries said had "never happened" **has happened**. The
  previous claim that `main` = `7e13f23` and was "never merged into" was wrong and is
  corrected here.
- The live site `https://rareproject.vercel.app` serves commit `234b7977` (read from
  `/api/health` → `commit_sha`), i.e. the 6 November build. Nothing newer has reached
  production.

### The headline finding of this pass

**Every production deployment fails at the platform level, not in the code.**

`POST /v13/deployments` for `main` returns `readyState: ERROR`,
`errorCode: BUILD_FAILED`, `errorMessage: Resource provisioning failed`. This was
reproduced on the unchanged `main` head `c9346c5` (`dpl_A4hzvU3C8j2jnnurPr2UYch8Qadt`).

To separate code from account, a **two-file static site** (`index.html` + `vercel.json`,
no build step, no dependencies) was deployed to the same project and failed with the
**identical** error (`dpl_EyJAHmUHhWK6gf5wuYU6z8rixxoS`). A build that cannot fail on
its own content failing the same way proves the cause is the Vercel account, not RARE's
source.

The account reports `limited: true` on `GET /v2/user` (user `mypremierai-2827`,
`mypremierai@gmail.com`). The team billing object reports `plan: "hobby"`,
`status: "active"`, `limited: false` at the team level. The limitation is on the user
account and blocks build-machine provisioning.

**This is not fixable from the repository.** It requires the account owner to clear the
limitation in the Vercel dashboard (billing / usage / verification), or to move the
project to an account that is not limited. No code change can make a build machine
provision.

### Defects fixed in this pass

| Defect | Fix | Evidence |
| --- | --- | --- |
| APK download endpoint always 404 | `PublishedRelease.ts` only accepted `rare-final-vX.Y.Z`, but every real release is tagged `vX.Y.Z-android`. Both families are now accepted, and a missing `.sha256` asset is computed from the APK bytes instead of failing. | `tests/test_published_release.ts` passes, including a case built from the real `v1.1.1-android` tag |
| On-demand APK workflow published nothing | `build-apk-now.yml` built and verified the APK but had no publish step. A `gh release create/upload` step now publishes `rare-vX.Y.Z-release.apk` + `.sha256` under tag `vX.Y.Z-android`, and `permissions` was raised from `contents: read` to `contents: write`. | Workflow file updated; the next dispatch will publish |
| Checkpoints tracked despite being gitignored | `git rm -r --cached .rare/checkpoints` removed **2,923** tracked files. A guard test now fails if they are ever tracked again. | `tests/test_repo_hygiene.ts` |
| `RECOVERY_STATUS.md` factually wrong | This rewrite. | — |
| Memory search was substring-only | Replaced with Okapi BM25 ranking (adapted from the RARE-INTELLIGENCE engine's `bm25.py`), with a substring fallback. | `tests/test_bm25.ts` |

### Defects that remain open

1. **Vercel production build failure** — account-level, see above. Not fixable in code.
2. **`RARE_INTELLIGENCE_URL` is unset**, so the intelligence provider reports
   `configured: false`. The engine repository (`Rare-Erudite/RARE-INTELLIGENCE-MODEL`,
   branch `engine-integration-v0.3.1`) has **no `vercel.json`** and is a `tsx server.ts`
   process, so it cannot be deployed to Vercel as-is. Setting the variable without a
   reachable engine would only move the failure. Left unset deliberately; the provider
   degrades honestly.
3. **The leaked credential blob is still in git history.** `.rare/state/persistent-documents.json`
   (327 accounts, password hashes) is untracked at HEAD but present in history
   (`git rev-list --objects --all` lists it). Purging it requires a history rewrite
   (`git filter-repo` / BFG) and a force-push, which this pass did not perform because
   the task forbids force-pushing and the repository is public. **This is the highest
   outstanding risk and needs an explicit owner decision.**
4. **`DATABASE_URL` is set for `preview` only, not `production`.** Production storage
   therefore depends on whatever the live deployment was built with.

### Verification actually performed (this pass)

Run in `/workspace/repo` at `main` `c9346c5` with `npm ci --ignore-scripts`:

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | **exit 0** |
| `npm run build` | **exit 0** (web 632.77 kB, server-build 854.0 kB) |
| `npm test` | **exit 0 — all groups pass** |
| `git diff --check` | clean |

`npm ci` **without** `--ignore-scripts` fails in this sandbox: `onnxruntime-node`'s
postinstall downloads a binary from `150.171.110.17:443` and times out. That is an
environment/network limitation, not a repository defect; the Vercel build uses
`npm install --ignore-scripts` (see `vercel.json`), so it is unaffected.

### What could not be verified

- **A successful production deployment** — blocked by the account limitation above.
- **The APK on a device** — this sandbox does not build, sign or repack phone packages.
  The APK is produced by the repository's own GitHub Actions workflow, which is the
  correct and only path here.
- **The RARE-INTELLIGENCE engine end-to-end** — no reachable engine instance.
- **Vercel runtime logs** — the deployment never reaches the runtime.

---

## Historical — superseded, retained for traceability

Earlier entries described a Windows checkout at `cd362ee` / `592cf688`, asserted that
GitHub and Vercel were unreachable, and stated `main` = `7e13f23` "never merged into".
All three are now false: the remote is reachable, `main` has moved to `c9346c5`, and the
merge has happened. Retrieve any earlier state from history:

- `git show 29ae94d:RECOVERY_STATUS.md` — ledger at the start of the 2026-10-27 pass
- `git show 7117f892:RECOVERY_STATUS.md` — ledger at `7117f892`
- `git show 592cf688:RECOVERY_STATUS.md` — the 2026-10-26 production repair pass
