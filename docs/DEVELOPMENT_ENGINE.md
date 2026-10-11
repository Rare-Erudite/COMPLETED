# The development engine (`rare_core/engine/self_dev.py`)

`SelfDevelopmentEngine` runs the self-building loop. Tasks are persistent and resumable: `run(task_id)` drives a
task until it is **completed**, **failed**, **rolled back**, or needs you (**awaiting approval** or **blocked** in `planned`).

## Task states
`requested → analyzing → planned → [awaiting_approval] → implementing → testing ⇄ repairing → completed`.
A task can also end in `failed` or `rolled_back`.
Illegal transitions raise `InvalidTransition`. Every transition is recorded in the task's `execution_history` and
emitted as an event.

## The loop, step by step
1. **Understand.** RARE re-indexes the repository and builds the architecture graph. `RequirementsEngine` then writes a
   specification: requirements, components, interfaces, storage, pipeline, permissions, tests, implementation order
   and risks.
2. **Plan.** `Planner` asks the reasoning service for patch operations, **dry-runs** them against the current files,
   classifies each operation's risk from the paths it touches, computes impact (dependents, affected capabilities,
   covering tests) and records the rollback strategy.
3. **Check risk and approve.** The policy decides `auto`, `approve` or `prohibit` for each action.
   - **Approval needed:** the task goes to `awaiting_approval`. Each request shows the action, why it's needed, the
     files, the risk, the expected result and whether it can be rolled back. You can approve, approve once, allow
     for the task, reject, or change the policy.
   - **Prohibited:** the task fails if a protected component is involved. If the autonomy level is the only obstacle,
     it stays `planned` and records a `blocked_reason`.
4. **Snapshot.** RARE takes a `pre_change` checkpoint.
5. **Modify.** The `patch.apply` tool runs through the ToolExecutor, which checks authorisation again, and writes a
   `ChangeRecord` (files, diff, before and after hashes, reason, approval state).
6. **Validate.** Task-scope checks run: syntax, clean-interpreter import, and the affected tests.
7. **Diagnose and repair.** `FailureAnalyzer` turns output into diagnoses (problem, cause, file and line, severity,
   candidate repairs). `RepairEngine` proposes operations.
   - Rule-based strategies are tried first, ordered by what succeeded before (from memory): missing import, missing
     colon, name typo, attribute typo, import path. A model strategy comes last if a model is available.
   - Repairs are authorised like any other change, then applied, revalidated and recorded.
   - The loop **stops** on: budget exhausted, the same failure repeating, no safe repair (ambiguous), an external
     resource being unavailable, an unsafe repair, or your rejection.
8. **Accept.** RARE registers and activates the capability (if any, with an isolated health check), writes a
   `post_change` checkpoint (**known_good only if tests ran**, otherwise `experimental`), marks the changes accepted,
   re-indexes, and records memory entries: accepted change, test result and pattern.
9. **Fail and roll back.** With `repair.on_failure = rollback`, RARE restores **only the files this task touched**
   from its pre-change checkpoint, verifies the result, and moves the task to `rolled_back`.

## Observability
`engine.status(task_id)` (CLI `task show`, API `/tasks/<id>/status`) shows:
- the current phase and the files inspected;
- the planned changes and validation status;
- errors, repair attempts and approval status;
- the final result and rollback status.

## Offline versus with a model
**Offline** (always available), RARE can build structured deterministic capabilities and exact changes supplied by the user; the final user-facing implementation must still pass validation before it is accepted.

and it repairs mechanical errors.

**With Ollama or an OpenAI-compatible model,** planning and repair become open-ended. Model output goes through
exactly the same validation, permission checks and rollback. The `inject_fault` parameter (`missing_import` or
`unrepairable`) exists only to demonstrate repair and rollback.
