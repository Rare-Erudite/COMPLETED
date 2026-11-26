# RARE — Evidence Index

**Starting commit:** `4a1bb2f48c7315dd2f2c8a05b0860fe433b569a8`
**Date:** 2026-11-26
**Environment:** Debian Linux, Node 20.20.2, Python 3.11, 1 vCPU / 2 GB RAM

Every claim below traces to a command run in this session. Nothing is inferred from a UI, a registered capability or an HTTP 200.

---

## Documents

| File | Contents |
|---|---|
| `docs/final/SCHEDULER_VERIFICATION.md` | Scheduler engine: 29 parser + 43 engine assertions, live HTTP evidence |
| `docs/final/MCP_VERIFICATION.md` | Android MCP server: 12 tools, real handshake, full round trip |
| `docs/final/PLUGIN_VERIFICATION.md` | Plugin registry + MCP client execution |
| `docs/final/VISION_STUDIO_VERIFICATION.md` | Image provider status (429, limit 0) |
| `docs/final/SIGNING_IDENTITY_CONTINUITY.md` | Two identities, options, decision gate |

## Summary matrix

| Capability | Status | Evidence |
|---|---|---|
| Scheduler executes schedules | **PASS** | 43 engine assertions + live HTTP |
| Scheduler duplicate prevention (single process) | **PASS** | Lease test, step 12 |
| Scheduler duplicate prevention (multi-instance) | **PARTIAL** | Postgres path written, no DB reachable |
| Scheduler restart resume | **PASS** | Step 10 |
| Scheduler missed-run recovery | **PASS** | Step 11 |
| Scheduler timezone / DST | **PASS** | DST boundary test |
| WhatsApp monitoring | **PARTIAL** | Engine + dedupe proven; device simulated |
| Android MCP server | **PASS** | 12 tools, real round trip |
| Android device execution on hardware | **NOT TESTED** | No physical phone |
| Plugin registry | **PASS** | `/api/plugins` |
| MCP client execution | **PASS** | `mcp_smoke.mjs` |
| External MCP server configured | **BLOCKED** | `configured: false` |
| Gemini 4 text modes | **PASS** | Live provider, 4/4 |
| AI image generation | **BLOCKED** | HTTP 429, free-tier limit 0 |
| APK build / sign / install | **PASS** | Prior run, run 45901779874 |
| Signing identity resolved | **BLOCKED** | Owner decision required |

## Reproduce

```bash
cd rare-work/repo
npx tsx tests/scheduler/test_cron.ts       # 29 passed
npx tsx tests/scheduler/test_engine.ts     # 43 passed
npx tsc --noEmit                           # clean
npx tsx scripts/mcp_smoke.mjs              # MCP client PASS
node scripts/test-android-mcp-client.mjs   # needs a running server + device
GEMINI_API_KEY=... npx tsx scripts/verify_gemini_modes_live.ts
```

## What was NOT done

- No production release published.
- No signing identity changed, no secret replaced.
- No new APK built in this phase (the verified one from the prior run stands).
- No physical-device test performed.
