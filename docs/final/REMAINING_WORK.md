# RARE — Remaining Work

**Inspected state:** `main` @ `a856815`, working tree clean.
**Verified this session:** `npx tsc --noEmit` clean; `npm test` all suites pass; live `https://rareproject.vercel.app` returns 200 and `/api/scheduler/status` returns 401 (auth gate works).

Status labels: **PASS** · **PARTIAL** · **BLOCKED** · **NOT IMPLEMENTED** · **NOT TESTED**

---

# Section 1 — Everything still required

Ordered by what blocks release first.

## 1.1 Release-blocking

### Scheduler production trigger — **NOT IMPLEMENTED**
- **Missing:** `vercel.json` has no `crons` entry. `ScheduleEngine.start()` is skipped when `process.env.VERCEL` is set (`server.ts:6136`), and nothing calls `POST /api/scheduler/tick`. On the deployed environment the engine never ticks.
- **Why:** serverless has no long-lived timer; the tick endpoint was built but never wired to a caller.
- **Closes it:** add a `crons` block to `vercel.json` hitting `/api/scheduler/tick` with `x-rare-scheduler-secret`. Vercel Hobby allows **1 cron/day only** — a 2-minute interval needs Pro (paid, forbidden) or an external free pinger (cron-job.org / GitHub Actions schedule).
- **Owner action:** none to implement; **decision needed** on free external pinger vs. accepting daily granularity.

### PostgreSQL multi-instance concurrency — **PARTIAL**
- **Missing:** `PostgresScheduleStore` exists with atomic `UPDATE … RETURNING payload` claims (`ScheduleStore.ts:125`) and lease fields (`lease_owner`, `lease_expires_at`). But no `DATABASE_URL` was reachable in this sandbox, so the store fell back to `mode: 'local'`. Cross-process safety is **written and typechecked, never executed**.
- **Why:** no database connection available to the build environment.
- **Closes it:** run the engine against a real Postgres with two competing workers; assert one claim, one execution, lease reclaim after kill -9.
- **Owner action:** provide a reachable `DATABASE_URL` (Supabase free tier is fine).

### Signing identity — **BLOCKED (owner decision)**
- **Missing:** two identities exist — A `C550FD65…5BC57B` (backed up, in your hands) and B `37be10e9…badee1df` (signs v1.1.2+). B is **not** backed up outside GitHub secrets + one Windows DPAPI file.
- **Why:** commit `aefc54c` switched identity; the old key was declared unrecoverable.
- **Closes it:** your choice — keep B (back it up properly) or return to A (all users reinstall).
- **Owner action:** **required.** Nothing changes until you decide.

### Physical Android verification — **NOT TESTED**
- **Missing:** every device claim below rests on emulator install/launch or simulated queues.
- **Owner action:** **required** — install the APK on the Infinix Smart 8, grant Accessibility + Notification Access.

## 1.2 Android / Assistant

### Wake-word detection — **PARTIAL (coded, unverified on hardware)**
- **Missing:** `RareWakeWordService.java` uses Android's own `SpeechRecognizer` in short listening cycles, matching `"hey rare"` plus homophones (`:229`). It is **not** a dedicated keyword spotter (no Vosk KWS path active by default).
- **Why:** SpeechRecognizer is battery-heavy and unreliable in background on many OEM ROMs.
- **Closes it:** physical test; if it fails in background, wire `VoskWakeEngine` as the primary path.
- **Owner action:** physical test.

### Background microphone — **NOT TESTED**
- **Missing:** no evidence the foreground service keeps the mic alive when the screen is off or another app is foreground, on Android 13 with Infinix power management.
- **Owner action:** physical test.

### Compact overlay — **PARTIAL (coded, unverified)**
- **Missing:** `RareOverlay.java` builds a `TYPE_APPLICATION_OVERLAY` pill with `FLAG_NOT_FOCUSABLE` (`:74–86`); `AssistantStudioView.tsx` is the in-app view. No evidence the overlay renders over other apps on hardware.
- **Owner action:** physical test.

### Accessibility actions (tap/type/scroll/read) — **PARTIAL (coded, unverified)**
- **Missing:** `RareAccessibilityService.java` implements node-tree read, tap, type, scroll, gestures. `tests/test_device_actions.ts` is **pure validation logic** — it asserts the action catalogue and schema, explicitly "No device is required". That is not execution proof.
- **Owner action:** physical test.

### Permission revocation handling — **PARTIAL**
- **Missing:** missing permissions are reported honestly at the bridge (`DeviceBridge.java:216`, `VoiceBridge.java:203`). No `onServiceDisconnected` / `onInterrupt` listener was found in the accessibility service, so mid-session revocation may not be detected.
- **Closes it:** add `onServiceDisconnected` handling; test by revoking Accessibility while a task runs.
- **Owner action:** none.

### Android MCP on real hardware — **PARTIAL**
- **Missing:** 12 `android_*` tools exist in `scripts/android-mcp-server.mjs` and were proven over real MCP stdio with a **simulated** device. No real phone has executed a tool call.
- **Owner action:** physical test.

### Assistant orchestration end to end — **PARTIAL**
- **Missing:** `IntentRouter.ts` routes deterministically to conversation/research/build/repository/deploy/self_build/documents. It does **not** route to device actions, schedules, or plugins — those are separate paths. No single verified flow of "speak → plan → act → observe → report" on hardware.
- **Closes it:** extend the router to device/schedule/plugin intents; test the combined flows.
- **Owner action:** none.

## 1.3 Vision Studio

### Documents export of real image files — **PARTIAL**
- **Missing:** `/api/images/export` calls `DocumentsService.importBuffer`, which runs `processBuffer` and then `this.save(ownerId, path, result.text, …)` — it persists **extracted text, not the image bytes** (`DocumentsService.ts:308`). The export succeeds but stores a description, not the picture.
- **Why:** Documents storage is text-only by design.
- **Closes it:** add a binary blob store (or store base64 in a sidecar) and have export write the real file. `GET /api/images/:id/download` already delivers true bytes.
- **Owner action:** none.

### True inpainting-style editing — **NOT IMPLEMENTED**
- **Missing:** no `inpaint` or `mask` code anywhere in `src/server` (only an unrelated comment in `BuildRunner.ts`). Editing is prompt-guided regeneration via Pollinations — it does not preserve unmasked pixels.
- **Closes it:** a provider with mask support (paid) or a local diffusion model with inpainting (needs GPU/RAM).
- **Owner action:** none; accept regeneration or approve a paid provider.

## 1.4 Integration

### MCP/plugin through Chat, Assistant, Scheduler, Agents — **PARTIAL**
- **Missing:** `McpClientManager` works (13 tools discovered, real call returned) but **no external server is configured** on the deployment (`configured: false`). Invocation from Chat/Assistant/Agents is untested; Scheduler dispatch path exists but was exercised with a simulated device.
- **Closes it:** register a free reference MCP server; invoke a tool from each surface.
- **Owner action:** none.

### Gemini live verification in CI — **NOT IMPLEMENTED**
- **Missing:** `scripts/verify_gemini_modes_live.ts` exists; `grep -i gemini .github/workflows/` returns nothing. Manual script only.
- **Closes it:** add a workflow on `workflow_dispatch` + PR, secret via `secrets.GEMINI_API_KEY`, never echoed.
- **Owner action:** add the secret to the repo.

### Local model inference — **PARTIAL**
- **Missing:** `src/engine/providers/transformers-local.ts` exists but no SmolLM/Qwen model is wired or tested in this tree. Prior run proved SmolLM2-135M works and Qwen2.5-0.5B OOMs at 773 MB RAM.
- **Closes it:** pin the small model, add a memory pre-check, report `loaded` only after a real token is generated.
- **Owner action:** none.

### Authentication / interface corrections — **PASS (automated)**
- `tests/test_auth_interface.ts` passes: initials derive from email, guest→signed-in transition, session restore, expiry. Not re-verified in a browser this session.

## 1.5 Release candidate

### Consolidated APK — **NOT BUILT (deliberately)**
- **Missing:** no new APK this phase, per instruction. Last verified build: `rare-v1.1.2-release.apk`, 13,015,852 bytes, SHA-256 `37bd5a3c…df76`, commit `4a1bb2f`.
- **Closes it:** one CI run of `build-apk-now.yml` after the above fixes land.
- **Owner action:** approve the build.

---

# Section 2 — Capabilities RARE should have

Not requested, but they separate "feature tiles" from a real platform. All judged against zero cost.

| Capability | What it is | Why it matters | Effort | Zero-cost? |
|---|---|---|---|---|
| **User-editable long-term memory** | Inspect/edit/delete what RARE remembers | Trust; wrong memories poison every reply | M | ✅ local store |
| **Multimodal input** | Image/audio/PDF/screen into one prompt | "What's wrong with this screenshot" | M | ✅ Gemini free tier |
| **Real-time voice conversation** | Streaming STT→LLM→TTS, barge-in | Wake word is useless without it | L | ✅ Web Speech + free TTS |
| **Browser automation** | Playwright-driven real browsing | Research beyond static fetch; login-gated pages | M | ✅ Playwright is free |
| **Code execution sandbox** | Run generated code safely | Project Builder currently builds but can't iterate | M | ✅ local container |
| **Document generation** | Real PDF/DOCX/XLSX/PPTX output | Documents is text-only today | M | ✅ libreoffice/pandoc |
| **Citations with provenance** | Every claim → source span | Research exists; span-level proof doesn't | S | ✅ |
| **Structured data analysis** | CSV/DB → charts → narrative | Common real request, currently manual | M | ✅ pandas |
| **Calendar/email integration** | Read/write via MCP | Assistant can't act on your day | M | ✅ free MCP servers |
| **Proactive background agents** | Watch and act without being asked | Scheduler is the seed; needs triggers | L | ✅ |
| **Multi-agent handoff** | Agents delegate with shared context | Single-agent ceiling | L | ✅ |
| **Tool-calling with retries** | Structured retry/backoff on tool failure | Silent tool failure is the #1 trust killer | S | ✅ |
| **Self-critique / eval loop** | Model grades its own output before send | Cheap quality lift | S | ✅ |
| **Prompt-injection defence** | Already partly built (research markers) | Extend to documents, MCP results, web | S | ✅ |
| **Observability + cost tracking** | Per-request tokens, latency, provider | You cannot manage what you can't see | S | ✅ |
| **Offline/local fallback** | Small model when network dies | Already half-built | M | ✅ |
| **Cross-device sync** | Phone ↔ web state | Phone-first vision demands it | L | ✅ Supabase free |
| **Accessibility** | Screen reader, contrast, large text | Also the foundation of device control | M | ✅ |

**Highest value per effort:** tool-calling retries, self-critique, observability, user-editable memory. All small, all free, all raise perceived reliability immediately.

---

# Section 3 — Is the Assistant complete?

**No.**

### Works today
- **Chat orchestration** — `IntentRouter` deterministically routes to research / build / repository / deploy / self-build / documents, with an inspectable reason and confidence. Tested.
- **Research** — real multi-provider search, full-page reads, injection defence, honest "could not read" disclosure. 31 assertions pass.
- **Documents** — upload, OCR, extraction, indexing, Q&A. 43 assertions pass.
- **Auth lifecycle** — guest → sign-in → restore → expiry. Passes.
- **Vision Studio generation** — real AI images via Pollinations, verified live in production.

### Coded but unproven
- **Wake word** — `SpeechRecognizer` loop matching "hey rare". Never heard on a real phone.
- **Background microphone** — foreground service exists; survival under Android 13 OEM power management unknown.
- **Compact overlay** — `TYPE_APPLICATION_OVERLAY` pill implemented; never rendered over another app.
- **Accessibility actions** — tap/type/scroll/read implemented; only the *schema* is tested, never a real tap.
- **Android MCP** — 12 tools, real protocol, simulated device only.
- **Scheduler execution** — engine, cron parser, leases, dedupe all pass locally; **never ticked in production** (no cron entry).

### Not implemented
- **Device/schedule/plugin intents in the Assistant router** — the Assistant cannot currently be *asked* to "open WhatsApp" and route there.
- **True inpainting** — regeneration only.
- **Binary image export to Documents** — writes text, not bytes.
- **Gemini CI** — script exists, workflow doesn't.

### The honest line

> **Wake-word detection, background microphone operation, the compact overlay, and physical device control cannot be called complete until they are tested on your actual Android phone.** Everything above them is code and simulation. The Assistant is a working *chat and research* assistant today; it is not yet a working *voice-and-device* assistant.

**Assistant completeness: roughly 55%** — strong on text, unproven on voice, absent on device routing.
