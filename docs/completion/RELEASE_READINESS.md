# Release readiness

**Release gate: NOT PASSED. No merge or production deployment has been performed.**

| Gate | Status | Evidence / remaining work |
|---|---|---|
| Recovery preservation | PASS | Verified recovery ancestry and Git bundle; `main` remains intact. |
| Local dependencies/typecheck/build | PASS | Lockfile install, TypeScript check, web build, and server bundle pass on current source. |
| Full automated suite | PASS (local) | Full Windows run completed successfully; one real diarisation model check is explicitly skipped. |
| Release asset/update regression | PASS (local) | New mocked GitHub release tests accept only the official tagged APK plus a matching filename/checksum pair; mismatched names and untrusted asset URLs are rejected. Download and update endpoints no longer select retired bundled APKs. |
| Download screen / unsupported Windows installer | FIXED (local) | Removed unsupported Windows EXE claims and old unverified APK binaries; unavailable release downloads now report the real failure. |
| Browser E2E | PASS (CI) | Ubuntu Chromium/Firefox/WebKit and Windows Chrome/Firefox passed in run [#42273671238](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42273671238); local desktop/mobile responsive checks also pass. |
| Server startup | PASS (local) | One shared initialization promise fixes the duplicate-listener startup error discovered by browser testing. |
| Remote branch and CI | PASS on `3b8b289` for Ubuntu/Windows | Run [#42275918232](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42275918232) passed Ubuntu/Windows typecheck, build, full suite, and browser checks; the Android emulator job was skipped because no owner KVM runner is configured. `main` remains unchanged. |
| Exact-SHA CI for APK delivery fix | PASS on `aefc54c` | Run [#42264720816](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42264720816) passed Ubuntu and Windows typecheck/build/full suite and Chromium desktop/mobile checks. Expanded cross-browser checks passed on `0b3223e` as recorded above. |
| Android emulator coverage | BLOCKED | Runs [#42268192222](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42268192222), [#42270289569](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42270289569), and [#42273671238](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42273671238) confirmed hosted Linux lacks `/dev/kvm` and hosted macOS reports `HV_UNSUPPORTED`. CI and final release emulator jobs require a trusted owner-managed Linux x64 runner labeled `android-emulator` with KVM. The browser smoke job is opt-in with repository variable `RARE_ANDROID_EMULATOR_RUNNER=true`; API 21/33/36 clean-install checks have not run. |
| Android release signing identity | PASS (replacement key) | Owner-authorized RSA-4096 identity `37be10e99449fbc5f90331965905e8d2ccd31a446301eafa20620f11badee1df`; GitHub fingerprint audit, DPAPI backup restore, and temporary JAR signing passed. It requires clean installs over prior releases. |
| Fresh Android APK | NOT BUILT (gated) | Ordinary CI has no APK packaging. Final build waits for complete application/security/data checks, merge, successful production deployment, exact-SHA health attestation, and emulator matrix. |
| Supabase/RLS and live auth/providers | NOT VERIFIED | No production credentials from chat were used. Exercise with rotated credentials and controlled test accounts before release. |
| Diarisation worker | BLOCKED | Unauthenticated inference is now rejected and authentication smoke checks pass, but the worker has not been deployed and no real pyannote inference has passed. |
| Physical Android device | NOT VERIFIED | No Android 13 phone is connected; do not claim device certification. |
| Production deployment | NOT DONE | Wait for CI, fresh APK/emulator proof, live-service checks, security review, and branch reconciliation first. |

Keep changes on `New-Fixes-by-Erudite`. Do not merge or deploy until every required release gate has evidence and the deployed commit is the final reviewed `main` commit.

- Final APK workflow: `.github/workflows/release-apk.yml` requires the tag SHA to equal current `main`, a successful GitHub Production deployment and live `/api/health` commit attestation, healthy PostgreSQL, exact-SHA CI, complete readiness/security/feature records, and the replacement signer before one build. A trusted owner-managed Linux x64 runner labeled `android-emulator` with KVM is required for API 21/33/36 clean installs and checksum verification before publishing. No final tag, APK, or release run exists.
