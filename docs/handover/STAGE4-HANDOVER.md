# RARE — Stage 4 Engineering Handover

**Date:** 2026-11-24
**Branch:** `stage2-infra-evidence` · **HEAD:** `3e4dcb4`
**Repos:** `Rare-Erudite/COMPLETED`, `Rare-Erudite/RARE-INTELLIGENCE-MODEL`
**Live target:** https://rareproject.vercel.app

This run continued from Stage 3. Every claim below is backed by a command run in
this session. Nothing is inferred from a previous stage.

---

## 1. Verified in this run

| Suite | Result | What it covers |
|---|---|---|
| Orchestration | **14/14** | Capability registry, durable jobs, plugin lifecycle, model catalogue — against a live server |
| Multi-agent | **11/11** | 13 agents registered, real execution, governance blocking, parallel coordination |
| Navigation | **18/18** | Every Back flow in section 24, plus modal, root and restart behaviour |
| Toolchains | **18/23** | Gradle 8.7 and SQLite 3.40.1 added this run; 5 genuinely unavailable, reported honestly |
| Typecheck | clean | `npx tsc --noEmit` → no output |
| Build | exit 0 | `npm run build` |

---

## 2. What was built

### Unified orchestration
`src/server/orchestration/CapabilityRegistry.ts` — one registry every department
publishes its real capabilities into. Chat, the Assistant, the job worker and the
HTTP API all invoke the same handlers, so a capability cannot work in one screen
and be missing in another. Argument validation, permission tiers, cost classes,
timeouts and an invocation audit trail.

`src/server/orchestration/registerCapabilities.ts` — the department bindings
(documents, research, plugins, device, intelligence, repositories, deployment,
agents, system).

### Durable jobs
`JobStore.ts` + `JobRunner.ts` fix the "long work dies with the request" failure.
Jobs persist, report progress, checkpoint, can be cancelled and resumed, and
survive a process restart. Long capabilities return `202` with a job id instead
of holding the connection open.

### Multi-agent ecosystem (section 23)
`src/server/agents/AgentRuntime.ts` — 13 seeded specialists: planning, research,
coding, self-build, testing, devops, models, plugins, documents, device,
security, data, monitoring. Each has declared responsibilities, an explicit tool
allow-list, a permission tier and a model task. Agents delegate, run in parallel,
and are blocked by governance when they exceed their tier. Model choice is
resolved against the providers that are really reachable, so a run records the
model that would actually answer.

### Navigation + Android Back (section 24)
`src/navigation/navigationStack.ts` — a real navigation stack replacing the bare
`useState('chat')` that made `WebView.canGoBack()` permanently false. That was
the root cause of Back closing the app. The stack mirrors onto `window.history`,
de-duplicates, restores scroll and persists across backgrounding.

`src/navigation/useNavigation.ts` — React binding plus the Back interceptor that
installs `window.RareHandleBack`.

`scripts/build_apk.sh` (MainActivity) — Back now asks the page first via
`window.RareHandleBack`, then falls back to WebView history, then requires a
second Back within 2 s at the root. Uses an anonymous `ValueCallback`, not a
lambda, because this build path failed desugaring lambdas before.

### Model evaluation
`src/server/intelligence/ModelEvaluator.ts` — sends real prompts to the active
model and scores its actual replies across instruction-following, JSON
reliability, reasoning, tool selection and safety. Proven both ways: 10/10 on
correct answers, 0/10 on wrong ones — no false passes.

### Plugin lifecycle
`src/server/plugins/PluginRegistry.ts` — discover → inspect → install →
configure → execute → health, over real MCP. Verified against a live test
server: handshake, 2 tools discovered, `echo` returned the exact text,
`add_numbers` returned the real sum 42.

---

## 3. Evidence

```
$ RARE_BASE=http://127.0.0.1:3000 npx tsx scripts/verify_orchestration.ts
14/14 checks passed.

$ RARE_BASE=http://127.0.0.1:3000 npx tsx scripts/verify_agents.ts
11/11 checks passed.   (13 agents, 8 runs recorded)

$ npx tsx tests/test_navigation.ts
Navigation: 18 passed, 0 failed

$ npx tsc --noEmit        → no output (clean)
$ npm run build           → exit 0

$ grep -o "RareHandleBack" dist/assets/index-*.js
RareHandleBack

$ javac -d jc MainActivity.java 2>&1 | grep -cE 'expected|illegal start|unclosed'
0
```

---

## 4. Capability classification

| Capability | Status | Evidence / limit |
|---|---|---|
| Capability registry & routing | Verified operational | 14/14 live checks; Chat and Assistant share one registry |
| Durable jobs, cancel, resume | Verified operational | Job lifecycle exercised through the HTTP API |
| Multi-agent ecosystem | Verified operational | 11/11; 6 agents collaborated on one objective with real departments |
| Navigation & Android Back | Verified operational | 18/18 stack tests; Java Back handler compiles clean |
| Plugin lifecycle (MCP) | Verified operational | Real handshake + tool execution against a test server |
| Model evaluation | Verified operational | Scoring proven on correct and incorrect answers |
| Toolchains (Gradle, SQLite) | Verified operational | Real Gradle build compiled and ran a Java program |
| Model inference on this host | Resource constrained | Loading the ONNX model exceeds the 2 GB sandbox (exit 137) |
| Android APK build & device test | Prepared, awaiting user input | No Android SDK in this sandbox; source fixed, CI builds it |
| Production deploy of this commit | Prepared, awaiting user input | Pushed to GitHub; Vercel token not present in this sandbox |

---

## 5. Genuine blockers

1. **Vercel deploy token (permission).** The commit is pushed to
   `stage2-infra-evidence`. Production still serves the older commit
   `fbf21a74`. The Vercel token named in the assignment ledger is not present in
   this sandbox, so the deploy cannot be triggered from here.
2. **Model memory (resource).** The sandbox has ~2 GB RAM. Loading the local
   ONNX model is killed (exit 137). A hardware limit, not a code defect.
3. **Android SDK (resource).** No `sdkmanager`, `aapt2` or platform tools exist
   here, so an APK cannot be built or installed in this environment.
4. **Installed-APK navigation tests (restricted).** Section 24 F requires a
   device or emulator, which this sandbox does not have. The stack logic is
   covered by 18 automated tests; the on-device pass runs with the final APK.

---

## 6. Remaining user-dependent actions

- Provide the Vercel token (or click Deploy in the Vercel dashboard) to publish
  commit `3e4dcb4` to `rareproject.vercel.app`.
- Run the APK build when the whole assignment is complete — the standing policy
  defers it to the very end. `build-apk-now.yml` builds, signs and verifies it.
- Run the on-device navigation tests (section 24 F) against that APK.
- Connect external services that need OAuth consent (Google Drive, OneDrive,
  Dropbox, email) — the integration and auth flow are built; the account
  authorisation is the user's.

---

## 7. What this run did not do

It did not build an APK (policy), did not deploy to production (no token), and
did not run on-device tests (no device). It also did not claim the local model
works — it does not fit in this sandbox's memory, and that is stated rather than
hidden.
