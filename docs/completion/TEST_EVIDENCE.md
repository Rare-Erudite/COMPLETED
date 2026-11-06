# Test evidence

## Current local verification

| Check | Outcome | Scope and limit |
|---|---|---|
| Git recovery | PASS | Both recovery commits remain ancestors of `New-Fixes-by-Erudite`; `main` was not modified. Verified bundle contains the local refs/history. |
| `npm ci --no-audit --no-fund --fetch-retries=3 ...` | PASS | Lockfile install completed after retrying a transient ONNX runtime CDN reset. Registry TLS verification remained enabled. |
| `npm run lint` | PASS | Current TypeScript source typechecks. |
| `npm run build` | PASS | Current Vite web build and server bundle complete. Vite reports a large JavaScript chunk warning. |
| `npm test` | PASS | Full runner ended with `ALL AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY`; includes auth/security, ownership, documents, research, project/build, update store, Windows media executables, and serverless SPA fallback. |
| `npm run test:e2e` | PASS | Desktop local signup/session reload/workspace/settings path passes; desktop and mobile viewport/account-entry checks pass. One duplicate signup path is intentionally skipped on mobile; mobile gets its own smoke test. |
| CI YAML parse | PASS | Workflow parses locally. This is not a substitute for an actual Actions run. |
| Windows APK packaging path | PARTIAL PASS | Android 36/JBR 25 built fresh web assets, Java, DEX, resources, and an aligned APK; the test intentionally stopped at signing with an invalid local-only password. No signed artifact was produced. CI must prove real signing. |
| `bash -n scripts/build_apk.sh` | PASS | APK shell syntax parses under Git Bash. |
| Android SDK manager API 33 install | FAIL | Android CLI could not establish a loopback connection under the installed JDK runtime; no local API 33 image was installed. CI now provisions Android 13. |

## Test limits

- The real pyannote model test was skipped because pyannote/HF credentials are not configured; the service's unavailable response and no-guessing behavior passed.
- No live email, SMS, WhatsApp, Google/Microsoft OAuth, Supabase database/RLS, Gemini, or production login was tested. Local browser registration uses an isolated local fallback store only.
- The E2E registration test verifies one ordinary test account. Multi-role and production cross-user authorization remain broader release checks, though existing document ownership tests pass.
- No APK has yet been built, signed, installed, or updated by the new CI workflow. No emulator, physical device, or production deployment result is claimed until the Actions run completes.
- Full repository-history secret scanning and exhaustive per-route authorization review are still outstanding.

## Continuation identity and CI check — 2026-11-06

| Check | Outcome | Evidence / limit |
|---|---|---|
| Local repository recovery | PASS | Clean feature branch at 5e96b5b32db0aeb369e033d7c5f784d390ab8249; local and remote feature tips match after fetch. main equals remote 64cd88a54b1c031dabb2edb3ba5832a39ec17b61. Bundle verification succeeded and includes complete history. |
| GitHub Actions run #42 | CANCELLED | Exact SHA `5e96b5b32db0aeb369e033d7c5f784d390ab8249`. Windows typecheck/build/full tests/browser checks passed. Ubuntu was canceled during FFmpeg install; the queued APK job was canceled before any step. No APK was produced. [Run #42](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42239482331). |
| Published APK signature verification | PASS | Downloaded official 1.1.0 and 1.1.1 assets to a temporary directory and ran Android SDK 36 apksigner verify --verbose --print-certs. Both report SHA-256 c550fd6549d7bbdf2201f9578efb143128f925cf7f8830ddffd349f4995bc57b; both have valid v1/v2/v3 signatures. |
| Release key comparison | BLOCKED | Repository and scanned Codex Documents contained only .rare/android/rare-release.keystore; its recorded branch fingerprint is 92:85:…:75:2F:92, incompatible with published releases. No original-key backup found in the scanned locations. Secret names were inspected only; secret values were not read. |
| Ordinary CI correction | PUSHED | APK signing/build/emulator job removed from `ci.yml` in commit `2ff57af`; current follow-up tag-trigger refinement is local pending push. |

| Final-release workflow YAML | PASS (static parse) | Tag-triggered `rare-final-v*` workflow parses and is guarded by source/readiness/exact-SHA CI/original-signer checks. Emulator stages API 21, 33, and 36 are configured but not run. |

| Run #42 final status | CANCELLED | Windows job passed. Ubuntu job was canceled while installing FFmpeg. Its queued Android APK job started with zero steps and was canceled before package operations. No APK was produced. [Run #42](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42239482331). |
| Push-triggered release workflow attempt | FAILED, NO JOBS | Prior `workflow_dispatch` version produced zero-job failures on pushes `2ff57af` and `9e31a6f`; no APK steps ran. The workflow is now tag-triggered only, pending remote validation. |
 |

| Development CI run 42244520578 | PASS | Exact commit 9e31a6f43cfe413f285c5112cb2a300e1a21eaab; Ubuntu and Windows typecheck, production build, complete test suite, and desktop/mobile browser checks passed. It contains no APK job. [Run](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42244520578). |

## Diarisation worker authentication review

| Check | Outcome | Evidence / limit |
|---|---|---|
| Worker auth fail-closed patch | PASS (local) | Missing WORKER_TOKEN makes startup skip model loading and makes POST /diarize return 503 AUTH_NOT_CONFIGURED; unset/wrong bearer returns 401; a synthetic valid test token reached a stubbed inference handler. Pyannote was not imported or run. |
| Worker Python syntax | PASS | python -m py_compile succeeded for server.py and diarize_offline.py. Generated __pycache__ was removed. |
| Worker deployment/model | NOT VERIFIED | No production host, model credentials, inference, or live service is configured. |

| Tag-only release workflow on development push | FAIL, ZERO JOBS | Run 42246444275 on baaaeecb75ebd738f6ff96c81ad31ed8f4ab119 is a failed push event with no jobs/steps and no APK. The local YAML parses, but remote workflow validation still needs resolution before a final tag is created. |
