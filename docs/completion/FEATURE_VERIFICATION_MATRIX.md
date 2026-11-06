# Feature verification matrix

Statuses describe evidence for the current local implementation checkpoint. Local tests do not prove live production configuration.

| Area | Status | Evidence / remaining work |
|---|---|---|
| Repository and branch | PASS (local) | Recovered branch ancestry and verified backup; `main` untouched. Push/CI result pending. |
| Core source integrity | PASS | Restored full implementations; marker scan found no credential-like values or placeholder replacements in source. History-wide scanning remains. |
| Email registration/login/session | PARTIAL | Full automated auth security tests pass; E2E local registration and reload persistence pass. Live email verification/recovery/reset not exercised. |
| Google/Microsoft OAuth | PARTIAL | OAuth validation tests pass. Real provider credentials/callbacks are not configured or tested. |
| Phone/SMS/WhatsApp | NOT VERIFIED | No uncontrolled messages sent; real provider configuration and lifecycle remain unverified. |
| Chat/provider selection | PARTIAL | Offline/provider fallback and chat pipeline tests pass; live Gemini/provider credentials were not used. |
| Memory | PARTIAL | Memory lifecycle automated tests pass; user-facing breadth and live persistence not fully reviewed. |
| Documents | PASS (automated local scope) | PDF/DOCX/XLSX parsing/export, restore/undo, media metadata, and ownership tests pass; production storage remains unverified. |
| Research | PASS (automated local scope) | Provider honesty, URL retrieval, source handling, injection defenses, and report-scope tests pass; production provider configuration remains unverified. |
| Project & Build | PASS (automated local scope) | Real scaffolding/build/test stages and failure reporting pass on Windows; exhaustive UI/stack coverage remains. |
| Developer Command Center | PARTIAL | Server-side auth checks exist and API tests cover roles; full UI and live role lifecycle still need review. |
| Assistant and voice | PARTIAL | Assistant navigation and service tests pass; native voice/background permissions require device checks. |
| Self-development and checkpointing | PARTIAL | Checkpoint/self-development tests pass; exhaustive authorization, repair, and audit review remains. |
| Browser UI | PASS (limited E2E) | Desktop signup/session/workspace/settings and mobile viewport smoke checks pass; not every screen/control is covered. |
| Diarisation | PARTIAL / BLOCKED | Honest missing-provider behavior passes. Real model inference was skipped; worker deployment remains unverified. |
| Android build/update | PENDING | Permanent key configured and CI candidate/update flow added; actual signed artifact and Android 13 result pending. |
| Windows packaging | NOT VERIFIED | Windows source/type/build/browser CI added; no standalone Windows release was built. |
| Supabase/PostgreSQL/RLS | NOT VERIFIED | No live database operation or complete grants/RLS audit. |
| Vercel production | NOT VERIFIED | No deployment or live production smoke test. |
| GitHub CI | PENDING | Workflow parses locally; commit/push and actual Ubuntu/Windows/Android run are pending. |
