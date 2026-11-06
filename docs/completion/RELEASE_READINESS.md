# Release readiness

**Release gate: NOT PASSED. No merge or production deployment has been performed.**

| Gate | Status | Evidence / remaining work |
|---|---|---|
| Recovery preservation | PASS | Verified recovery ancestry and Git bundle; `main` remains intact. |
| Local dependencies/typecheck/build | PASS | Lockfile install, TypeScript check, web build, and server bundle pass on current source. |
| Full automated suite | PASS (local) | Full Windows run completed successfully; one real diarisation model check is explicitly skipped. |
| Release asset/update regression | PASS (local) | New mocked GitHub release tests accept only the official tagged APK plus a matching filename/checksum pair; mismatched names and untrusted asset URLs are rejected. Download and update endpoints no longer select retired bundled APKs. |
| Download screen / unsupported Windows installer | FIXED (local) | Removed unsupported Windows EXE claims and old unverified APK binaries; unavailable release downloads now report the real failure. |
| Browser E2E | PASS (local) | Desktop registration/session/workspace/settings flow and desktop/mobile responsive smoke checks pass. |
| Server startup | PASS (local) | One shared initialization promise fixes the duplicate-listener startup error discovered by browser testing. |
| Remote branch and CI | PASS on committed checkpoint | Run [#42256481013](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42256481013) passed Ubuntu and Windows typecheck, build, full suite, and browser checks on `a26821d00ddc2fc2cdf5fec8e534109f66cdbc29`. Later release-asset/UI edits are still local and require an exact-SHA CI run. `main` remains unchanged. |
| Exact-SHA CI for APK delivery fix | PASS | Run [#42264720816](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42264720816) passed Ubuntu and Windows typecheck/build/full suite and Chromium desktop/mobile checks on `aefc54c23ce7ec49c983a9e1f499195248ee2914`. A later CI expansion to Firefox/WebKit and Android 13 Chrome browser coverage is local and still needs its own run. |
| Android release signing identity | PASS (replacement key) | Owner-authorized RSA-4096 identity `37be10e99449fbc5f90331965905e8d2ccd31a446301eafa20620f11badee1df`; GitHub fingerprint audit, DPAPI backup restore, and temporary JAR signing passed. It requires clean installs over prior releases. |
| Fresh Android APK | NOT BUILT (gated) | Ordinary CI has no APK packaging. Final build waits for complete application/security/data checks, merge, successful production deployment, exact-SHA health attestation, and emulator matrix. |
| Supabase/RLS and live auth/providers | NOT VERIFIED | No production credentials from chat were used. Exercise with rotated credentials and controlled test accounts before release. |
| Diarisation worker | BLOCKED | Unauthenticated inference is now rejected and authentication smoke checks pass, but the worker has not been deployed and no real pyannote inference has passed. |
| Physical Android device | NOT VERIFIED | No Android 13 phone is connected; do not claim device certification. |
| Production deployment | NOT DONE | Wait for CI, fresh APK/emulator proof, live-service checks, security review, and branch reconciliation first. |

Keep changes on `New-Fixes-by-Erudite`. Do not merge or deploy until every required release gate has evidence and the deployed commit is the final reviewed `main` commit.

- Final APK workflow: `.github/workflows/release-apk.yml` requires the tag SHA to equal current `main`, a successful GitHub Production deployment and live `/api/health` commit attestation, healthy PostgreSQL, exact-SHA CI, complete readiness/security/feature records, and the replacement signer before one build. It clean-installs on API 21/33/36, verifies the downloadable checksum, then publishes the APK and checksum as a GitHub Release. No final tag or release run exists; emulator checks have not run.
