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
| Android build/update | BLOCKED | Published 1.1.0 and 1.1.1 APKs both verify as `c550fd6549d7bbdf2201f9578efb143128f925cf7f8830ddffd349f4995bc57b`; the newer local/branch key differs. No compatible release package can be made until the original key or safe rotation is proven. |
| Windows packaging | NOT VERIFIED | Windows source/type/build/browser CI added; no standalone Windows release was built. |
| Supabase/PostgreSQL/RLS | NOT VERIFIED | No live database operation or complete grants/RLS audit. |
| Vercel production | NOT VERIFIED | No deployment or live production smoke test. |
| GitHub CI | PENDING | Workflow parses locally; commit/push and actual Ubuntu/Windows/Android run are pending. |

## 2026-11-06 continuation checks

| Area | Status | Evidence / remaining work |
|---|---|---|
| Repository/remote | PASS | Clean New-Fixes-by-Erudite at 5e96b5b32db0aeb369e033d7c5f784d390ab8249; fetched remote matches. main and origin/main both remain 64cd88a54b1c031dabb2edb3ba5832a39ec17b61. Recovery commits and bundle verified. |
| Run #42 | IN PROGRESS | Exact head SHA 5e96b5b32db0aeb369e033d7c5f784d390ab8249; Windows job passed, Ubuntu FFmpeg installation still running at inspection. No Android job was present. [Run #42](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42239482331). |
| Ordinary CI APK behavior | FIXED LOCALLY | APK-producing Android job removed from .github/workflows/ci.yml; pending run #42 has no Android job and cannot package. Change not yet committed/pushed. |
| Published Android identity | BLOCKED | pksigner verified both 1.1.0 and 1.1.1 APKs use c550fd6549d7bbdf2201f9578efb143128f925cf7f8830ddffd349f4995bc57b. This differs from the branch's recorded 92:85:…:75:2F:92 key. Original key/rotation has not been proven. |

| Final release workflow | CONFIGURED, NOT RUN | .github/workflows/release-apk.yml is manual-only, requires a rare-final frozen tag and exact successful CI, rejects incomplete completion/security records, verifies the published signing certificate before building, builds once, and uploads only after emulator update checks pass. No artifact is available because the identity and completion gates are blocked. |
