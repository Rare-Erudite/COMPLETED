# Security review checkpoint

## Checks completed

- The damaged feature tip contained placeholder replacements; the working branch was restored from the intact local `main` snapshot while preserving recovery commits and ancestry.
- Existing code has session-cookie/CSRF checks, server-side developer-session gates, owner-scoped storage, and database migrations. The complete automated security/authentication and document-ownership tests pass locally. This is not a full security certification.
- Local browser registration uses an isolated temporary file-backed store. It does not send email/SMS, call OAuth, or touch Supabase.
- The app's client version now comes from the build constant; prior localStorage cannot spoof an older or newer installed version.
- Browser checks exposed and fixed duplicate server initialization in the local entrypoint; one initialization promise is now shared with exported readiness.
- APK downloads retain SHA-256 verification. This check complements Android signing; it does not prove a trusted signer by itself.
- A permanent Android signing identity has been created. Its fingerprint is recorded in `docs/ANDROID_BUILD.md`; signing values are held in encrypted GitHub Actions secrets, not source.
- The credentials posted in the conversation are omitted from this report and were not used. Rotate them before use. One earlier verification note contained a redacted token prefix and should not be interpreted as a usable credential.
- The independent `RARE-INTELLIGENCE-MODEL` repository was not modified.

## Remaining review

History-wide secret scanning; complete route-by-route authorization/data-flow review; live Supabase grants/RLS and cross-user tests; OAuth/session/recovery lifecycle with controlled accounts; CORS/origin policy for native clients; rate limits and upload/path validation; worker authentication; real provider behavior; production failure behavior; and actual signed APK/emulator/device evidence remain outstanding.

## Android release identity investigation — 2026-11-06

- Downloaded the two official public release APKs to a temporary directory outside the repository and verified each using Android SDK 36 pksigner verify --verbose --print-certs.
- Both 1.1.0-android and 1.1.1-android have the same SHA-256 signing certificate: c550fd6549d7bbdf2201f9578efb143128f925cf7f8830ddffd349f4995bc57b.
- This does not match the newer 92:85:…:75:2F:92 certificate recorded for the branch's new permanent key. That key must not sign an update to existing installs.
- Only the new local keystore file was found in the repository and scanned Codex Documents. Configured Actions secret names were inspected without reading values. The original signing private key remains unrecovered; Android signing-key rotation compatibility has not been established. APK release stays blocked.
- Ordinary CI's APK-producing job was removed locally. Run #42 on commit 5e96b5b32db0aeb369e033d7c5f784d390ab8249 had no Android job. This workflow correction is not yet committed or pushed.

- A separate manual-only final APK workflow now checks the frozen tag, exact source CI, completion/security gate markers, and legacy signer fingerprint before packaging. It does not run while the current records show blockers. Its configured emulator matrix is not evidence until actually run. It creates no candidate APK during ordinary CI.
