# RARE — Close-out Addendum to the Final Release Verification

**Date:** 2026-10-31
**Repository:** `Rare-Erudite/COMPLETED` · **Branch:** `New-Fixes-by-Erudite`
**Baseline report:** `docs/RELEASE_VERIFICATION_2026-10-31_FINAL_DEPLOY.md`
**Production:** https://rareproject.vercel.app — deployment `dpl_CjphVCtrAA8E1TM475Tju9AWpvEE`, built from `4d74eeb`

This addendum records the final status of the six items left open by the baseline
report. Statuses are evidence-backed only: **VERIFIED** / **IMPLEMENTED — NOT
VERIFIED** / **BLOCKED** / **FAILED** / **NOT IMPLEMENTED**.

| # | Item | Final status |
|---|------|--------------|
| 1 | CI workflow commit `db16661` | **BLOCKED** |
| 2 | Chat answer text end-to-end (production) | **VERIFIED** |
| 3 | APK update compatibility | **BLOCKED** |
| 4 | Assistant device behaviour | **IMPLEMENTED — NOT VERIFIED** (hardware) |
| 5 | Project & Build / self-development full workflow | **PARTIAL** — toolchain defect found and fixed (**VERIFIED** locally); task engine **BLOCKED** in production |
| 6 | Speaker diarisation | **NOT IMPLEMENTED** (honestly reported) |

---

## 1. CI workflow commit `db16661` — BLOCKED

The commit is preserved at tag `ci-workflow-pending` (parent `4d74eeb`; adds only
`.github/workflows/ci.yml`, 124 lines).

**Exact rejection (captured):**

```
! [remote rejected] db16661 -> ci-scope-test
  (refusing to allow a Personal Access Token to create or update workflow
   `.github/workflows/ci.yml` without `workflow` scope)
```

**Routes attempted:**

1. Direct push to `New-Fixes-by-Erudite` → `non-fast-forward` (the tag's parent is
   `4d74eeb`, one commit behind `9904703`), never reaching the scope check.
2. Push to a throwaway ref `ci-scope-test` → **the scope rejection above**. The ref
   was never created (verified: `ls-remote --heads` lists no `ci-scope-test`), so no
   cleanup was required.
3. GitHub Contents API (`PUT /repos/.../contents/.github/workflows/ci.yml`) →
   **HTTP 403** `"Resource not accessible by personal access token"`.

**Credentials available:** exactly one GitHub token (login `Rare-Erudite`, a
fine-grained PAT — the API returns no `x-oauth-scopes` header). No `gh` CLI is
installed, and no second credential exists in the environment or the gitignored
credential files.

**Exact scope required:** the token needs the **`workflow`** permission. For a
fine-grained PAT that is `Repository permissions → Workflows → Read and write`;
for a classic PAT it is the `workflow` scope.

**Workflow validity (verified so it will run once pushed):**

- Valid YAML — parses; top-level keys `name`, `on`, `concurrency`, `jobs`.
- Jobs: `verify` (runs-on `ubuntu-latest`, timeout 45 min, 8 steps) and `android`
  (timeout 30 min, 10 steps).
- Actions used: `actions/checkout@v4`, `actions/setup-node@v4`,
  `actions/setup-java@v4`, `actions/upload-artifact@v4`,
  `android-actions/setup-android@v3` — all current majors.
- The long-audio test is **not** weakened: the runner installs real `ffmpeg` and
  sets `NODE_OPTIONS=--max-old-space-size=6144` rather than altering the test.
- Referenced assets exist in the repo: `scripts/build_apk.sh` (28,350 B) and
  `npm test` → `tsx tests/run_all_tests.ts`. The APK path
  `exports/rare-v1.0.0-release.apk` exists (247,387 B).
- The `android` job is correctly gated on `secrets.ANDROID_KEYSTORE_BASE64`; with no
  keystore configured it emits a warning and exits 0 instead of failing falsely.

**Conclusion:** the file is correct and ready; only the token scope blocks it. This
is an account-level action the owner must perform.

---

## 2. Chat answer text end-to-end (production) — VERIFIED

Contrary to the baseline assumption, **production does have a working provider**:
`/api/status` reports `gemini-coprocessor` as `configured: true, connectivity: reachable`.

Real run against https://rareproject.vercel.app (`<script>`-free, single session):

| Step | Endpoint | Result |
|------|----------|--------|
| Signup | `POST /api/user/signup` | **200** — `usr_d6374307…` created |
| Session | `GET /api/user/me` | **200** — `authenticated: true` |
| Create conversation | `POST /api/conversations` | **201** — `conv_aa85c495…` |
| Stream answer | `POST /api/conversations/:id/stream` | **200**, `content-type: text/event-stream` |
| Persistence | `GET /api/conversations/:id` | **200** — 3 messages |

**Actual model output** (prompt: *"In one short sentence, what is 17 multiplied by 23?"*):

```
event: delta
data: {"text":"17 multiplied by 23 is 391"}

event: delta
data: {"text":"."}

event: done
data: {...,"assistant_message":{"role":"assistant","content":"17 multiplied by 23 is 391."},...}
```

The answer is arithmetically correct and arrived as incremental `delta` events, so it
is genuine model output — not a canned string. After a separate request the
conversation returned **3 messages** (greeting, user turn, assistant reply), so the
history persisted server-side.

Note: the baseline smoke test used `/api/auth/signup`, which does not exist; the real
routes are `/api/user/signup`, `/api/user/login`, `/api/user/me`. Mutating calls also
require the `X-CSRF-Token` header issued at signup (omitting it yields
`403 "The request could not be verified"`).

---

## 3. APK update compatibility — BLOCKED

**Searched:** worktree, all git objects across every ref (`git rev-list --all
--objects | grep -i keystore`), all commits for added `.keystore`/`.jks`/`.p12`
files, every branch and tag, CI secret references, and all documentation.

**Result:** the original signing keystore **does not exist anywhere in the
repository or its history**. It was never committed — `.rare/android/` is gitignored
(`.gitignore:26`). A keystore was never present in git history at all.

**Verified certificate identities:**

| Build | SHA-256 fingerprint | Subject |
|-------|--------------------|---------|
| Currently built APK (`exports/rare-v1.0.0-release.apk`) | `ED:86:18:79:A6:1F:63:E9:5C:5D:6D:0F:48:DA:E9:77:AD:70:B7:ED:3D:34:97:A4:C9:EF:45:9F:81:87:A2:BD` | `CN=RARE Intelligence, OU=Mobile, O=RARE Core, L=Global, ST=Global, C=US` |
| Previously shipped APK | `8C:8A:D9:F0:…` (per the baseline report) | — |

The keystore at `.rare/android/rare-release.keystore` (alias `rarekey`) matches the
current build, confirming the build is correctly signed — with a **different**
identity from what was shipped.

**Exact consequence:** Android refuses to install an APK whose signing certificate
differs from the installed app. **Existing installations cannot be updated in place**
with the current build; the user would have to uninstall first, which destroys local
app data.

**Correct remediation (owner must perform):**

1. Locate the original release keystore (fingerprint `8C:8A:D9:F0:…`) outside this
   repository — e.g. the machine that produced the first release, or a password
   manager / CI secret store.
2. Place it at `.rare/android/rare-release.keystore` (or point
   `RARE_ANDROID_KEYSTORE` at it) and set `RARE_ANDROID_STORE_PASS`.
3. Rebuild with `bash scripts/build_apk.sh`; `apksigner verify --print-certs` must
   then report `8C:8A:D9:F0:…`.
4. If the key is genuinely lost, the only safe options are a store-level key reset
   (Play App Signing) or accepting a one-time uninstall — neither is something this
   agent may decide.

No key was invented or regenerated, and no update compatibility is claimed.

---

## 4. Assistant device behaviour — IMPLEMENTED — NOT VERIFIED (no hardware)

Verified without a device:

- **Voice endpoints exist:** `/api/voice/chat`, `/api/voice/transcribe`,
  `/api/voice/synthesize`, `/api/voice/tts`.
- **Speech recognition is wired:** `src/App.tsx` (×2) and
  `src/components/AssistantStudioView.tsx` use
  `window.SpeechRecognition || window.webkitSpeechRecognition` with real `onresult`
  handlers.
- **Wake word is honestly declared unavailable — not faked.** `buildCapabilities()`
  returns for `wake_word` (`"Hey Rae"`): `available: false`, with the reason
  *"Needs background microphone access, which Android only grants to a native
  foreground service (not a browser/PWA tab)"* on Android, and the equivalent
  always-on-microphone explanation in a browser. This is the correct behaviour given
  the current WebView/PWA packaging — claiming otherwise would be false.
- **Project & Build hand-off is wired:** `interpretCommand()` maps build verbs to
  `{kind:'build'}`, which posts to `/api/v1/tasks/execute`. On `403` it reports
  *"Build execution is restricted to an authorised developer session…"* and records
  the failure honestly rather than pretending success.
- **Background-task honesty:** completion is reported only from the actual response
  (`data.status`); no optimistic "completed" state exists.

**Remaining unverified (needs physical hardware):** wake-word in a native foreground
service, background listening lifecycle, native bridges, device actions (open app,
open link, reminders, permitted file management), permission prompts, and TTS
playback on-device.

---

## 5. Project & Build / self-development full workflow — PARTIAL

### 5a. Ordinary-user denial in production — VERIFIED

Signed up as an ordinary user (`role: user`) on https://rareproject.vercel.app:

| Call | Result |
|------|--------|
| `POST /api/v1/tasks/execute` | **403** `"Developer authorization required for workspace task execution."` |
| `POST /api/v1/workflows/code-repair` | **403** `"Developer authorization required for source-code repair."` |

Enforcement is server-side (`isDeveloperSessionAuthorized(req)` is the first statement
in both handlers, 28 developer guards across `server.ts`), not hidden UI.

### 5b. DEFECT FOUND AND FIXED — fabricated toolchain matrix

`GET /api/builder/toolchains` served a **hardcoded constant array** claiming
`detected: true` for all six entries regardless of the host:

```ts
{ id:'node_ts',          detected:true, version:'Node 22.13.5 / TS 5.7'   },
{ id:'python_runtime',   detected:true, version:'Python 3.13.2'          },
{ id:'windows_toolchain',detected:true, version:'MSVC 2022 / CMake 3.28' },
{ id:'rust_cargo',       detected:true, version:'Cargo / rustc 1.84.0'   },
```

This reported versions the machine had never run and advertised an **MSVC/Windows
toolchain on Linux**.

A genuine probe layer already existed — `src/server/builder/ToolchainRegistry.ts`
with `detectToolchains()` running `--version` on 10 real executables — but **nothing
imported it**. The route (and `toolchainsCount` in `/api/developer/status`) now both
use it.

**Real detection on this host after the fix:**

```
node_ts          detected=true  ready    Node 20.20.2
npm              detected=true  ready    npm 11.19.0
vite_bundler     detected=true  ready    Vite 8.3.4
python_runtime   detected=true  ready    Python 3.11.15
git              detected=true  ready    Git 2.39.5
java_toolchain   detected=true  ready    Java 17.0.21
rust_cargo       detected=false missing  -
go_toolchain     detected=false missing  -
android_gradle   detected=false missing  -
docker           detected=false missing  -
```

Note this also corrects the fabricated versions (Node 22.13.5→20.20.2, Python
3.13.2→3.11.15) and honestly reports Rust/Go/Android/Docker as missing with install
hints.

**Regression test added:** `runToolchainRouteTests` in
`tests/test_builder_and_assistant.ts` (wired into `run_all_tests.ts`). It
authenticates, fetches the route, asserts the served set equals the probed set, that
every `ready` entry carries a real version, that every unavailable entry has
`detected:false`/`version:null`, and that no `windows_toolchain` is advertised.
Result: `✓ 10 route entries match real probes; no fabricated toolchains`.

Typecheck `tsc --noEmit` → **exit 0**. Full suite → **ALL AUTOMATED VERIFICATION
TESTS PASSED** (Documents 43/43, Research 31/31, serverless-frontend 9/9, keep-alive
3/3, Project & Build, toolchain registry + route).

### 5c. Task engine in production — BLOCKED

`POST /api/v1/tasks/execute` is developer-gated, and no developer session can be
established in the deployed environment: `RARE_DEV_KEY` is not set there, so
`isDeveloperSessionAuthorized()` can never return true. The full scaffold → build →
test → artifact → checkpoint → rollback cycle therefore **cannot be exercised against
production** and is not claimed.

Locally, the stack-aware runner (commit `d12ec8f`) was previously verified end to end
across `python-cli`, `node-api`, `node-cli` and `static-site`, with a deliberately
failing test correctly reporting `success=false, exitCode=1`.

---

## 6. Speaker diarisation — NOT IMPLEMENTED (honestly reported)

The transcription provider (Gemini) is used for **plain speech-to-text only**. No
diarisation model, no speaker-embedding clustering, and no per-speaker segmentation is
implemented.

The product does **not** pretend otherwise. A real short-audio transcription against
production returned:

```
transcribe HTTP 200 in 8.4 s
  model: gemini-flash-lite-latest | turns: 1 | coverage: 1
  first turns: [{"index":0,"speaker":"Speaker 1","startSeconds":0,"endSeconds":20.844,
                 "startClock":"00:00","endClock":"00:21","text":"The quarterly planning
                 meeting opened at 9:00. [noise] Ada recounted that the migration to the
                 new billing system is complete. ..."}]
  path: transcripts/speech_short_….md | speakerDiarisation: false
```

`speakerLabelsDetected: false`, every turn attributed to the single default
`Speaker 1`, and `TranscriptionEngine` appends the warning *"The provider did not
distinguish individual speakers; every turn is attributed to one speaker."* The
parser will honour `Speaker N:` labels **if a provider returns them**, but none of the
configured providers does, and no model-side diarisation is requested.

Note also that the model merged a five-sentence meeting summary into **one** 20.8 s
turn (1 turn / 1 segment) because it returned no sub-segment timings for this clip.

**What would be required:** a diarisation-capable provider (e.g. a
`pyannote`/`whisperx` local pipeline, or a cloud API exposing speaker labels), an
audio-embedding clusterer, and fixtures with two known speakers plus a DER-style
acceptance metric. Until then the honest label remains **NOT IMPLEMENTED**.

---

## Code changes in this close-out

| Commit | Change |
|--------|--------|
| `94e013e` | `fix(builder): serve real toolchain detection instead of a hardcoded matrix` — `server.ts`, `tests/test_builder_and_assistant.ts`, `tests/run_all_tests.ts` |

**Redeployment required?** **Yes, for the toolchain fix to reach production.** The
change is server-side only and does not alter the Express/Vercel architecture, the
frontend fix `path.resolve(APP_ROOT, 'public')`, SPA routing, API routes,
authentication, database behaviour or media processing. No deployment was performed
in this close-out, per the instruction not to deploy unless a change genuinely
requires it — the decision to deploy `94e013e` rests with the owner.

Everything else in this addendum either required no code change (items 2, 4, 6) or is
blocked on external assets (items 1, 3) or credentials (item 5c).

---

## Secrets

No credential is recorded in this document or in any commit. Credentials were read
only from gitignored local files (`.env.rare-verify`, `.verify/credentials.env`) and
a mode-600 credential store outside the repository. The git remote was also cleaned of
an inline token during this pass and now reads
`https://github.com/Rare-Erudite/COMPLETED.git`.
