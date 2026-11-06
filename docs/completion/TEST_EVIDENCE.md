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
- No final APK has been built. The release emulator matrix and final production deployment smoke checks have not run.
- Full repository-history secret scanning and exhaustive per-route authorization review are still outstanding.

## Continuation identity and CI check — 2026-11-06

| Check | Outcome | Evidence / limit |
|---|---|---|
| Local repository recovery | PASS | Clean feature branch at 5e96b5b32db0aeb369e033d7c5f784d390ab8249; local and remote feature tips match after fetch. main equals remote 64cd88a54b1c031dabb2edb3ba5832a39ec17b61. Bundle verification succeeded and includes complete history. |
| GitHub Actions run #42 | CANCELLED | Exact SHA `5e96b5b32db0aeb369e033d7c5f784d390ab8249`. Windows typecheck/build/full tests/browser checks passed. Ubuntu was canceled during FFmpeg install; the queued APK job was canceled before any step. No APK was produced. [Run #42](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42239482331). |
| Published APK signature verification | PASS | Downloaded official 1.1.0 and 1.1.1 assets to a temporary directory and ran Android SDK 36 apksigner verify --verbose --print-certs. Both report SHA-256 c550fd6549d7bbdf2201f9578efb143128f925cf7f8830ddffd349f4995bc57b; both have valid v1/v2/v3 signatures. |
| Legacy/replacement signing identity | RESOLVED FOR CLEAN INSTALL | Fingerprint-only audit found the prior Actions key matched the incompatible 92:85… key. No original signer backup was found. New RSA-4096 identity `37be10e99449fbc5f90331965905e8d2ccd31a446301eafa20620f11badee1df` is stored in GitHub secrets; audit run [#42258248165](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42258248165) printed only its fingerprint. |
| Replacement key backup | PASS | Encrypted PKCS#12 key lives outside Git under `Documents\Codex\RARE-Signing-Backup`; password is DPAPI CurrentUser-protected. Decryption/reopen matched the key fingerprint. The local temporary JAR signed and verified with the new key/password. No APK was built. |
| Ordinary CI correction | PASS | APK signing/build/emulator job removed from `.github/workflows/ci.yml`; development CI contains no APK packaging job. |
| Release workflow | REGISTERED, TAG NOT RUN | Branch workflow parses and is present in GitHub. Tag pushes and manual dispatch are configured with frozen-source, readiness, exact-SHA CI, and published-signer gates. No release tag or APK workflow execution was started; the minimum/API 33/API 36 emulator stages remain unrun. |
| Run #42 final status | CANCELLED | Windows job passed. Ubuntu job was canceled while installing FFmpeg. Its queued Android APK job started with zero steps and was canceled before package operations. No APK was produced. [Run #42](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42239482331). |
| Earlier release-workflow push runs | FAILED, ZERO JOBS | Runs [#42250019086](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42250019086) and earlier had no jobs or steps. Empty `env:` mappings on three emulator steps were removed. The corrected workflow does not run on a normal branch push. |
| Development CI run 42250587710 | PASS | Exact implementation commit `e4bd90b3a73892c6a113c2c54de07ab56cc0cd84`; Ubuntu and Windows typecheck, production build, complete test suite, and desktop/mobile browser checks passed. No APK job ran. [Run](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42250587710). |
| Development CI run 42256481013 | PASS | Exact committed checkpoint `a26821d00ddc2fc2cdf5fec8e534109f66cdbc29`; both Ubuntu and Windows typecheck, production build, full suite, and Chromium desktop/mobile browser checks passed. [Run](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42256481013). |

## Final continuation local verification — 2026-11-06

| Check | Outcome | Scope and limit |
|---|---|---|
| `npm run lint` | PASS | Updated server, release resolver, and download UI typecheck. |
| `npm run build` | PASS | Web and server bundles built. Vite retains its large-chunk advisory. |
| `npm test` | PASS | Full Windows suite passed; includes new tests for release tag, asset URL, and checksum pairing. Real diarisation inference remains skipped because model access is unavailable. |
| `npm run test:e2e` | PASS (3 passed, 1 skipped) | Chromium signup/session workflow plus phone-sized layout checks passed. The mobile variant of the desktop registration scenario is intentionally skipped; its mobile-specific smoke test passed. |
| Release download path | PASS (unit scope) | Resolver rejects a wrong checksum filename and non-official asset URLs; no final GitHub APK release exists yet, so live asset delivery remains unverified. |
| Current-source remote CI | PASS on `aefc54c` | The release-asset/update and download-screen changes were pushed and passed exact-SHA CI. Expanded Firefox/WebKit/Android browser coverage is a later local change and needs its own run. |
| Exact-SHA remote CI run 42264720816 | PASS | Commit `aefc54c23ce7ec49c983a9e1f499195248ee2914` passed Ubuntu and Windows typecheck/build/full suite and Chromium desktop/mobile browser checks. [Run](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42264720816). |
| Expanded browser and Android-browser CI | CONFIGURED, NOT RUN | CI source is being expanded to Ubuntu Chromium/Firefox/WebKit, Windows Chrome/Firefox, and an Android 13 Chrome browser smoke using the local development server. The Android job does not package an APK. A new exact-SHA run is required. |

## Diarisation worker authentication review

| Check | Outcome | Evidence / limit |
|---|---|---|
| Worker auth fail-closed patch | PASS (local) | Missing WORKER_TOKEN makes startup skip model loading and makes POST /diarize return 503 AUTH_NOT_CONFIGURED; unset/wrong bearer returns 401; a synthetic valid test token reached a stubbed inference handler. Pyannote was not imported or run. |
| Worker Python syntax | PASS | python -m py_compile succeeded for server.py and diarize_offline.py. Generated __pycache__ was removed. |
| Worker deployment/model | NOT VERIFIED | No production host, model credentials, inference, or live service is configured. |

## History and sensitive-data review — 2026-11-06

| Check | Outcome | Evidence / limit |
|---|---|---|
| GitHub secret-scanning alerts | 0 alerts | Repository API returned an empty alert list. This does not prove every secret type is detected. |
| Redacted Git object scan | No high-confidence credential patterns | Scanned 1,902 unique objects across reachable Git history; excluded binary and over-32-MiB blobs. Matches were test fixture assignments and example database URLs; all matched values carried test/example/local markers. Values were never printed. This is a targeted heuristic, not a claim that a commercial scanner was run. |
| Historical runtime state | Synthetic test data identified | Historical `.rare/state/persistent-documents.json` snapshots contained hundreds of `example`/`.test` test accounts, password hashes, hashed sessions, and synthetic document/memory/conversation state. One non-reserved Google-provider test identity exactly matched a checked-in test fixture. No production identity or plaintext password was found by the checks above. The file is removed from current source (commit `56eaad8`); shared history was preserved. |
