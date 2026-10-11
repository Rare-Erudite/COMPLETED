# RARE 023

Sequential correction release following the RARE 022 targeted pre-testing audit.

## Correction
- Fixed the Builder agent preflight path: `CoreContext.repository_summary()` now exists and returns the same repository summary used by the API/requirements layer.
- Added a regression test proving the real Architect + Scout + Builder workflow no longer dies with `AttributeError: repository_summary` before Builder execution.
- No changes were made to the self-development engine, provider abstraction, or model-selection logic beyond this agent orchestration fix.

## Scope of this release audit
The certification target is intentionally limited to:
1. RARE can understand development requests through the requirements/reasoning layer.
2. RARE can plan and execute source-code changes through the protected self-development engine.
3. Builder agents can reach and drive that engine.
4. Model providers are abstracted and can use arbitrary compatible installed models/endpoints.
5. Validation/repair/rollback preserve the self-building loop.

Physical Flutter/Android/Windows compilation and other unfinished product features remain outside this release gate because RARE is expected to build those later.
