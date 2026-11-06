# Blockers and owner actions

1. **Rotate the credentials shared in chat.** Revoke/rotate the Vercel and GitHub tokens, Supabase keys/database password, Hugging Face token, and developer key before any use. Do not paste replacement secrets into source files or documentation.
2. **Restore GitHub authentication.** Reauthenticate `gh` with the required repository/workflow permissions so the remote branch can be fetched, CI can be observed, and release reconciliation can be performed.
3. **Provide/restore the permanent Android signing key in the approved secret store.** The posted credentials do not include the release keystore. Without the existing signing identity, a compatible update APK cannot be produced.
4. **Restore package registry access or prepopulate the npm cache.** `npm ci` failed with `ECONNRESET`, and offline installation lacks `onnxruntime-node@1.30.0`; final checks depend on a complete dependency install.
5. **Enable the diarisation model credentials if the service requires them.** No real pyannote model inference was verified in this session.
6. **Connect a physical Android device for native voice, installer/update, permissions, and production-backend checks.** Emulator/physical hardware status must be reported separately.

Independent local source repair and test-runner fixes are complete. The release-dependent work remains blocked until the external credentials and environments are refreshed.
