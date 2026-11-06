# Security review checkpoint

## Findings and checks

- The current development branch had core source files replaced by placeholder markers. They were restored from the intact local `main` snapshot before further changes.
- Existing code contains session-cookie/CSRF checks, server-side developer-session gates, owner-scoped persistence, and database migrations. Only partial automated auth/security tests ran; this is not a complete security certification.
- The developer access request UI previously claimed email dispatch. The response and UI were changed to say the request was recorded; an email delivery provider was not verified.
- The developer contact address is now read from `/api/status` by the client, with server configuration through `RARE_OWNER_EMAIL`.
- The APK downloader now verifies a server-provided SHA-256 when Web Crypto is available. This is an integrity check, not proof of Android signing identity.
- No final history-wide secret scan or live Supabase RLS test was completed. No claim of a clean secret history is made.
- The owner supplied several live-looking service credentials in the chat. Their values are intentionally omitted from this report and were not written to source or deployment configuration. Rotate/revoke them before use because they were exposed in the conversation.
- The independent `RARE-INTELLIGENCE-MODEL` repository was not modified.

## Still requiring verification

Cookie/session lifecycle and recovery, authorization on all routes, cross-user isolation, RLS and grants, CORS/origin policy for native clients, rate limits, upload/path validation, worker authentication, secret scanning of repository history, APK certificate identity, and production failure behavior must all be rechecked after dependencies and credentials are available.
