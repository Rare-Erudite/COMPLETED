# Feature verification matrix

Statuses below describe evidence from this session. **Not verified** means the complete current branch state has not been validated after the final edits.

| Area | Status | Evidence / remaining work |
|---|---|---|
| Repository and branch | PASS (local only) | Clean `main` at `64cd88a`; switched to existing `New-Fixes-by-Erudite` at `c3ec69e`. Remote refs could not be refreshed. |
| Core source integrity | PASS (repaired locally) | Removed literal placeholder contents by restoring source from local `main`; markers are no longer present in tracked source. Reapplied selected branch changes. |
| Registration, login, logout, sessions | PARTIAL | Existing auth/security suite passed in a partial run before later edits; complete rerun is pending. Persistence initialization was corrected locally. |
| Password recovery and reset | NOT VERIFIED | Existing routes/UI inspected; no full workflow run after restoration. |
| Google/Microsoft OAuth | PARTIAL | Existing OAuth validation tests passed in a partial run; live provider configuration not tested. |
| Chat and provider selection | NOT VERIFIED | Source inspected; full chat pipeline suite was not reached in the final partial test runs. No live model credentials were used. |
| Memory | PARTIAL | Memory lifecycle suite passed in a partial run; production persistence not verified. |
| Documents, PDF, DOCX, audio | NOT VERIFIED | Existing services and tests found; final full content/document suites were not completed. |
| Research | PARTIAL | Durable-state/research tests passed in a partial run; live source retrieval was not verified during this run. |
| Project & Build | FAIL then repaired, rerun pending | Tests exposed Windows `npm` and Python Store-alias failures; shell-free npm CLI and Windows `python.exe` selection were added. No full rerun after dependency loss. |
| Developer Command Center | PARTIAL | Server-side developer authorization exists; developer workflow and current UI were not fully exercised. |
| Assistant and voice | PARTIAL | `AssistantStudioView` was wired into app navigation. Browser voice capabilities are runtime-dependent; device actions remain unverified. |
| Wake word / background listening | NOT VERIFIED / platform limited | No claim of background wake-word support; no native device test. |
| Diarisation | NOT VERIFIED | Worker and service code exist; no real model inference was run. |
| Android native operations | NOT VERIFIED | Existing APK artifacts and build script exist. No clean release build, signing verification, install, or device test was completed. |
| Windows support | PARTIAL | Windows-specific test runner and project-stage launches were repaired; no packaged app or end-user workflow was tested. |
| Plugin status UI | PASS (implementation only) | UI now distinguishes loading, unavailable, and returned status; final browser verification is pending. |
| API inventory | PARTIAL | Static scan found 117 Express route registrations. No exhaustive per-route authorization/data-flow review is complete. |
| Supabase/PostgreSQL and RLS | NOT VERIFIED | Schema and migration files were inspected. No live database interaction or full RLS audit was performed in this session. |
| Vercel production | NOT VERIFIED | No deployment or production smoke test was attempted. |
| CI | NOT VERIFIED | Workflow exists locally; GitHub token invalid prevented run/dispatch or remote verification. |
