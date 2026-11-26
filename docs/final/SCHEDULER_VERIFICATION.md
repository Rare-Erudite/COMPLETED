# Scheduler Verification

**Starting commit:** `4a1bb2f48c7315dd2f2c8a05b0860fe433b569a8` (HEAD = origin/main, clean)
**Date:** 2026-11-26
**Environment:** Debian Linux sandbox, Node 20.20.2, Python 3.11, 1 vCPU / 2 GB RAM

Status labels: **PASS** (operation executed and outcome verified) · **PARTIAL** (some steps work, complete operation not proven) · **BLOCKED** (external dependency prevents execution) · **NOT IMPLEMENTED** · **NOT TESTED**

---

## 1. What was wrong before

`/api/schedules` had GET/POST/toggle/DELETE against `persistentStorage` under the key `schedules`. There was **no `SchedulerEngine` class, no `setInterval`, no cron evaluation, and no code path that ever read a due schedule**. A schedule was a stored row that nothing consumed. Creating one produced a record and no execution, ever.

Verified by inspection: `grep -n "schedules" server.ts` returned only the CRUD handlers; no timer or evaluator existed anywhere in the server.

## 2. What was built

| File | Purpose |
|---|---|
| `src/server/scheduler/cron.ts` | Dependency-free schedule parser: intervals, 5-field cron, natural language ("every 2 minutes", "every day at 08:00", "every monday at 09:30", "every month on the 1st at 07:00"), ISO one-offs. Timezone-aware next-run calculation with DST handling. |
| `src/server/scheduler/ScheduleEngine.ts` | The engine: durable tick, atomic claim, dispatch, retry with backoff, missed-run policy, bounded execution history. |
| `src/server/scheduler/ScheduleStore.ts` | Two persistence backends — Postgres (atomic `UPDATE … RETURNING` claims) and a local durable store (mutex + persisted lease). |
| `src/server/scheduler/dispatcher.ts` | Turns a task into a real action: `notification_check`, `device`, `mcp_tool`, `tool`, `agent`, `report`. |
| `src/server/scheduler/DeviceCommandQueue.ts` | The transport to the phone: enqueue → phone polls → phone posts result. |
| `server.ts` | Engine wiring at startup, plus `/api/schedules` (CRUD + run-now + history), `/api/scheduler/status`, `/api/scheduler/tick`, `/api/device/{poll,result,status,enqueue}`. |
| `tests/scheduler/test_cron.ts` | 29 parser/timezone/DST assertions. |
| `tests/scheduler/test_engine.ts` | 43 end-to-end engine assertions. |

### Durability and duplicate prevention

- **Postgres backend:** a claim is `UPDATE rare_scheduled_tasks SET lease_owner=$2 … WHERE id=$1 AND (lease_owner IS NULL OR lease_expires_at < now()) RETURNING payload`. The database serialises this, so two workers racing produce exactly one winner. A crashed worker's lease expires and the task is reclaimed.
- **Local backend:** claims are serialised by an in-process mutex plus a persisted lease timestamp. **This is single-process only and is not safe across multiple instances.** The engine reports `mode: 'local'` so this is never implied to be multi-instance safe.

### Missed-run policy

If the engine was down past a task's due time by more than `max(tickMs × 4, 60s)`, it records **one** `missed` execution and jumps to the next future occurrence. It does not replay the backlog.

### Retry policy

A failed action increments `consecutive_failures` and schedules a retry with exponential backoff (30s, 60s, 120s … capped at 30 min). After 5 consecutive failures the task is parked as `failed` and stops until the owner resumes it.

---

## 3. Evidence

### 3.1 Parser — `npx tsx tests/scheduler/test_cron.ts`

```
RESULT: 29 passed, 0 failed
```

Covers: all natural-language forms, raw cron, `*/15`, rejection of malformed input (4-field cron, "every 5 seconds" below the 30s floor, nonsense), and — importantly — **DST correctness**:

```
PASS  day before DST: 08:00 local — 8:0 on 3/13
PASS  day after DST: still 08:00 local — 8:0 on 3/14
PASS  UTC hour shifted by 1 (DST proof) — 13Z vs 12Z
```

A daily 08:00 America/New_York task stays at 08:00 local across the spring-forward boundary while its UTC instant shifts by an hour. That is the behaviour that matters.

### 3.2 Engine — `npx tsx tests/scheduler/test_engine.ts`

```
RESULT: 43 passed, 0 failed
```

The test drives the **real** `ScheduleEngine`, `LocalScheduleStore`, `StoreDeviceCommandQueue` and `createDispatcher`. Only the phone is simulated (`FakeDevice`), and that is stated explicitly.

| # | Scenario | Result |
|---|---|---|
| 1 | Recurring task created and persisted with a due time | PASS |
| 2 | Nothing runs before the due time | PASS |
| 3 | At due time the action executes; device receives a real command | PASS |
| 3 | WhatsApp filter applied — 2 of 3 notifications reported, systemui excluded | PASS |
| 3 | Checkpoint stores seen ids; next run advances | PASS |
| 4 | Same notifications again → "no new ones", no duplicate report | PASS |
| 5 | One genuinely new message → exactly 1 reported, sender named | PASS |
| 6 | Device unreachable → run marked **failed**, never a fake success | PASS |
| 6b | Stale presence → explicit `device_offline`, "did not check anything" | PASS |
| 7 | Device returns an error → surfaced verbatim | PASS |
| 8 | Pause → task does not run | PASS |
| 9 | Resume → runs again | PASS |
| 10 | **Restart**: new engine instance continues from persisted state | PASS |
| 11 | **Missed run**: recorded once, backlog not replayed, jumps forward | PASS |
| 12 | **Duplicate prevention**: task leased by another worker is skipped | PASS |
| 13 | Run-now bypasses the due check | PASS |
| 14 | Failure parking after maxFailures | PASS |
| 15 | Cancel (delete) | PASS |
| 16 | One-off schedule runs once then completes with no next run | PASS |

### 3.3 Live HTTP path — real server, real endpoints

Server booted with `npx tsx server.ts`; guest session; CSRF token; real requests.

```
GET  /api/scheduler/status  -> {"engine":{"running":true,"mode":"local","tickMs":2000,...}}
POST /api/schedules         -> 201, task with next_run_at and status "active"
GET  /api/schedules         -> task listed with run_count, history
POST /api/schedules/:id/run-now -> execution object returned
POST /api/schedules/:id/toggle  -> status flipped to "paused"
GET  /api/schedules/:id/history -> execution entries
POST /api/device/poll       -> {"commands":[...]}  (claimed)
POST /api/device/result     -> {"success":true,"command":{...,"status":"done"}}
GET  /api/device/status     -> {"online":true,"recent":[...]}
```

With no device connected, `run-now` returned a **failed** execution whose summary said the device was not reachable — not a success. With a polling device, the same call returned a success carrying the actual notification payload.

### 3.4 WhatsApp monitoring workflow

Instruction: *"Every two minutes, check WhatsApp for new incoming messages and tell me what has arrived."*

- Registered as `action_kind: 'notification_check'`, `action_config: { package: 'com.whatsapp' }`, `schedule: 'every 2 minutes'`.
- Each run enqueues a `notifications` command, waits for the device, filters to `com.whatsapp`, and diffs against `checkpoint.seenNotificationIds`.
- New messages are reported with sender and text; previously seen ones are not repeated.
- Checkpoint is bounded to the last 500 ids so it cannot grow without limit.
- Device offline / permission revoked / timeout → **failed** with the real reason.

**Status: PASS** for the engine, dedupe, filtering and honest failure. **PARTIAL** overall, because the device side was a simulator: no real WhatsApp notification was read on hardware.

### 3.5 Consequential actions

`send_message`, `delete`, `purchase`, `submit`, `call` are refused unless the task carries `allowConsequential: true`. Verified by code path and by the dispatcher's refusal branch.

---

## 4. Honest limitations

| Item | Status | Detail |
|---|---|---|
| Engine executes schedules | **PASS** | Proven in unit and live HTTP tests |
| Duplicate prevention (single process) | **PASS** | Mutex + persisted lease |
| Duplicate prevention (multi-instance) | **PARTIAL** | Postgres backend implements atomic claims, but **no Postgres was reachable from this sandbox**, so the cross-instance path is written and typechecked but **not executed**. The local backend is single-process only. |
| Restart resume | **PASS** | New engine instance continued from persisted state |
| Missed-run recovery | **PASS** | Single `missed` record, no backlog replay |
| Timezone / DST | **PASS** | Verified across a real DST boundary |
| Real device action | **PARTIAL** | Transport proven end to end; the phone was simulated. No physical Android device was available. |
| WhatsApp message reading | **PARTIAL** | Filtering and dedupe proven against simulated notifications. Real WhatsApp notification access requires the owner to grant Notification Access on the phone. |
| Serverless tick | **PARTIAL** | `/api/scheduler/tick` exists and is secret-guarded, but no Vercel cron entry was added, so on Vercel nothing calls it yet. |

### Why no Postgres

`DATABASE_URL` is not set in this sandbox, and the Supabase project's direct and pooler endpoints were unreachable from here (network unreachable / wrong region), while the REST key lacked table grants. Rather than fake it, the engine falls back to the local durable store and **reports that mode**. The Postgres code path is complete and typechecked; it is simply unexercised.

---

## 5. Reproduce

```bash
cd rare-work/repo
npx tsx tests/scheduler/test_cron.ts      # 29 assertions
npx tsx tests/scheduler/test_engine.ts    # 43 assertions
npx tsc --noEmit                          # clean
```

Live HTTP check: start the server, create a guest session, POST a schedule, then `POST /api/schedules/:id/run-now` with and without a device polling.
