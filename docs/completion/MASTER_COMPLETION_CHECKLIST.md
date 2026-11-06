# RARE completion checkpoint

**Updated:** 2026-11-06 (Africa/Lagos)

**Working branch:** `New-Fixes-by-Erudite`

**Recovery ancestry:** `9bd823f` and `e5895b5` remain ancestors of the recovered branch. `main` remains unchanged. The pre-edit Git bundle is verified at `C:\Users\Secondary\Documents\Codex\2026-11-06\t\work\rare-recovery-e5895b5-20261106-143829.bundle`.

## Current result

Local source recovery and regression verification are complete for the current implementation checkpoint. Typecheck, production web/server build, the full automated suite, and desktop/mobile browser checks pass. A duplicate server initialization found by browser testing was fixed. The ordinary-CI Android packaging job has been removed. The release workflow is being changed to a manual-only trigger and retains source, completion, security, CI, and signer gates. No APK has been produced by this work.

The full release objective is **not complete**. Before the current workflow correction, branch pushes generated failed release workflow runs with zero jobs (latest: [#42249019422](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42249019422)); no APK steps ran. Source CI [#42249021899](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42249021899) passed Ubuntu and Windows typecheck, build, full tests, and desktop/mobile browser checks on `fb7eaced151d6cc066ec9d6d95b138ed1f59f6b1`. The pending workflow correction changes the release trigger to manual-only; verify the pushed workflow registration and source CI on the correction commit. The published 1.1.0 and 1.1.1 APKs were verified with `apksigner` and both use SHA-256 certificate `c550fd6549d7bbdf2201f9578efb143128f925cf7f8830ddffd349f4995bc57b`. This differs from the new key fingerprint recorded in the branch (`92:85:…:75:2F:92`). Only the newer local keystore was found; original key recovery and any safe rotation path remain unproven. APK packaging is blocked.

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
- [ ] Validate that GitHub accepts the manual-only final-release workflow; previous branch-push events produced failed zero-job runs with no APK steps.
- [ ] Recover the published Android signing identity; the newly generated key fingerprint does not match the published APKs.
- [ ] Commit and push the release-workflow correction and updated evidence; inspect the resulting GitHub Actions runs.
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
