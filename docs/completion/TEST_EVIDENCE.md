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
