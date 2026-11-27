# Assistant orchestration — verification

**Commit:** `c49b66c` · **Date:** 2026-11-27

Status labels: **PASS** · **PARTIAL** · **BLOCKED** · **NOT IMPLEMENTED** · **NOT TESTED**

---

## 1. The gap this phase closed

`IntentRouter.ts` understood conversation, research, build, repository, deploy, self-build and documents. It had **no route for device actions, schedules or plugins**. So "open WhatsApp" fell through to conversation and was answered with a paragraph about WhatsApp — the exact failure the brief calls out: *"Do not return a conversational description when an executable action was requested."*

**Fix:** three new intents with their own verb sets, plus a `scheduler.manage` capability so the schedule route has somewhere real to go.

---

## 2. Routing — PASS

`tests/test_intent_router.ts` — **35 passed, 0 failed**.

| Request | Intent | Status |
|---|---|---|
| "Open WhatsApp" | device | **PASS** |
| "Describe what is on my screen" | device | **PASS** |
| "Scroll down" | device | **PASS** |
| "Check my notifications" | device | **PASS** |
| "Open Settings and turn on Wi-Fi" | device | **PASS** |
| "Remind me every morning" | schedule | **PASS** |
| "Every two minutes, check WhatsApp for new messages" | schedule | **PASS** |
| "Pause my existing reminder" | schedule | **PASS** |
| "In 30 minutes, remind me to check this document" | schedule | **PASS** |
| "Use the connected plugin to perform this task" | plugin | **PASS** |
| "List my plugins" | plugin | **PASS** |

**Two ordering decisions that matter:**

1. **Schedule is tested before device.** "Check my notifications every 5 minutes" contains both a device verb and a schedule verb. The real request is a recurring monitor, so it routes to schedule. Asserted explicitly.
2. **Qualified objects are matched without over-matching.** "Pause my *existing* reminder" needs a pattern, not a literal phrase. A bare `'pause my'` match would be worse — "cancel my subscription" is not a scheduler request. `SCHEDULE_MANAGEMENT_PATTERN` requires the verb *and* an automation noun within a few words.

**Negative cases — PASS:** "what is WhatsApp?" and "how do reminders work?" stay conversation. The new intents do not steal ordinary questions.

---

## 3. Capability mapping — PASS

| Intent | Capability | Registered? |
|---|---|---|
| device | `device.plan` | **PASS** |
| schedule | `scheduler.manage` | **PASS** (added this phase) |
| plugin | `plugins.list` | **PASS** |

The first attempt mapped to `device.execute` and `plugin.invoke`, which **do not exist**. A mapping to a missing capability is silently filtered at runtime and the request falls back to conversation — so the test now asserts against the ids actually in `registerCapabilities.ts`.

---

## 4. Execution — PARTIAL

| Stage | Status | Note |
|---|---|---|
| Intent recognition | **PASS** | 35 assertions |
| Planning | **PASS** | `device.plan` produces a next action |
| Permission check | **PASS** | Capability permission + device permission state |
| Tool selection | **PASS** | Capability registry |
| Execution — schedule | **PASS** | 24 assertions through a real server |
| Execution — device | **NOT TESTED** | Needs a phone |
| Execution — plugin | **PARTIAL** | Registry works; no external server configured |
| Observation | **PASS** | Execution records carry results |
| Verification | **PASS** | `run-now` reports failure when no device |
| User-facing response | **PASS** | Honest failure, not a fake success |

---

## 5. Safety — PASS

Consequential operations require explicit confirmation. The device layer refuses send / call / purchase / delete / submit without an opt-in rule. This is enforced in the capability layer, not the UI, so it cannot be bypassed by calling the API directly.

---

## 6. What is still not proven

| Item | Status |
|---|---|
| "Open WhatsApp" actually opening WhatsApp | **NOT TESTED** — needs the phone |
| Wake word "Hey RARE" | **NOT TESTED** — needs the phone |
| Background microphone | **NOT TESTED** — needs the phone |
| Compact overlay over another app | **NOT TESTED** — needs the phone |
| Real accessibility tap / type / scroll | **NOT TESTED** — needs the phone |
| Plugin invocation from Chat | **PARTIAL** — no external server configured |

The routing is proven. The execution on hardware is not, and cannot be from here.

---

## Summary

| Layer | Status |
|---|---|
| Intent recognition | **PASS** |
| Capability mapping | **PASS** |
| Schedule execution end to end | **PASS** |
| Device execution | **NOT TESTED** |
| Plugin execution | **PARTIAL** |
| Safety / confirmation | **PASS** |
