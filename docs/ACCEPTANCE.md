# Acceptance checklist (spec §47)

This checklist records the proof behind each acceptance criterion in spec §47.

**Current audit status:** RARE 045 source/clean-room verification performed on 2026-09-14. The current release was checked with Python 3.13; the physical Windows/Android/Flutter runtime remains machine-specific.

**How to reproduce:**

- The automated pytest suite (154 tests): `python -m pytest -q`
- The self-test (13 checks): `python -m rare_core selftest`
- The demonstration (4 scenarios): `python -m rare_core demo`

| §47 criterion | Status | Evidence |
|---|---|---|
| **Repository intelligence**: RARE can inspect and understand the project structure | ✅ Met | `tests/test_repo_and_tasks.py::TestRepository` covers classification, incremental index, dependencies/dependents/tests/impact and broken-import detection. Demo step [0] indexes the whole project and builds the architecture graph. |
| **Planning**: a development request becomes a structured plan | ✅ Met | Demo A shows spec → plan (6 files, risk, expected tests, rollback strategy). The planner dry-runs every change before accepting it (`reasoning/planner.py`). |
| **Controlled modification**: RARE can safely modify and create project files | ✅ Met | `TestPatchEngine`: all 7 operations, all-or-nothing application, protected-path and `.rare` refusal, no overwrite without permission. |
| **Checkpointing**: a recoverable pre-change state can be created | ✅ Met | `TestCheckpoints` covers create/compare/restore, scoped restore and retention that keeps the latest known-good checkpoint. Every task takes a `pre_change` checkpoint (demo A/B). |
| **Validation**: RARE can run appropriate checks | ✅ Met | Syntax, clean-interpreter import, affected tests, core tests and capability tests (`validation/engine.py`). Exercised in `test_validation_and_health` and every demo scenario. |
| **Failure analysis**: RARE can interpret failures | ✅ Met | `TestFailureAnalysisAndRepair` parses NameError from unittest output, structured syntax errors and timeouts. In demo B an AssertionError is diagnosed with file, line and test. |
| **Repair**: RARE can attempt corrective changes and retry validation | ✅ Met (mechanical faults) | Demo A: the injected missing import is repaired automatically and revalidated. Tests cover the missing-import, missing-colon and name-typo strategies. **Logic errors need a model provider**; offline they stop with reason `ambiguous`. |
| **Rollback**: RARE can restore the previous state | ✅ Met | Demo B: automatic rollback, verified identical to the pre-task state. `test_build_capability_with_repair` covers user rollback of a completed task. The standalone `rare_recovery.py` restore is tested too. |
| **Approval**: protected actions can require user authorisation | ✅ Met | Only a `UserAuthority` can approve (`test_only_user_authority_resolves`). User rejection fails the task with no changes. Level 0 blocks modification (demo D). Protected files are refused (demo C). Security-review regressions are in `TestSecurityReviewRegressions`. |
| **Memory**: development history and useful knowledge persist | ✅ Met | `TestMemory` shows record, query and repair preferences learned from successes. The engine writes error, repair, accepted-change, test-result and failed-approach records (demo summary: 10+ records). The knowledge base is seeded on `init`. |
| **Capability architecture**: future capabilities can be registered and built as modules | ✅ Met | Manifest validation, dependency ordering, isolated health check and activate/deactivate (`capabilities/registry.py`). Self-test `capability_registration`. The HTTP API test builds `api_probe`. |
| **End-to-end development**: at least one controlled capability is actually built through the loop | ✅ Met | Demo A: a Text Statistics capability is specified, planned, approved, implemented, fails its tests, is repaired, revalidated, checkpointed known-good, activated, and called live. |

## Independent security review (Phase 7)

A separate reviewer agent audited the safety boundaries and found 5 real issues. **All 5 are fixed and covered by regression tests** (`tests/test_changes_and_safety.py::TestSecurityReviewRegressions`):

1. **Padded or `./` paths slipped past the security-config check.** Paths are now normalised before risk is classified.
2. **Allow-listed interpreters could run arbitrary code at level 3.** A new `execute_code` action is HIGH risk, so it always needs approval.
3. **git arguments could leak the API token or overwrite protected files** (`--no-index`, `--output`). git now accepts only an allowlist of read-only flags.
4. **The patch tool trusted a "files created by this task" list supplied by the caller.** That list is now derived from the task's own change records, and never covers dependency or config files.
5. **Protected-path matching was case-sensitive**, which is unsafe on Windows, macOS and Android. It is now case-insensitive in both the policy and the patch engine.

**Also hardened during the review:**
- The core's safety modules (`permissions/`, the tool executor and built-in tools, the process runner, the patch engine, audit, the HTTP server) are now **security-sensitive**. Editing them always needs approval.
- The API token file is created with owner-only permissions from the start.

**Verified as sound:** approvals require a `UserAuthority`; the HTTP bearer-token check uses a timing-safe comparison and runs before routing; the engine authorises before snapshotting and modifying, and re-authorises repairs.

### Current RARE 045 final cross-check

The current release audit added and verified the real Chat message share/edit controls, Documents search, Research URL fetch, Build approval controls, Live Conversation keyboard/auto-listen flow, assistant device-status routing, and the two-way laptop↔phone assistant bridge. The exact HTTP edit route uses the message id encoded in its path. The release contains the checked-in RARE icon assets and platform-preparation/build scripts.

## Machine-specific verification still required

- Runs on real **Windows** and **Android** (Termux / Pydroid 3) devices.
- A live run against the user's real **Ollama** installation and local model; code-level/provider integration is tested, but the user-machine live path remains environment-specific.
- Model-based repair of logic errors.
