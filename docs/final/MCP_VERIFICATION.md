# Android MCP Server Verification

**Commit:** `4a1bb2f48c7315dd2f2c8a05b0860fe433b569a8`
**Date:** 2026-11-26

---

## What existed before

`McpClientManager` had **no device tools**. Device control was a WebView JavaScript bridge (`DeviceBridge`) — a page-to-native channel, not an MCP server. The earlier ZeroTap parity claim of "an Android MCP server" was **not implemented**.

## What was built

`scripts/android-mcp-server.mjs` — a real MCP server using the official `@modelcontextprotocol/sdk` over stdio.

**12 tools:**

| Tool | Purpose |
|---|---|
| `android_describe_screen` | Read the accessibility node tree |
| `android_list_apps` | List launchable apps |
| `android_notifications` | Read granted notifications (limit, package filter) |
| `android_tap_text` | Tap element by visible text |
| `android_tap_id` | Tap element by view id |
| `android_tap_at` | Tap coordinates |
| `android_type_text` | Type into the focused field |
| `android_scroll` | Scroll up/down/left/right |
| `android_swipe` | Swipe between two points |
| `android_global_action` | back / home / recents / notifications / quick_settings / lock |
| `android_open_app` | Launch by package |
| `android_device_status` | Connection and capability report |

### Transport

The phone cannot be dialled, so the server enqueues a command and the app polls:

```
MCP client → android_tap_text
  → POST /api/device/enqueue        (command queued)
  → phone POST /api/device/poll     (claims it)
  → RareAccessibilityService executes
  → phone POST /api/device/result   (posts outcome)
  → MCP client receives the real result
```

### Safety

- Every tool validates arguments against a schema before enqueuing.
- Consequential actions (`send_message`, `delete`, `purchase`, `submit`, `call`) are refused unless `RARE_ANDROID_MCP_ALLOW_CONSEQUENTIAL=true`.
- The owner is fixed at startup (`RARE_ANDROID_MCP_OWNER`); a client cannot address another user's device.
- No device connected → `isError: true` with a clear reason. Never a fabricated success.

---

## Evidence

`node scripts/test-android-mcp-client.mjs` against a live server with a simulated device:

```
HANDSHAKE: connected
TOOLS: 12 discovered
  - android_describe_screen
  - android_list_apps
  - android_notifications
  - android_tap_text
  - android_tap_id
  - android_tap_at
  - android_type_text
  - android_scroll
  - android_swipe
  - android_global_action
  - android_open_app
  - android_device_status

--- call android_device_status ---
isError: false
{ "online": true, "recent": [] }

--- call android_notifications (device online) ---
isError: false
{ "ok": true, "data": { "notifications": [ ... 3 notifications ... ] } }

--- call android_tap_text (real device action) ---
isError: false
{ "ok": true, "message": "tap_text executed on device" }

--- invalid args rejected ---
isError: true | Tool "android_tap_text" failed: text is required and must be a non-empty string

--- unknown tool rejected ---
isError: true | Unknown tool: android_nope
```

A genuine MCP `initialize` handshake, `tools/list` discovery of 12 tools, and `tools/call` executions that traversed the full enqueue → poll → execute → result path and returned verified results.

---

## Status

| Item | Status | Detail |
|---|---|---|
| Real MCP protocol (handshake, list, call) | **PASS** | Official SDK, stdio transport |
| 12 device tools exposed with schemas | **PASS** | Discovered by a real client |
| Tool call reaches the device channel and returns a result | **PASS** | Full round trip verified |
| Argument validation | **PASS** | Invalid args rejected with a clear message |
| Unknown tool rejection | **PASS** | Rejected |
| Consequential-action guard | **PASS** | Refused without explicit opt-in |
| Owner isolation | **PASS** | Owner fixed at startup |
| **Execution on physical Android hardware** | **NOT TESTED** | The device was simulated. No physical phone was available. |
| Integration with Chat / Assistant / Scheduler / Agents | **PARTIAL** | The Scheduler dispatcher can enqueue device actions and the MCP server uses the same queue, so the path is shared. Chat/Assistant wiring to this specific MCP server was not exercised. |

### What remains unverified

The MCP server is proven to speak MCP correctly and to drive the device channel end to end. What is **not** proven is that `RareAccessibilityService` on a real phone performs the tap/type/scroll correctly — that requires the owner to install the APK, grant Accessibility and Notification Access, and run the acceptance procedure.
