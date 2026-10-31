# RARE — Final Release Verification (Continuation)

**Date:** 2026-10-31
**Repository:** `Rare-Erudite/COMPLETED`
**Working branch:** `New-Fixes-by-Erudite`
**Baseline commit (previous report):** `2cd67d8a0e18045b82b05872c7db037fef55f7b4`
**Branch HEAD at start of this run:** `95bbd87c4c6cf18b928f589b3ab52ee792c2598a`
**Branch HEAD after this run's fixes:** `23fba0972cce9b7806a40c02de85b55289467cf3`
**Author:** verification agent (automated)
**Credentials:** the Vercel / Supabase / GitHub credentials supplied for this task are referenced only as **"provided credentials"**; no secret value appears in this document, the repository, or any commit.

> **Status-label discipline.** Only **VERIFIED**, **IMPLEMENTED — NOT VERIFIED**, **BLOCKED**, **FAILED** and **NOT IMPLEMENTED** are used. "Verified" is used only where a real tool response backs it.

---

## 1. Repository & Git — VERIFIED

- Remote `https://github.com/Rare-Erudite/COMPLETED.git`; working branch `New-Fixes-by-Erudite`.
- `2cd67d8` **is an ancestor** of HEAD (`git merge-base --is-ancestor` → true); `eedf8e8` also remains an ancestor.
- Working tree was **clean** at start (no uncommitted work overwritten). `origin/New-Fixes-by-Erudite` was in sync with local HEAD (`95bbd87`).
- A safety checkpoint tag **`rare-checkpoint-2026-10-31-pre-final`** was created at `95bbd87` before any change.
- `main` was **not** merged; the branch was **not** force-pushed or reset; `Rare-Erudite/RARE-INTELLIGENCE-MODEL` was **not** touched.
- Commits created this run (all pushed fast-forward):

| Commit | Summary |
|---|---|
| `d2d1caf` | ffprobe executable-bit fix; honest voice-transcribe failure; real Project & Build lifecycle |
| `0f606b1` | first release-verification document |
| `2b61047` | run bundled ffmpeg/ffprobe from a writable copy on read-only hosts |
| `55d9bcd` | send Gemini audio as Part objects; log the real provider error |
| `943c8b9` | prefer discovered Gemini models; retry transient 503s |
| `23fba09` | skip non-audio models; stop retrying quota errors |

**Files changed across the run:** `src/server/content/MediaProcessor.ts`, `src/server/providers/GeminiCoprocessorProvider.ts`, `src/server/tools/ToolExecutor.ts`, `src/server/types.ts`, `src/server/builder/ProjectScaffolder.ts` (new), `server.ts`, `tests/test_project_build.ts` (new), `tests/test_media_binaries.ts` (new), `tests/run_all_tests.ts`, `.gitignore`, `docs/RELEASE_VERIFICATION_2026-10-31_FINAL.md`.

---

## 2. Defects discovered and fixed

### 2.1 FFmpeg/FFprobe not runnable in the Vercel runtime — **FIXED, VERIFIED in production**

**Root cause (two distinct problems, both established by evidence).**
1. `@ffprobe-installer/linux-x64` ships its binary with mode **0644** in the npm tarball (`tar -tvf` → `-rw-r--r--`) and relies on a `postinstall` chmod that Vercel's `--ignore-scripts` install skips.
2. Vercel mounts the deployment root (`/var/task`) **read-only**, so even a correct chmod fails with `EROFS` and `execFile` still gets `EACCES`. A chmod-only fix was therefore insufficient — confirmed by the deployed capability probe still reporting `media.decoding: false` after the first fix.

**Fix.** `MediaProcessor.prepareBinary()` repairs the mode in place when possible and, when the file is still not executable (read-only mount), copies it into the writable temp directory with mode 0755 and runs that copy. The copy name carries size+mtime so a new deployment never reuses a stale binary and a warm invocation reuses the copy.

**Evidence.**
- Reproduced against a real read-only bind mount: the 0644 binaries were copied to `/tmp/rare-media-bin/` and `probeMedia()` returned real metadata (20.844 s, mp3, 16 kHz mono).
- **Production logs** now show `[media] using ffmpeg=/var/task/node_modules/@ffmpeg-installer/linux-x64/ffmpeg ffprobe=/tmp/rare-media-bin/ffprobe-…`.
- **Production capability probe** now returns `media.decoding: true`.

### 2.2 `/api/voice/transcribe` returned a fabricated transcript — **FIXED**

When no speech provider was configured, the endpoint returned HTTP 200 with the canned string *"Voice message recorded and processed successfully."* and `confidence: 0.95`. It now returns **503 `TRANSCRIPTION_PROVIDER_UNAVAILABLE`**.

### 2.3 Gemini audio request used an invalid shape — **FIXED, VERIFIED in production**

`transcribeAudio()` passed `contents: [{ inlineData: {...} }, 'Transcribe …']` — a Part object mixed with a bare string. The API rejects that shape, so every transcription model failed while text generation (a plain string) kept working. Both parts are now Part objects, matching Google's documented form. The catch block also swallowed the reason; it now logs the provider message.

**Evidence.** The corrected shape was tested against the live API: it is accepted and fails only on an invalid key (`API_KEY_INVALID`), not on request format.

### 2.4 Stale Gemini model catalog — **FIXED, VERIFIED in production**

Production logs showed five of six hardcoded model ids are retired (`404 "no longer available"`) and the catalog includes TTS/gemma models that reject audio (`"Audio input modality is not enabled"`). `candidateModelIds()` now leads with the ids the key's catalog actually exposes, `canAcceptAudio()` filters out TTS/embedding/aqa/gemma ids, and only genuine capacity errors (500/503) are retried — a 429 quota error is not, since retrying it turned a fast failure into a multi-minute hang.

**Evidence.** Production transcription went from a hard failure to a **successful 39 s** request returning a real transcript.

### 2.5 Project & Build produced no project — **FIXED, VERIFIED locally**

The Universal Build run only inspected RARE's own workspace and never created a user project. Added `ProjectScaffolder` plus `SCAFFOLD_PROJECT` / `RUN_PROJECT_STAGE` tools; the run now scaffolds a real project (stack inferred from the objective) and runs its actual build/test stages, reporting real exit codes. Regression suite `tests/test_project_build.ts` passes.

---

## 3. Build & test results — real exit codes

| Command | Result |
|---|---|
| `npm ci` | **exit 0** — VERIFIED |
| `npm run lint` (`tsc --noEmit`) | **exit 0** — VERIFIED |
| `npm run build` | **exit 0** — VERIFIED (`server-build/server.js` ≈ 823 kb) |
| `npm test` | **BLOCKED in this sandbox** — see below |

**`npm test` — BLOCKED (sandbox resource limit, not a product defect).** The suite runs and passes every group up to the documents increment, then the container is **OOM-killed** at the documented **2 GB cgroup cap** while the documents suite synthesises a 25-minute audio fixture. Confirmed by the kernel's own counters: `/sys/fs/cgroup/memory.events` → `oom_kill 1`, `memory.peak` ≈ 2.0 GB. The cgroup limit is read-only (`Permission denied` on write). **No test was modified, skipped or weakened.**

Groups that **passed** in the full run before the OOM: backend URL config; standalone conversation & research routing; authentication & verification-code security; durable state / document safety / real-source research; OAuth validation; model providers & offline intelligence; RARE-INTELLIGENCE bridge; 12 tool primitives & security boundaries; memory persistence; 10-step self-development & checkpointing; benchmark evaluation; toolchain detection (10 probed, 5 ready); assistant command interpretation; **Project & Build lifecycle (new)**; **media binary resolution (new)**; serverless frontend availability (**9/9**); universal content engine; chat pipeline; and the documents increment up to and including the ffprobe-backed media-info assertion.

---

## 4. Production deployment — VERIFIED

Queried the Vercel REST API with the provided Vercel token (project `rareproject`, `prj_362nUbmvvjkLYEuGKTuV8agADQzF`, team `team_6EF6Dxce6xr00Gc64dDPMHA0`):

- **Git integration:** connected to GitHub repo `COMPLETED`; production branch `main`.
- **Production before this run:** `dpl_FFf5t7V8…`, commit `38adfbbca0` — older than the transcription fixes, and serving a **broken frontend** (`/` → 404).
- **Production after this run:** deployment `dpl_6SDEHpTDGuB8vbGYNaWgoHnoSgME`, commit **`23fba09`**, target `production`, state `READY`, aliased to `rareproject.vercel.app`.

**Production smoke test (against `https://rareproject.vercel.app`):**

| Check | Result |
|---|---|
| `/` | **200** (SPA shell) |
| `/chat` | **200** |
| `/nonexistent-deep-link` (SPA fallback) | **200** |
| `/api/status` | **200** — `storage: postgresql`, `databaseReachable: true`, `schemaReady: true` |
| `/api/documents/capabilities` | **200** — `media.decoding: true`, `transcription.available: true` |
| Chat (real provider) | **200** — assistant replied `PROVIDER_OK` |
| Transcription (20.8 s real speech) | **200 in 39 s** — real transcript, 1 turn, coverage 1.0 |
| Transcript owner retrieval | **200** |
| Transcript other-user retrieval | **404** (owner isolation) |
| Transcript no-session retrieval | **401** |

**Transcription transcript (production, real audio):**
`[00:00 – 00:21] Speaker 1: The quarterly planning meeting opened at 9:00. [inaudible] confirmed that the migration to the new billing system is complete. We decided to launch the customer portal on the 14th of November. …`

The transcript header honestly states *"Speakers detected: 1 (provider did not distinguish …)"* — **no speaker diarisation is claimed**.

---

## 5. Remaining blockers / unverified

1. **`npm test` full completion** — BLOCKED by the 2 GB sandbox cgroup cap (OOM at the 25-minute-audio fixture). Needs a > 2 GB container. The suite itself is healthy; no test was weakened.
2. **Speaker diarisation** — **NOT IMPLEMENTED**; not claimed anywhere.
3. **Android APK rebuild** — no Android/Gradle project exists in the repository (only a prebuilt signed APK); a reproducible rebuild is **NOT IMPLEMENTED**. No APK was built or installed in this run.
4. **Gemini quota** — the account's free-tier quota is exhausted for some models (429). Transcription succeeds on the live flash model; sustained throughput depends on the account's quota/billing.

---

*Produced from real tool responses only. No secrets are included. No production schema was altered, no destructive migration was run, `main` was not merged, the branch was not force-pushed or reset, and `Rare-Erudite/RARE-INTELLIGENCE-MODEL` was not touched.*
