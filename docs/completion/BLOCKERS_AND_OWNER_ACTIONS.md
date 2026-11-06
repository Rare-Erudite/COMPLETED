# Remaining release gates and owner actions

**Updated:** 2026-11-06. These are evidence-based gates; none is marked complete without its required proof.

## Work completed in this continuation

- Verified the recovered branch and preserved the recovery bundle before edits. The replacement signer is now configured in GitHub Actions and its fingerprint was independently checked by workflow run [#42258248165](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42258248165).
- The old published signer was not recoverable from the local key or prior Actions secret. The new owner-authorized RSA-4096 identity is `37be10e99449fbc5f90331965905e8d2ccd31a446301eafa20620f11badee1df`; old 1.1.0/1.1.1 installs require uninstall and clean install. No key-rotation lineage is claimed.
- The signing backup is outside Git at `C:\Users\Secondary\Documents\Codex\RARE-Signing-Backup`. The encrypted PKCS#12 file and DPAPI-protected password were restored and checked. The DPAPI password backup depends on the current Windows profile; a portable, owner-controlled offline/password-manager copy remains recommended.
- GitHub reports zero secret-scanning alerts. A redacted heuristic scan covered 1,902 unique reachable Git objects; matches were confined to test/example/local fixtures. Historical `.rare/state/persistent-documents.json` held synthetic test identities/state and a fixture-matching OAuth test identity; no production identity or plaintext password was found. History was preserved and the runtime file was removed from current source.
- Release APK delivery now resolves the latest published official GitHub release, validates its APK asset and checksum asset, and no longer picks bundled historical APKs. Update discovery uses that published metadata. A release must exist before download endpoints return a package.
- The download screen no longer claims a verified Windows executable, a 48.3 MB standalone package, bundled voices, or a started download when no release is available.

## Gates that remain open

1. **Current source CI:** run and inspect Ubuntu/Windows CI on the exact final pushed source SHA after the latest source changes. The earlier implementation run [#42250587710](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42250587710) passed; run [#42256481013](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42256481013) also passed on committed checkpoint `a26821d`. Current release-asset and UI changes still need to be committed, pushed, and checked on their exact SHA.
2. **Production database and authentication:** the available environment has no configured production PostgreSQL URL, OAuth credentials, or database access. Before release, an owner-controlled environment must provide an operational database and controlled test identities so persistence, migrations, RLS/grants, login/recovery, and cross-user isolation can be verified against the actual service.
3. **Production services:** current production health timed out during read-only inspection. Verify production commit attestation, PostgreSQL schema/reachability, and the real chat/document/research endpoints after an approved completed deployment. Do not merge/deploy until application and data gates pass.
4. **Real speaker diarisation:** worker authentication is fail-closed, but the worker has not been deployed and no real pyannote inference has passed. A reachable owner-controlled host, model access, and protected worker credentials are absent. Local unauthenticated/stub tests do not count as inference.
5. **Broad browser/device coverage:** current CI verifies Chromium on Ubuntu and Windows plus responsive local browser flows; it does not cover Firefox, WebKit, Edge, Android browser emulators, tablets, landscapes, physical lifecycle/permissions, or the full screen/control inventory. Android release clean-install checks are configured for API 21/33/36 but have not run.
6. **Final release:** no final source freeze, merge, production deployment, APK build, release tag, or GitHub Release has been created. Do not trigger the release workflow until all required source, security, database, and production gates are evidenced. Its checks require the release tag to equal the deployed `main` SHA, exact-SHA CI, production health/database readiness, signer fingerprint, and API 21/33/36 clean installs.

## Owner action required only for external state

The local agent cannot supply production database/OAuth/provider credentials, a live database, or an always-on diarisation host. Provide approved service configuration through the relevant secret manager and production access when those checks are ready. Never paste replacement secrets or private signing material into source, documentation, or chat. No SMS, WhatsApp, or uncontrolled email should be sent for testing.

## Historical signing evidence

- Published 1.1.0 and 1.1.1 APKs use certificate SHA-256 `c550fd6549d7bbdf2201f9578efb143128f925cf7f8830ddffd349f4995bc57b`.
- The previous Actions secret matched the incompatible `92:85…` identity, verified without exposing key material in run [#42256530544](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42256530544).
- The new fingerprint-only audit is run [#42258248165](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42258248165).
- Android signing references: [apksigner rotation documentation](https://developer.android.com/tools/apksigner) and [Android app-signing documentation](https://developer.android.com/studio/publish/app-signing).
