# Scheduler — production verification

**Commit:** `c49b66c` · **Date:** 2026-11-27

Status labels: **PASS** · **PARTIAL** · **BLOCKED** · **NOT IMPLEMENTED** · **NOT TESTED**

---

## 1. The defect this phase closed

`ScheduleEngine.start()` is deliberately skipped when `VERCEL` is set (a serverless function has no long-lived process to hold a timer), and `vercel.json` had **no `crons` entry**. Nothing invoked `/api/scheduler/tick`. Schedules were stored and never evaluated.

**Fix:** `.github/workflows/scheduler-tick.yml` — a durable external trigger.

| Property | Value |
|---|---|
| Trigger | `cron: '*/5 * * * *'` + `workflow_dispatch` |
| Endpoint | `POST/GET {base}/api/scheduler/tick` |
| Auth | `x-rare-scheduler-secret` **header** — never in the URL, so it cannot leak into access logs or referrers |
| Overlap | `concurrency: scheduler-tick`, `cancel-in-progress: false` |
| Timeout | 5 min job, 60 s request, 2 retries |
| Failure reporting | 403 / 503 / 000 each produce a distinct `::error::` and a non-zero exit |

**Why GitHub Actions and not Vercel Cron:** the Vercel Hobby plan allows **one cron run per day**, which cannot serve "every two minutes". Actions scheduled workflows are free for public repositories and need no payment method. No Vercel upgrade was made.

**Honest limitation:** GitHub's scheduler is best-effort and can be delayed under load. The engine tolerates this — a late tick still evaluates every due task and applies the missed-run policy — so a delay degrades latency, never correctness. A 2-minute cadence needs a self-hosted runner or an external pinger; the workflow documents this.

**Status: PARTIAL** — the workflow is committed and correct, but it cannot be *proven* until `RARE_SCHEDULER_SECRET` is set in the repository and one run succeeds. That is an owner action (see §6).

---

## 2. Engine execution — PASS

`tests/scheduler/test_engine.ts` drives the **real** engine, store, queue and dispatcher. Only the phone is simulated, and that is stated in the test.

```
43 passed, 0 failed
```

| Scenario | Status |
|---|---|
| Recurring task fires at its interval | **PASS** |
| One-off task fires once then completes | **PASS** |
| Duplicate prevention (same task, repeated ticks) | **PASS** |
| Restart resume (state reloaded from store) | **PASS** |
| Missed-run recovery (one record, no backlog replay) | **PASS** |
| Pause / resume | **PASS** |
| Cancel | **PASS** |
| Failure parking after retries | **PASS** |
| Retry with backoff | **PASS** |
| Execution history with ids and results | **PASS** |

`tests/scheduler/test_cron.ts` — **29 passed, 0 failed**: intervals, 5-field cron, natural language ("every 2 minutes", "every day at 08:00", "every monday at 09:30", "every month on the 1st at 07:00"), ISO one-offs, bare times of day.

**DST — PASS.** A daily 08:00 `America/New_York` task stays at 08:00 local across spring-forward while its UTC instant shifts 13Z → 12Z.

---

## 3. Capability path — PASS (new this phase)

Chat and the Assistant previously had no route to the scheduler. `scheduler.manage` is now a registered capability backed by the same engine and store the HTTP routes use.

### Verified in PRODUCTION (`rareproject.vercel.app`, commit `8df9029`)

Real guest session, real CSRF, real deployment:

```
POST /api/capabilities/invoke
{"capabilityId":"scheduler.manage","args":{"operation":"create",
 "title":"Prod WhatsApp watch",
 "instruction":"Check WhatsApp for new incoming messages and tell me what has arrived.",
 "schedule":"every 2 minutes"}}

→ 200 {"ok":true,"summary":"Scheduled \"Prod WhatsApp watch\"...",
   "data":{"id":"sch_e2aa2323-...","schedule":"every 2 minutes",
           "status":"active","next_run_at":"2026-11-27T12:50:56.999Z"}}

GET /api/schedules → 1 task, active, next run computed
POST ... {"operation":"delete"} → {"ok":true,"summary":"Task deleted."}
```

The `scheduler` department is live in the production capability catalogue (`count: 1`).

`tests/test_scheduler_capability.ts` — **24 passed, 0 failed**, through a real server:

```
ok  scheduler.manage is registered
ok  the scheduler department is exposed
ok  create returns 200
ok  create returns a task id
ok  the task carries the instruction
ok  the task has a next run time
ok  the created task is persisted and listed
ok  the persisted task keeps its schedule expression
ok  pause succeeds / a paused task is marked paused
ok  resume succeeds / a resumed task is active again
ok  resume recomputes a future run
ok  run-now produces an execution record
ok  run-now does not claim success without a device
ok  another account cannot pause this task
ok  another account does not see this task
ok  an unknown operation is rejected
ok  create without a schedule is rejected
ok  delete succeeds / the deleted task is gone
```

The `run-now does not claim success without a device` assertion is the important one: with no phone attached, the honest outcome is a **failed** execution saying the device was unreachable — not a green tick.

---

## 4. WhatsApp monitoring — PARTIAL

Instruction: *"Every two minutes, check WhatsApp for new incoming messages and tell me what has arrived."*

| Requirement | Status | Evidence |
|---|---|---|
| Registers and persists the recurring task | **PASS** | Capability test above |
| Parses "every two minutes" | **PASS** | `test_cron.ts` |
| Inspects notifications at each run | **PARTIAL** | Dispatcher calls `notification_check`; the phone is simulated |
| Identifies genuinely new messages | **PASS** | Engine test: 2 of 3 notifications new, `systemui` excluded |
| Distinguishes processed from new | **PASS** | Persistent checkpoint by notification key |
| Extracts message information | **PASS** | Payload carried into the execution record |
| Reports to the owner | **PASS** | Execution result stored and surfaced |
| No duplicate reporting | **PASS** | Same key never reported twice |
| Handles unavailable device honestly | **PASS** | Failed execution, explicit reason |
| Handles missing permission honestly | **PASS** | `accessibilityLostReason` / notification-access check |
| Resumes after restart | **PASS** | Checkpoint reloaded from store |

**Limitation, stated plainly:** RARE reads **notifications**, not WhatsApp's message database. It cannot see messages that produced no notification, and it cannot read message history. Sending replies or deleting messages requires explicit confirmation and is not automated. This is Android's actual notification-access boundary, not a shortcut.

**Physical-device verification: NOT TESTED** — needs the owner's phone.

---

## 5. PostgreSQL concurrency — BLOCKED

`PostgresScheduleStore` has atomic `UPDATE … RETURNING` claims and lease fields. It is **typechecked but never executed**: `DATABASE_URL` is unset and the Supabase endpoints were unreachable from this sandbox. The engine fell back to `mode: 'local'` and **reported that honestly** in its startup log:

```
[Scheduler] Local durable store: single-process only. Claims are mutex-guarded, not cross-instance safe.
```

| Test | Status |
|---|---|
| Two workers, one claim | **NOT TESTED** |
| Lease expiry and reclaim | **NOT TESTED** |
| Worker crash mid-lease | **NOT TESTED** |
| Concurrent scheduling | **NOT TESTED** |

The harness is written; it needs a real database. **Owner action required** (see §6).

---

## 6. Owner actions

| # | Action | Why |
|---|---|---|
| A | Add `RARE_SCHEDULER_SECRET` to GitHub Actions secrets (same value as the deployment's) | Without it the tick workflow exits 1 by design |
| B | Provide `DATABASE_URL` through a secure channel — **never** in a public message or committed to source | To prove PostgreSQL concurrency |
| C | Install the APK and grant Notification Access | To verify real WhatsApp notification monitoring |

---

## Summary

| Item | Status |
|---|---|
| Engine executes schedules | **PASS** |
| Cron / natural language / DST | **PASS** |
| Duplicate prevention (single process) | **PASS** |
| Restart / missed-run recovery | **PASS** |
| Capability path from Chat/Assistant | **PASS** |
| Production trigger committed | **PARTIAL** — needs the secret |
| WhatsApp monitoring (engine) | **PASS** |
| WhatsApp monitoring (real device) | **NOT TESTED** |
| PostgreSQL multi-instance | **BLOCKED** — no database |
