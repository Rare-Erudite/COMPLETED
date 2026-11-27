# Remaining blockers

**Commit:** `c49b66c` · **Date:** 2026-11-27

Every item below is unresolved. Nothing here is marked done.

---

## A. Owner action required

### A1. Signing identity decision — **BLOCKING RELEASE**

Two identities exist:

| | Fingerprint | Signed |
|---|---|---|
| A | `C550FD65…5BC57B` | v1.0.0, v1.1.0, v1.1.1 |
| B | `37be10e9…badee1df` | v1.1.2, v1.1.3, v1.2.0, v1.3.0 |

Commit `aefc54c` switched production to B and its release notes say the old signer was "not recoverable". B currently lives only in GitHub secrets plus a Windows DPAPI file on one machine — a single point of failure.

**Decision needed:** keep B (and back it up properly) or return to A (every install from v1.1.2 onward must be uninstalled and reinstalled).

**No signing change has been made.** Details: `SIGNING_IDENTITY_CONTINUITY.md`.

### A2. `RARE_SCHEDULER_SECRET` in GitHub Actions secrets

The tick workflow exits 1 by design without it. Same value as the deployment's.

### A3. `GEMINI_API_KEY` in GitHub Actions secrets

The Gemini workflow skips loudly without it. It cannot be proven to run in CI until set.

### A4. `DATABASE_URL` — through a secure channel

**Never** in a public message, never committed. Without it, PostgreSQL concurrency is typechecked but unexecuted, and the engine runs `mode: 'local'` (single-process only).

### A5. Physical device testing

Install the APK on the Infinix Smart 8 and run `ANDROID_PHYSICAL_DEVICE_ACCEPTANCE.md`. This is the only way wake word, background mic, overlay and real accessibility actions become verified.

### A6. Rotate the Gemini key

It was pasted in plaintext into chat.

---

## B. Blocked by external dependency

### B1. Gemini image generation — zero free quota

`gemini-3-pro-image-preview` returns **429** with `limit: 0`. Not a rate limit — a zero allowance. No billing will be enabled. Pollinations covers generation; this path stays unavailable.

### B2. PostgreSQL multi-instance concurrency

Atomic claims and lease fields are written and typechecked. Never executed. Needs A4.

### B3. External MCP server

`configured: false` on the inspected deployment. The client, handshake, discovery and tool execution all work against a local reference server; no external server is connected, so Chat/Assistant/Agent invocation of a *third-party* tool is unproven.

---

## C. Not implemented

### C1. True inpainting

No mask-based editing exists. Pollinations accepts no mask; a local diffusion model needs ≥6 GB VRAM (sandbox has 773 MB). Editing is prompt-guided regeneration and is labelled as such.

### C2. Android MCP on real hardware

The server and all 12 tools exist and execute against a simulated device. No real phone has been connected.

### C3. Wake word reliability under Android 13 background restrictions

`RareWakeWordService` uses `SpeechRecognizer` in short cycles. `VoskWakeEngine` exists but is not the default path. Whether it survives screen-off and OEM battery management is unknown without hardware.

---

## D. Verified only with simulators

| Item | Simulated | Real |
|---|---|---|
| Scheduler device dispatch | ✅ | ❌ |
| WhatsApp notification monitoring | ✅ | ❌ |
| Android MCP tool calls | ✅ | ❌ |
| Device actions (tap/type/scroll) | schema only | ❌ |

These are labelled PARTIAL or NOT TESTED everywhere, never PASS.

---

## E. What is genuinely done

For contrast, so the list above is not read as "nothing works":

- Scheduler engine executes, deduplicates, recovers, handles DST — **PASS**
- Scheduler capability from Chat/Assistant — **PASS**
- Intent routing for device/schedule/plugin — **PASS**
- Vision Studio AI generation (Pollinations, zero cost) — **PASS**
- Binary image export to Documents, PNG + JPEG byte-for-byte — **PASS**
- Gemini four modes live — **PASS**
- Gemini CI gate that actually fails — **PASS**
- Accessibility loss detection — **PASS** (code; hardware untested)
- Full test suite — **PASS**
