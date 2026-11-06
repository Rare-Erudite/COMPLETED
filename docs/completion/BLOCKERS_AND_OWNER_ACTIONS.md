# Remaining release blockers

1. **Rotate the credentials posted in chat before use.** Their values were not copied into files or used for service access. Do not paste replacement credentials into source or documentation.
2. **Run and inspect GitHub Actions.** The current verified source changes need to be committed and pushed to `New-Fixes-by-Erudite`. Confirm Ubuntu, Windows, signing, and Android 13 emulator jobs all pass; repair any real failures.
3. **Deliver the actual fresh APK.** After CI succeeds, download its artifact and record APK size, SHA-256, package ID, version name/code, backend URL, and certificate fingerprint. Verify the emulator candidate-to-final in-place update from the action logs.
4. **Verify live service integrations with rotated credentials.** Test Supabase/PostgreSQL, RLS, OAuth, configured model providers, and production backend with isolated test accounts. Do not send uncontrolled SMS, WhatsApp, or email.
5. **Complete diarisation.** Real pyannote inference/deployment remains unavailable in the current environment; keep the limitation explicit unless provisioned and verified.
6. **Complete device and breadth checks.** No local Android 13 AVD or physical Infinix device is connected. CI is configured for emulator API 33; physical permissions, audio/voice, restart/session, and update checks still need a device.
7. **Finish branch reconciliation and release review.** Compare fresh `main`/feature refs and run history-wide secret scanning plus exhaustive route/UI authorization review before any merge or deployment.

Local npm registry install, typecheck, builds, full automated tests, desktop/mobile browser checks, GitHub authentication, and permanent signing-secret setup are complete. They do not clear the blockers above.
