# Release readiness

**Release gate: NOT PASSED. No merge or production deployment has been performed.**

| Gate | Status | Evidence / remaining work |
|---|---|---|
| Recovery preservation | PASS | Verified recovery ancestry and Git bundle; `main` remains intact. |
| Local dependencies/typecheck/build | PASS | Lockfile install, TypeScript check, web build, and server bundle pass on current source. |
| Full automated suite | PASS (local) | Full Windows run completed successfully; one real diarisation model check is explicitly skipped. |
| Browser E2E | PASS (local) | Desktop registration/session/workspace/settings flow and desktop/mobile responsive smoke checks pass. |
| Server startup | PASS (local) | One shared initialization promise fixes the duplicate-listener startup error discovered by browser testing. |
| Remote branch and CI | IN PROGRESS | Run #42 on exact SHA `5e96b5b32db0aeb369e033d7c5f784d390ab8249`: Windows passed, Ubuntu was still installing FFmpeg; no Android job exists. [Run #42](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42239482331). Local CI correction and evidence updates remain uncommitted. |
| Android release signing identity | BLOCKED | Published 1.1.0 and 1.1.1 APKs verify as certificate SHA-256 `c550fd6549d7bbdf2201f9578efb143128f925cf7f8830ddffd349f4995bc57b`; the new branch key fingerprint `92:85:…:75:2F:92` differs. Original key recovery or a proven supported rotation path is required. |
| Fresh Android APK | BLOCKED | Ordinary CI APK packaging was removed locally. No final-release workflow should build until the original signer or safe rotation is proven and all release gates pass. |
| Supabase/RLS and live auth/providers | NOT VERIFIED | No production credentials from chat were used. Exercise with rotated credentials and controlled test accounts before release. |
| Diarisation worker | NOT VERIFIED | Real pyannote inference and deployment remain unverified. |
| Physical Android device | NOT VERIFIED | No Android 13 phone is connected; do not claim device certification. |
| Production deployment | NOT DONE | Wait for CI, fresh APK/emulator proof, live-service checks, security review, and branch reconciliation first. |

Keep changes on `New-Fixes-by-Erudite`. Do not merge or deploy until every required release gate has evidence and the deployed commit is the final reviewed `main` commit.

- Final APK workflow: `.github/workflows/release-apk.yml` is configured but not run. It blocks until completion/security/feature gates and exact-source CI pass, verifies the original `c550fd…5bc57b` signer before packaging, builds once, then tests in-place update on API 21, 33, and 36.
