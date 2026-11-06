# Release readiness

**Release gate: NOT PASSED. No merge or production deployment has been performed.**

| Gate | Status | Evidence / remaining work |
|---|---|---|
| Recovery preservation | PASS | Verified recovery ancestry and Git bundle; `main` remains intact. |
| Local dependencies/typecheck/build | PASS | Lockfile install, TypeScript check, web build, and server bundle pass on current source. |
| Full automated suite | PASS (local) | Full Windows run completed successfully; one real diarisation model check is explicitly skipped. |
| Browser E2E | PASS (local) | Desktop registration/session/workspace/settings flow and desktop/mobile responsive smoke checks pass. |
| Server startup | PASS (local) | One shared initialization promise fixes the duplicate-listener startup error discovered by browser testing. |
| Remote branch and CI | PENDING | Current local changes need a verified commit and push; inspect Ubuntu, Windows, and Android 13 jobs after push. |
| Permanent Android signing | CONFIGURED | New stable key; SHA-256 certificate fingerprint `92:85:A1:E7:80:3E:D7:80:91:68:E9:51:AD:09:D2:C8:51:F3:AC:21:AF:04:04:48:96:B6:82:72:05:75:2F:92`; key directory is gitignored and signing material is stored in encrypted GitHub Actions secrets. |
| Fresh Android APK | PENDING | CI is configured to build 1.1.2 from source, install a candidate on API 33, rebuild same source/key at a higher version code, and update without uninstalling. Await actual artifacts and results. |
| Supabase/RLS and live auth/providers | NOT VERIFIED | No production credentials from chat were used. Exercise with rotated credentials and controlled test accounts before release. |
| Diarisation worker | NOT VERIFIED | Real pyannote inference and deployment remain unverified. |
| Physical Android device | NOT VERIFIED | No Android 13 phone is connected; do not claim device certification. |
| Production deployment | NOT DONE | Wait for CI, fresh APK/emulator proof, live-service checks, security review, and branch reconciliation first. |

Keep changes on `New-Fixes-by-Erudite`. Do not merge or deploy until every required release gate has evidence and the deployed commit is the final reviewed `main` commit.
