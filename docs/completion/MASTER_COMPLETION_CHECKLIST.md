# RARE completion checkpoint

**Updated:** 2026-11-06 (Africa/Lagos)

**Working branch:** `New-Fixes-by-Erudite`

**Recovery ancestry:** `9bd823f` and `e5895b5` remain ancestors of the recovered branch. `main` remains unchanged. The pre-edit Git bundle is verified at `C:\Users\Secondary\Documents\Codex\2026-11-06\t\work\rare-recovery-e5895b5-20261106-143829.bundle`.

## Current result

Local source recovery and regression verification are complete for the current implementation checkpoint. Typecheck, production web/server build, the full automated suite, and desktop/mobile browser checks pass. A duplicate server initialization found by browser testing was fixed. The ordinary-CI Android packaging job has been removed. The release workflow accepts manual dispatch or an explicit `rare-final-v*` tag and retains source, completion, security, CI, and signer gates. No APK has been produced by this work.

The full release objective is **not complete**. The current committed checkpoint `a26821d` passed Ubuntu and Windows source CI in run [#42256481013](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42256481013). Later local changes now resolve APK downloads/update metadata from a checksum-verified official GitHub release, remove old unverified APK/EXE binaries and unsupported installer claims, and include focused regression tests; those changes still need an exact-SHA remote CI run. The final workflow requires the release tag to equal deployed `main`, a successful exact-SHA Production deployment, health commit attestation, healthy PostgreSQL, and all source/security/readiness checks. The old signer was not recoverable; the owner-authorized RSA-4096 replacement identity is SHA-256 `37be10e99449fbc5f90331965905e8d2ccd31a446301eafa20620f11badee1df`. Its Actions secrets and DPAPI backup were verified; a temporary JAR signed and verified successfully. No APK was built. Prior APKs require a clean-install transition.

## Checklist

- [x] Independently verify the recovered history and the damaged remote feature tip; preserve local `main`.
- [x] Create and verify a Git bundle before further edits.
- [x] Restore complete source implementations and reapply documented branch fixes.
- [x] Reinstall dependencies from the lockfile (`npm ci`).
- [x] Pass `npm run lint` and `npm run build` after current code changes.
- [x] Pass the full `npm test` suite on Windows, including Documents, Research, Project & Build, and media probes.
- [x] Add release asset resolver tests; require the official APK asset and matching checksum before making downloads/update metadata available.
- [x] Remove unsupported Windows executable and standalone package claims; remove old incompatible APK/EXE binaries from current source distribution.
- [x] Pass desktop/mobile Chromium E2E on the current local source (3 passed, 1 intentionally skipped).
- [x] Add real-browser coverage for local registration, session persistence, workspace navigation, and mobile layout.
- [x] Fix duplicate server initialization found during browser verification.
- [x] Add Windows CI and browser verification.
- [x] Remove APK packaging from ordinary CI; the queued Android job in run #42 was canceled before any steps, and the new workflow has no Android packaging job.
- [ ] Validate the final workflow against a deliberately frozen, successfully deployed production commit; do not trigger it before every application gate passes.
- [x] Replace the unrecoverable legacy signer as owner-authorized; generate one RSA-4096 key, verify a DPAPI-protected owner backup, update GitHub secrets, and confirm its fingerprint with a no-artifact workflow.
- [x] Commit and push the release-workflow correction; source CI passes on the exact implementation commit and ordinary pushes no longer start release jobs.
- [x] Document the one-time clean-install transition for older APK installs; this replacement signer cannot update them in place.
- [ ] Verify live Supabase/PostgreSQL ownership and RLS, real OAuth/provider flows, and production connectivity without sending uncontrolled messages.
- [ ] Deploy and verify real diarisation inference or keep service unavailable; worker auth is fixed, but no model inference/deployment has passed.
- [ ] Complete exhaustive screen/route/control review and physical Android 13 checks.
- [ ] Reconcile against current `main`, and only after every release gate passes, merge/deploy once and run production smoke checks.

## Environment and release limits

- GitHub CLI authentication is valid and repository Actions secrets have been configured. No GitHub token value is stored in source or this document.
- The local Android SDK has platform 36/build-tools 36.0.0 and Android Studio JDK 25. The local SDK manager failed while trying to add API 33, and no AVD or connected device is currently available. CI now owns the API 33 emulator check.
- Local auth/browser tests use isolated local storage and do not call email, SMS, WhatsApp, OAuth, Supabase, or a live AI provider.
- The diarisation suite passed its honest unavailable-provider checks; the real pyannote inference test was skipped because that package/model credential is not configured.
- No production deployment, database migration, GitHub release, or production account operation has been performed.

See [FEATURE_VERIFICATION_MATRIX.md](FEATURE_VERIFICATION_MATRIX.md), [TEST_EVIDENCE.md](TEST_EVIDENCE.md), [SECURITY_REVIEW.md](SECURITY_REVIEW.md), [RELEASE_READINESS.md](RELEASE_READINESS.md), and [BLOCKERS_AND_OWNER_ACTIONS.md](BLOCKERS_AND_OWNER_ACTIONS.md).
