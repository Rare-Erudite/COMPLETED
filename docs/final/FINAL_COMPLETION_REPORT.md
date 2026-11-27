# Final completion report

**Starting commit:** `a856815` · **Final commit:** `c49b66c` · **Date:** 2026-11-27
**Branch:** `main` · **Production:** `https://rareproject.vercel.app`

Status labels: **PASS** · **PARTIAL** · **BLOCKED** · **NOT IMPLEMENTED** · **NOT TESTED**

---

## 1. What this phase actually changed

Four defects were found in the code and fixed. Each was a case of something *appearing* to work while not doing the thing it claimed.

### 1.1 Image export stored a description, not the image — FIXED

`/api/images/export` called `DocumentsService.importBuffer()`, which ran text extraction and saved only `result.text`. Exporting an image stored a paragraph about the picture. The endpoint returned 201, so it looked correct.

Documents storage was text-only by design. Binary formats now keep their original bytes in `binaryData`, with `content` still holding extracted text so search and summarisation keep working.

- `saveBinary()` / `readBinary()` / `readWithoutBinary()`
- `GET /api/documents/*/download` serves original bytes, registered **before** the wildcard reader
- Binary uploads keep their file; `pages` / `kind` / `ocr` metadata preserved so a stored PDF keeps real page provenance

**Evidence:** 14 new assertions, PNG and JPEG round-trip **byte-for-byte**, MIME preserved, cross-account 404.

### 1.2 The Assistant could not act — FIXED

`IntentRouter.ts` had no route for device, schedule or plugin. "Open WhatsApp" fell through to conversation and was answered with prose.

- Three new intents with dedicated verb sets
- `SCHEDULE_MANAGEMENT_PATTERN` matches "my *existing* reminder" without swallowing "cancel my subscription"
- Schedule tested before device: "check my notifications every 5 minutes" is a recurring monitor
- `scheduler.manage` capability registered and bound to the real engine

**Evidence:** 22 new intent assertions, 24 scheduler-capability assertions through a real server.

### 1.3 Accessibility loss was invisible — FIXED

`onInterrupt()` only logged. `onUnbind()` cleared the flag without telling anyone. A command in flight when the user revoked accessibility would time out or fail deep in the tree walk, and status still said "connected".

- `markDisconnected()` is the single path for interrupt / unbind / destroy
- `RareDeviceService.onAccessibilityLost()` records **why**, outliving the service object destroyed on revocation
- `DeviceBridge.capabilities()` exposes `accessibilityLostReason`

### 1.4 The Gemini test could not fail — FIXED

`verify_gemini_modes_live.ts` always exited 0, even when every mode returned empty text. A CI job on it would have gone green while the provider was down.

Now exits 1 when any mode returns no text. **Verified both directions:** valid key → 0, invalid key → 1.

---

## 2. New CI workflows

| Workflow | Purpose | Status |
|---|---|---|
| `scheduler-tick.yml` | Drives `/api/scheduler/tick` every 5 min; secret in a **header**, never the URL | **PARTIAL** — needs the secret |
| `gemini-live.yml` | Four modes against the real provider; skips loudly without a key | **PARTIAL** — needs the key |

Vercel Cron was rejected: the Hobby plan allows one run per day, which cannot serve "every two minutes". No upgrade was made.

---

## 3. Verified this phase

| Item | Status | Evidence |
|---|---|---|
| Full test suite | **PASS** | All suites green |
| Typecheck | **PASS** | `tsc --noEmit` exit 0 |
| CI typecheck + build | **PASS** | GitHub Actions, commit `c49b66c` |
| Scheduler engine | **PASS** | 43 assertions |
| Cron / natural language / DST | **PASS** | 29 assertions |
| Scheduler capability | **PASS** | 24 assertions, real server |
| Intent routing | **PASS** | 35 assertions |
| Vision Studio generation | **PASS** | Live, Pollinations, no key |
| Binary export PNG + JPEG | **PASS** | Byte-for-byte |
| Gemini four modes | **PASS** | 4/4 live |
| Gemini CI gate fails correctly | **PASS** | Invalid key → exit 1 |
| Accessibility loss detection | **PASS** | Code; hardware untested |

---

## 4. Not verified

| Item | Status | Why |
|---|---|---|
| Wake word on hardware | **NOT TESTED** | Needs the phone |
| Background microphone | **NOT TESTED** | Needs the phone |
| Overlay over other apps | **NOT TESTED** | Needs the phone |
| Real accessibility tap/type/scroll | **NOT TESTED** | Needs the phone |
| Android MCP on hardware | **NOT TESTED** | Simulated device only |
| WhatsApp monitoring on hardware | **NOT TESTED** | Simulated device only |
| PostgreSQL concurrency | **BLOCKED** | No `DATABASE_URL` |
| External MCP server | **BLOCKED** | None configured |
| True inpainting | **NOT IMPLEMENTED** | No mask-capable free provider |
| Gemini image generation | **BLOCKED** | Zero free quota |

---

## 5. Preserved, untouched

- Production signing identity — **no change**
- GitHub signing secrets — **no change**
- Production deployment settings — **no change**
- No billing enabled, no paid API used, no plan upgraded
- No production release published
- No intermediate APKs built for progress reporting

---

## 6. Honest assessment

RARE is **not complete**. What is true:

- The web platform is healthy and its core paths are genuinely tested.
- The scheduler now executes real actions, not just stores rows.
- The Assistant can route an action request to the right place.
- Vision Studio produces real AI images at zero cost and exports real files.
- The Android code is written and compiles.

What is not true, and must not be claimed:

- The Assistant's voice half has never run on a phone.
- No device action has been performed on real hardware.
- PostgreSQL concurrency is written, not proven.
- Inpainting does not exist.

The gap between "coded" and "verified" is exactly the physical device and the database. Both need the owner.

---

## 7. Owner actions

See `REMAINING_BLOCKERS.md` §A. In priority order:

1. **Signing identity decision** — blocks release
2. **Physical device testing** — blocks the Assistant's voice half
3. `RARE_SCHEDULER_SECRET` — unblocks the production tick
4. `GEMINI_API_KEY` — unblocks Gemini CI
5. `DATABASE_URL` — unblocks PostgreSQL proof
6. Rotate the Gemini key pasted into chat
