# Release readiness

**Release gate: NOT PASSED. No merge or production deployment has been performed.**

| Gate | Status | Evidence / remaining work |
|---|---|---|
| Recovery preservation | PASS | Verified recovery ancestry and Git bundle; `main` remains intact. |
| Local dependencies/typecheck/build | PASS | Lockfile install, TypeScript check, web build, and server bundle pass on current source. |
| Full automated suite | PASS (local) | Full Windows run completed successfully; one real diarisation model check is explicitly skipped. |
| Browser E2E | PASS (local) | Desktop registration/session/workspace/settings flow and desktop/mobile responsive smoke checks pass. |
| Server startup | PASS (local) | One shared initialization promise fixes the duplicate-listener startup error discovered by browser testing. |
| Remote branch and CI | PASS on `fb7eace`; pending workflow correction | Run [#42249021899](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42249021899) passed Ubuntu and Windows typecheck, build, full suite, and browser checks on `fb7eaced151d6cc066ec9d6d95b138ed1f59f6b1`. The manual-only release workflow correction is not yet pushed and requires its own CI run. Run #42 cancellation is recorded separately. |
| Android release signing identity | BLOCKED | Published 1.1.0 and 1.1.1 APKs verify as certificate SHA-256 `c550fd6549d7bbdf2201f9578efb143128f925cf7f8830ddffd349f4995bc57b`; the new branch key fingerprint `92:85:…:75:2F:92` differs. Original key recovery or a proven supported rotation path is required. |
| Fresh Android APK | BLOCKED | Ordinary CI APK packaging was removed locally. No final-release workflow should build until the original signer or safe rotation is proven and all release gates pass. |
| Supabase/RLS and live auth/providers | NOT VERIFIED | No production credentials from chat were used. Exercise with rotated credentials and controlled test accounts before release. |
| Diarisation worker | BLOCKED | Unauthenticated inference is now rejected and authentication smoke checks pass, but the worker has not been deployed and no real pyannote inference has passed. |
| Physical Android device | NOT VERIFIED | No Android 13 phone is connected; do not claim device certification. |
| Production deployment | NOT DONE | Wait for CI, fresh APK/emulator proof, live-service checks, security review, and branch reconciliation first. |

Keep changes on `New-Fixes-by-Erudite`. Do not merge or deploy until every required release gate has evidence and the deployed commit is the final reviewed `main` commit.

- Final APK workflow: `.github/workflows/release-apk.yml` is intended to be manual-only and accept an explicit frozen `rare-final-v*` tag. It gates completion/security/feature records, exact-source CI, and the original `c550fd…5bc57b` signer before one build. Earlier branch pushes reported failed zero-job runs; remote validation of the manual-only correction is pending. Emulator checks are configured for API 21, 33, and 36 but have not run.
