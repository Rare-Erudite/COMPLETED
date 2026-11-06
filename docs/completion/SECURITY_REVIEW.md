# Security review checkpoint

## Checks completed

- The damaged feature tip contained placeholder replacements; the working branch was restored from the intact local `main` snapshot while preserving recovery commits and ancestry.
- Existing code has session-cookie/CSRF checks, server-side developer-session gates, owner-scoped storage, and database migrations. The complete automated security/authentication and document-ownership tests pass locally. This is not a full security certification.
- Local browser registration uses an isolated temporary file-backed store. It does not send email/SMS, call OAuth, or touch Supabase.
- The app's client version now comes from the build constant; prior localStorage cannot spoof an older or newer installed version.
- Browser checks exposed and fixed duplicate server initialization in the local entrypoint; one initialization promise is now shared with exported readiness.
- APK downloads retain SHA-256 verification. This check complements Android signing; it does not prove a trusted signer by itself.
- The published Android signing identity is unavailable. The owner authorized a new permanent release key and clean-install transition; no cryptographic rotation lineage is claimed. The app now resolves packages only from the official published release plus a matching SHA-256 asset, rather than selecting historical APKs bundled in the deployment.
- The credentials posted in the conversation are omitted from this report and were not used. Rotate them before use. One earlier verification note contained a redacted token prefix and should not be interpreted as a usable credential.
- The independent `RARE-INTELLIGENCE-MODEL` repository was not modified.

## Remaining review

The redacted Git-object heuristic scan covered 1,902 unique reachable Git objects, and GitHub's secret-alert API returned zero alerts. Matches were test/example/local fixtures. Historical file-backed snapshots contained synthetic test accounts, hashes, and test document/chat/memory data, including one OAuth identity matching a checked-in fixture; no production identity or plaintext password was found in these checks. The file is removed from current source. Shared history was preserved because no live account was identified. Complete route-by-route authorization/data-flow review; live Supabase grants/RLS and cross-user tests; OAuth/session/recovery lifecycle with controlled accounts; CORS/origin policy for native clients; rate limits and upload/path validation; real provider behavior; production failure behavior; and actual APK/emulator/device evidence remain outstanding.

## Android release identity investigation — 2026-11-06

- Downloaded the two official public release APKs to a temporary directory outside the repository and verified each using Android SDK 36 apksigner verify --verbose --print-certs.
- Both v1.1.0-android and v1.1.1-android have the same SHA-256 signing certificate: c550fd6549d7bbdf2201f9578efb143128f925cf7f8830ddffd349f4995bc57b.
- The original private key was not present in scanned local backup locations; the previous Actions secret was verified by fingerprint only and matched the incompatible 92:85:…:75:2F:92 signer.
- The owner authorized replacing the signer and using a clean-install transition. A new RSA-4096 release identity was generated with SHA-256 `37be10e99449fbc5f90331965905e8d2ccd31a446301eafa20620f11badee1df`. GitHub secrets now match the new certificate (fingerprint-only audit [#42258248165](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42258248165)). The key/password backup is outside Git under the owner account and DPAPI-protected; restore verification and test-JAR signing passed.
- Ordinary CI no longer contains APK build/sign steps. Run #42 queued an Android job that was canceled before any step when a newer push superseded it; no APK was built. Source CI is configured separately from APK packaging.

- A separate final APK workflow is registered with tag and manual triggers. It now requires the release tag to equal current `main`, verifies a successful Production deployment and exact commit from the live health endpoint, requires healthy database status and release gates, checks the replacement signer, clean-installs on API 21/33/36, verifies the downloadable checksum, and publishes a GitHub Release only after all checks pass. The workflow has not been run for a final tag.

## Diarisation worker authentication — 2026-11-06

- Static review found a fail-open check: the worker enforced WORKER_TOKEN only when it was nonempty. If unset, /diarize accepted unauthenticated requests. This is now fixed: missing token returns typed 503 and disables model preload, invalid/missing bearer returns 401, and comparison uses hmac.compare_digest.
- Local HTTP smoke check verified missing, wrong, and synthetic-valid bearer behavior. The valid path used a stubbed inference function; no audio model or external request ran. Python syntax checks passed.
- The worker remains undeployed; real pyannote inference and production authentication are unverified.

- Earlier development pushes yielded failed zero-job release workflow runs because emulator steps had empty `env:` blocks. Those mappings have been removed. A normal push no longer invokes the final release workflow. No final release tag has been created; database, provider, application-breadth, and production-verification gates remain incomplete.
