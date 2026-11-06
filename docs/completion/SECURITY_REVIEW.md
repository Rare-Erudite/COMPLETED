# Security review checkpoint

## Checks completed

- The damaged feature tip contained placeholder replacements; the working branch was restored from the intact local `main` snapshot while preserving recovery commits and ancestry.
- Existing code has session-cookie/CSRF checks, server-side developer-session gates, owner-scoped storage, and database migrations. The complete automated security/authentication and document-ownership tests pass locally. This is not a full security certification.
- Local browser registration uses an isolated temporary file-backed store. It does not send email/SMS, call OAuth, or touch Supabase.
- The app's client version now comes from the build constant; prior localStorage cannot spoof an older or newer installed version.
- Browser checks exposed and fixed duplicate server initialization in the local entrypoint; one initialization promise is now shared with exported readiness.
- APK downloads retain SHA-256 verification. This check complements Android signing; it does not prove a trusted signer by itself.
- A newer Android signing key is recorded in `docs/ANDROID_BUILD.md`, but its fingerprint differs from the certificates on the published APKs. It must not be used for updates unless a compatible rotation is proven.
- The credentials posted in the conversation are omitted from this report and were not used. Rotate them before use. One earlier verification note contained a redacted token prefix and should not be interpreted as a usable credential.
- The independent `RARE-INTELLIGENCE-MODEL` repository was not modified.

## Remaining review

History-wide secret scanning; complete route-by-route authorization/data-flow review; live Supabase grants/RLS and cross-user tests; OAuth/session/recovery lifecycle with controlled accounts; CORS/origin policy for native clients; rate limits and upload/path validation; worker authentication; real provider behavior; production failure behavior; and actual signed APK/emulator/device evidence remain outstanding.

## Android release identity investigation — 2026-11-06

- Downloaded the two official public release APKs to a temporary directory outside the repository and verified each using Android SDK 36 apksigner verify --verbose --print-certs.
- Both v1.1.0-android and v1.1.1-android have the same SHA-256 signing certificate: c550fd6549d7bbdf2201f9578efb143128f925cf7f8830ddffd349f4995bc57b.
- This does not match the newer 92:85:…:75:2F:92 certificate recorded for the branch's new permanent key. That key must not sign an update to existing installs.
- Only the new local keystore file was found in the repository and scanned Codex Documents. Configured Actions secret names were inspected without reading values. The original signing private key remains unrecovered; Android signing-key rotation compatibility has not been established. APK release stays blocked.
- Ordinary CI no longer contains APK build/sign steps. Run #42 queued an Android job that was canceled before any step when a newer push superseded it; no APK was built. Source CI run [#42250587710](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42250587710) passed on `e4bd90b3a73892c6a113c2c54de07ab56cc0cd84`.

- A separate final APK workflow is registered with tag and manual triggers and checks the frozen source, exact source CI, completion/security records, and legacy signer fingerprint before packaging. The corrected workflow does not run on ordinary branch pushes. Its configured emulator matrix is not evidence until actually run. It creates no candidate APK during ordinary CI.

## Diarisation worker authentication — 2026-11-06

- Static review found a fail-open check: the worker enforced WORKER_TOKEN only when it was nonempty. If unset, /diarize accepted unauthenticated requests. This is now fixed: missing token returns typed 503 and disables model preload, invalid/missing bearer returns 401, and comparison uses hmac.compare_digest.
- Local HTTP smoke check verified missing, wrong, and synthetic-valid bearer behavior. The valid path used a stubbed inference function; no audio model or external request ran. Python syntax checks passed.
- The worker remains undeployed; real pyannote inference and production authentication are unverified.

- Earlier development pushes yielded failed zero-job release workflow runs because emulator steps had empty `env:` blocks. Those mappings have been removed. GitHub currently recognizes the corrected branch workflow, and a normal push no longer invokes it. No release tag has been created; do not trigger the final workflow until the signing identity and readiness gates are resolved.
