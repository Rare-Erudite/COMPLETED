# RARE — Capability Status Report

**Date:** 2026-11-20
**Branch merged:** `rare-oss-rebuild` → `main`
**Scope:** the RARE app's capabilities (the model/engine repo is out of scope per instruction).

This report is honest about what exists, what was built in this pass, and what still
does not work. Nothing here is claimed as verified unless a command in this run produced
the result.

---

## Summary

| # | Capability | Before this pass | This pass | Status |
|---|-----------|------------------|-----------|--------|
| 1 | LLM planner wired to device layer | Planner was a **hardcoded template** (`decomposer.ts`); device bridge was client-only, never driven by a model | Built a real **plan → act → observe** loop: server `DevicePlanner` (LLM), canonical action catalogue, client `deviceAgent`, `/api/device/plan` route, Assistant UI panel | **Built** |
| 2 | Assistant system as a whole | Chat, voice, device panel, memory, tools all present | Wired the autonomous task + wake word into the Assistant panel | **Present + extended** |
| 3 | Wake word | **Absent** (no hotword code anywhere) | Added `RareWakeWordService` (foreground service, Android SpeechRecognizer) + `WakeWordBridge` + web bridge + UI toggle | **Built (with stated limits)** |
| 4 | Self-build system | `SelfDevelopmentEngine`, `project-builder`, `ToolchainRegistry` present | Audited; no change needed | **Present** |
| 5 | Update system | `/api/updates/*` routes, `UpdateStore`, in-app `InstallerBridge` present | Audited; no change needed | **Present** |
| 6 | Documents | `/api/documents/*` (parse, import, preview, rename, transcribe) present | Audited; no change needed | **Present** |
| 7 | Research | `/api/research/*` + `ResearchProvider` present | Audited; no change needed | **Present** |
| 8 | Chat | `/api/chat/*`, `ChatPipeline` present | Audited; no change needed | **Present** |
| 9 | Sign in / sign up | `/api/user/signup`, `/login`, `/oauth`, `/guest-session`, OTP present | Audited; no change needed | **Present** |
| 10 | Projects and build | Project build routes + `ProjectBuild` tests present | Audited; no change needed | **Present** |
| 11 | Read/work on all languages | `ToolchainRegistry` + language detection present | Audited; no change needed | **Present** |
| 12 | Full build/test/deploy toolchain | `ToolchainRegistry`, build/test/deploy routes present | Audited; no change needed | **Present** |
| 13 | Plugins | Static `pluginsDirectory` + **real MCP client** (`McpClientManager`, stdio/SSE/HTTP) | Audited; no change needed | **Present** |
| 14 | Communication with other apps | Android intents via `DeviceBridge.openApp`, notifications listener, MCP | Audited; no change needed | **Present** |

---

## Capability 1 — LLM planner wired to the device layer (top priority)

### What existed
- `src/engine/planner/decomposer.ts` produced a **fixed template** of steps — it did not
  call a language model and could not adapt to what was on screen.
- `src/device/deviceBridge.ts` exposed the native `window.RareDevice` bridge, but it was
  only used by a manual button panel. No model ever drove it.
- The server had a `ToolRegistry` for engine tools, but no device tools and no loop.

### What was built
1. **`src/device/deviceActions.ts`** — the canonical catalogue of 15 device actions
   (`describe_screen`, `tap_text`, `tap_id`, `tap_at`, `swipe`, `type_text`, `scroll`,
   `global_action`, `open_app`, `notifications`, `list_apps`, `show_overlay`,
   `hide_overlay`, `wait`, `finish`). It is the **security boundary**: `validateDeviceAction`
   rejects any action not in the catalogue or with arguments that do not match the schema,
   so a model can never invent a capability the native layer does not implement.
2. **`src/server/device/DevicePlanner.ts`** — the "model plans" half. Given the objective,
   the current screen and the history of what was tried, it asks the active provider for
   the **single next action**, validates it, and returns it. If no model is reachable it
   says so and returns no action rather than inventing one.
3. **`src/device/deviceAgent.ts`** — the "device acts, results feed back" half. It reads
   the screen, calls `/api/device/plan`, performs the action through the native bridge,
   records the **real** result, re-reads the screen, and repeats until `finish` or the step
   budget is spent. It reports every step live and stops honestly if the bridge is absent.
4. **`POST /api/device/plan`** and **`GET /api/device/actions`** in `server.ts`.
5. **Assistant UI** — an "Autonomous task" panel in `AssistantStudioView.tsx` that runs the
   loop, shows each step with its real result, and asks the user to confirm before acting.

### What still does not work
- The loop needs a **reachable language model** (a configured provider key). Without one,
  the planner returns an honest "no model available" error — it does not fake a plan.
- The loop runs **inside the RARE Android app** (it needs `window.RareDevice`). In a browser
  tab it reports that device control is unavailable.
- It has **not been exercised on a physical phone** in this run; the emulator smoke test in
  CI launches the app but does not drive a multi-step task.

---

## Capability 3 — Wake word

### What existed
Nothing. No hotword, wake-word, Porcupine or Vosk code anywhere in the repo.

### What was built
- **`android/device/RareWakeWordService.java`** — a foreground service that keeps Android's
  own `SpeechRecognizer` listening in short cycles and matches "hey rae" (and close
  variants) in partial/final transcripts, then broadcasts `WAKE_DETECTED`.
- **`android/device/WakeWordBridge.java`** — `window.RareWake` start/stop/status.
- **`src/device/wakeWordBridge.ts`** — web-side bridge.
- **UI toggle** in the Assistant panel with the real state and the limits stated on screen.
- Registered the service in the generated manifest and the bridge in `MainActivity`
  (both produced by `scripts/build_apk.sh`).

### What still does not work / limits (stated in the UI)
- Uses Android's `SpeechRecognizer`, which is **usually network-backed** — wake detection
  needs connectivity unless an offline language pack is installed.
- It is a **foreground service with a persistent notification**, not a low-power DSP; it
  costs battery and Android may throttle it.
- It does **not** run when the app is force-stopped or the phone is locked.
- No dedicated on-device hotword engine (e.g. Porcupine) was added, because its licence
  (Picovoice) is not a permissive one that permits free redistribution in a signed APK.

---

## Capabilities 2, 4–14

These were audited and found to have working implementations already in the codebase
(see the route/module references in the summary table). No code was changed for them in
this pass beyond the Assistant-panel wiring for #2. Their correctness is covered by the
existing unit and E2E suites, which pass (see the verification report).
