# RARE completion checkpoint

**Updated:** 2026-11-06 (Africa/Lagos)

**Working branch:** `New-Fixes-by-Erudite`

**Recovery ancestry:** `9bd823f` and `e5895b5` remain ancestors of the recovered branch. `main` remains unchanged. The pre-edit Git bundle is verified at `C:\Users\Secondary\Documents\Codex\2026-11-06\t\work\rare-recovery-e5895b5-20261106-143829.bundle`.

## Current result

Local source recovery and regression verification are complete for the current implementation checkpoint. Typecheck, production web/server build, the full automated suite, and desktop/mobile browser checks pass. A duplicate server initialization found by browser testing was fixed. The ordinary-CI Android packaging job has been removed. A separate tag-triggered release workflow now blocks on the source, completion, security, CI, and signer checks; the tag-only trigger change is staged locally and has not yet been pushed.

The full release objective is **not complete**. Current feature source is at `9e31a6f43cfe413f285c5112cb2a300e1a21eaab`; the branch and remote agree. Run #42 on `5e96b5b32db0aeb369e033d7c5f784d390ab8249` was canceled at 15:35 UTC after a newer development push. Windows passed; Ubuntu stopped during FFmpeg installation; the queued Android APK job was canceled before running any steps. Run [#42244520578](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42244520578) on `9e31a6f43cfe413f285c5112cb2a300e1a21eaab` passed both Ubuntu and Windows typecheck, build, full tests, and desktop/mobile browser checks. The tag-only release trigger correction and matching records are now the pending local changes. The published 1.1.0 and 1.1.1 APKs were verified with `apksigner` and both use SHA-256 certificate `c550fd6549d7bbdf2201f9578efb143128f925cf7f8830ddffd349f4995bc57b`. This differs from the new key fingerprint recorded in the branch (`92:85:…:75:2F:92`). Only the newer local keystore was found; original key recovery and any safe rotation path remain unproven. APK packaging is blocked.

## Checklist

- [x] Independently verify the recovered history and the damaged remote feature tip; preserve local `main`.
- [x] Create and verify a Git bundle before further edits.
- [x] Restore complete source implementations and reapply documented branch fixes.
- [x] Reinstall dependencies from the lockfile (`npm ci`).
- [x] Pass `npm run lint` and `npm run build` after current code changes.
- [x] Pass the full `npm test` suite on Windows, including Documents, Research, Project & Build, and media probes.
- [x] Add real-browser coverage for local registration, session persistence, workspace navigation, and mobile layout.
- [x] Fix duplicate server initialization found during browser verification.
- [x] Add Windows CI and browser verification.
- [x] Remove APK packaging from ordinary CI; the queued Android job in run #42 was canceled before any steps, and the new workflow has no Android packaging job.
- [ ] Validate that GitHub accepts the tag-triggered final-release workflow; branch pushes currently produce failed zero-job runs with no APK steps.
- [x] Generate the permanent Android signing identity, record its SHA-256 certificate fingerprint, and configure encrypted GitHub Actions secrets.
- [ ] Commit and push the CI correction and updated release evidence; inspect the resulting GitHub jobs.
- [ ] Recover the original signing key or prove a supported, compatible rotation path; do not build an APK until resolved.
- [ ] Verify live Supabase/PostgreSQL ownership and RLS, real OAuth/provider flows, and production connectivity without sending uncontrolled messages.
- [ ] Run a real diarisation model or record its service as blocked; worker auth is fixed, but no model inference/deployment has passed.
- [ ] Complete exhaustive screen/route/control review and physical Android 13 checks.
- [ ] Reconcile against current `main`, and only after every release gate passes, merge/deploy once and run production smoke checks.

## Environment and release limits

- GitHub CLI authentication is valid and repository Actions secrets have been configured. No GitHub token value is stored in source or this document.
- The local Android SDK has platform 36/build-tools 36.0.0 and Android Studio JDK 25. The local SDK manager failed while trying to add API 33, and no AVD or connected device is currently available. CI now owns the API 33 emulator check.
- Local auth/browser tests use isolated local storage and do not call email, SMS, WhatsApp, OAuth, Supabase, or a live AI provider.
- The diarisation suite passed its honest unavailable-provider checks; the real pyannote inference test was skipped because that package/model credential is not configured.
- No production deployment, database migration, GitHub release, or production account operation has been performed.

See [FEATURE_VERIFICATION_MATRIX.md](FEATURE_VERIFICATION_MATRIX.md), [TEST_EVIDENCE.md](TEST_EVIDENCE.md), [SECURITY_REVIEW.md](SECURITY_REVIEW.md), [RELEASE_READINESS.md](RELEASE_READINESS.md), and [BLOCKERS_AND_OWNER_ACTIONS.md](BLOCKERS_AND_OWNER_ACTIONS.md).
