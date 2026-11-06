# Feature verification matrix

Statuses describe evidence for the current local implementation checkpoint. Local tests do not prove live production configuration.

| Area | Status | Evidence / remaining work |
|---|---|---|
| Repository and branch | PASS | Recovered branch ancestry and verified backup; feature branch pushed and matches origin. `main` remains untouched. |
| Core source integrity | PASS (scoped scan) | Restored full implementations; redacted scan covered 1,902 reachable Git objects and GitHub reported 0 secret alerts. Scan limitations and historical synthetic state are recorded in `SECURITY_REVIEW.md`. |
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
| Diarisation | BLOCKED | Worker HTTP authentication now fails closed when the token is unset and uses constant-time bearer comparison. Focused smoke check passed. No real pyannote inference or production worker deployment has been verified. |
| Android signing | PASS (replacement identity) | Original signer was unavailable; the owner-authorized RSA-4096 replacement is `37be10e99449fbc5f90331965905e8d2ccd31a446301eafa20620f11badee1df`. Fingerprint-only Actions audit matches; DPAPI backup restore and temporary JAR sign/verify passed. |
| Android update transition | CLEAN INSTALL REQUIRED | New signer cannot update 1.1.0/1.1.1 in place. Release workflow now clean-installs on API 21/33/36; no final APK or emulator run exists yet. Users must export device-only data before uninstalling old builds. |
| Windows packaging | NOT VERIFIED | Windows source/type/build/browser CI added; no standalone Windows release was built. |
| Supabase/PostgreSQL/RLS | NOT VERIFIED | No live database operation or complete grants/RLS audit. |
| Vercel production | NOT VERIFIED | No deployment or live production smoke test. |
| GitHub CI | PASS (source CI) | Exact implementation commit `e4bd90b3a73892c6a113c2c54de07ab56cc0cd84` passed Ubuntu and Windows typecheck, build, full suite, and desktop/mobile browser checks in run [#42250587710](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42250587710). Android packaging is absent from development CI. |

## 2026-11-06 continuation checks

| Area | Status | Evidence / remaining work |
|---|---|---|
| Repository/remote | PASS | Feature branch and origin both point to implementation commit `e4bd90b3a73892c6a113c2c54de07ab56cc0cd84`; `main` and `origin/main` remain `64cd88a54b1c031dabb2edb3ba5832a39ec17b61`. Recovery bundle verified. |
| Run #42 | CANCELLED | Exact SHA `5e96b5b32db0aeb369e033d7c5f784d390ab8249`; Windows passed, Ubuntu canceled during FFmpeg install, and the queued APK job was canceled before any step. [Run #42](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42239482331). |
| Ordinary CI APK behavior | FIXED | `.github/workflows/ci.yml` has no APK packaging job; run #42 queued one but it was canceled before any step. |
| Published Android identity | RESOLVED FOR CLEAN INSTALL | apksigner verified both 1.1.0 and 1.1.1 APKs use c550fd6549d7bbdf2201f9578efb143128f925cf7f8830ddffd349f4995bc57b. That private key is unavailable; the owner-authorized replacement signer is verified by Actions. Old installs require clean install; no rotation lineage is claimed. |

| Final release workflow | REGISTERED; FINAL GATES BLOCKED | Workflow requires a frozen tag equal to current `main`, successful Production deployment on the same SHA, `/api/health` commit attestation, healthy database status, complete readiness/security records, and exact-SHA CI. It clean-installs rather than attempting an incompatible update, verifies checksum download, and publishes a draft only after the emulator matrix passes. No final tag/run has been made. |

| Published APK delivery path | PASS (local tests) | API resolves only the official latest `rare-final-v*` GitHub release with a matching named APK/checksum pair. Bundled historical APKs no longer serve as download candidates; update discovery uses published release metadata. No final release asset exists yet, so live download is not verified. |
| Current source checkpoint CI | PASS (a26821d) | Ubuntu and Windows jobs, typecheck/build/full tests/Chromium E2E passed in [run #42256481013](https://github.com/Rare-Erudite/COMPLETED/actions/runs/42256481013). The later release-asset resolver and UI corrections are uncommitted in this checkpoint and still require exact-SHA CI. |
