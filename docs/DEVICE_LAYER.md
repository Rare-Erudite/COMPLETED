# RARE Device-Control Layer

This document describes the Android device-control layer added to RARE: what it
does, which open-source projects it was adapted from, and what it deliberately
does not do.

## What it is

RARE's Android shell was a WebView with an installer bridge. It could show the
web app but could not operate the phone. This layer adds the capability the
inventory recorded as missing: the assistant can read the screen, tap, type,
scroll, navigate, open apps, read notifications and keep itself alive during a
multi-step task.

It is built from four Android components plus a JavaScript bridge:

| File | Role |
| --- | --- |
| `android/device/RareAccessibilityService.java` | Reads the screen as a node tree; performs taps, typing, scrolling, gestures, global navigation and app launches. |
| `android/device/RareNotificationListener.java` | Reads the notification shade (last 50, in memory only). |
| `android/device/RareOverlay.java` | A draggable status pill drawn over other apps, so the user can always see when RARE is operating the phone. |
| `android/device/RareDeviceService.java` | A foreground service that keeps the layer alive during a task. |
| `android/device/DeviceBridge.java` | The `window.RareDevice` JavaScript interface. |
| `android/device/VoiceBridge.java` | The `window.RareVoice` interface: on-device speech recognition and TTS. |
| `android/device/DeviceState.java` | Process-wide capability state. |
| `android/device/RareJson.java` | A minimal JSON writer (no dependency resolution in a hand-built APK). |

The web side is `src/device/deviceBridge.ts` and `src/device/voiceBridge.ts`,
consumed by `src/components/AssistantStudioView.tsx`.

## Architecture

```
WebView (RARE web app)
   │  window.RareDevice.<method>()  →  JSON string
   ▼
DeviceBridge  ──(main thread, bounded latch)──▶  RareAccessibilityService
   │                                                   │
   │                                                   ├─ AccessibilityNodeInfo tree (read)
   │                                                   ├─ performAction / dispatchGesture (act)
   │                                                   └─ startActivity (launch)
   ├─ RareNotificationListener.describeRecent()
   ├─ RareOverlay.show() / hide()
   └─ RareDeviceService start/stop
```

Every bridge method returns `{ "ok": boolean, "message"|"error": string }`. The
web layer renders that verbatim. Nothing is reported as done unless the platform
call returned success.

## Permissions (all user-granted, none automatic)

| Permission | Granted in | What it enables |
| --- | --- | --- |
| Accessibility service | Settings → Accessibility → Installed services → RARE | Screen reading, taps, typing, gestures, navigation |
| Notification access | Settings → Notifications → Device & app notifications → RARE | Reading the notification shade |
| Display over other apps | Settings → Apps → RARE → Display over other apps | The floating status pill |
| Microphone | Runtime prompt | Voice input |
| Notifications (API 33+) | Runtime prompt | The foreground service notice |

The Assistant panel shows the real state of each and offers an **Enable** button
that opens the exact Settings screen. It never claims a capability it has not
been granted.

## Safety properties

- **Password fields are redacted.** Any node with `isPassword()` true has its
  text and content description replaced with `[redacted]` before it leaves the
  process.
- **Every action is bounded.** Screen traversal is capped at depth 40 and 1,200
  nodes; bridge calls time out after 4 seconds; MCP calls after 30 seconds.
- **No silent installs.** The installer bridge still hands control to Android's
  own confirmation dialog; a sideloaded app can never install silently.
- **No background microphone.** Wake-word is still not claimed, because it needs
  an always-on microphone that Android only grants to a foreground service with
  a visible notification — which RARE does not run for that purpose.

## Open-source provenance

The layer is **adapted**, not copied. The architecture follows the
accessibility-service pattern established by these MIT-licensed projects, whose
public documentation and design were used as the reference:

| Project | Licence | What was taken |
| --- | --- | --- |
| [KnifeLemon/Droidline](https://github.com/KnifeLemon/Droidline) | MIT | The accessibility-service-as-a-driver pattern: a service that exposes screen reading and gesture dispatch to a front-end. |
| [imoonkey/closepaw](https://github.com/imoonkey/closepaw) | MIT | The node-tree serialisation approach (text/desc/id/bounds/flags per node) and the "walk up to the nearest clickable ancestor" tap strategy. |
| [AutoXiao'er](https://github.com/AutoXiao-er/AutoXiaoer) | MIT | The idea of combining accessibility with a privileged path (Shizuku) for actions accessibility cannot perform. RARE does **not** ship Shizuku; the pattern is noted as the next step. |
| Android platform samples | Apache-2.0 | The `NotificationListenerService` and `AccessibilityService` lifecycle patterns, and the JSON escaping table in `RareJson`. |

No source file from any of these projects was copied verbatim. The Java here is
RARE's own, written against the Android SDK, using their designs as the
reference. See `docs/SOURCE_INVENTORY_AND_LICENCES.md` for the full licence
analysis and `docs/LICENCE_COMPLIANCE.md` for the compliance verdict.

## What is not built

- **Shizuku integration.** Privileged actions (e.g. granting a permission
  without a dialog) need Shizuku, which requires the user to install a separate
  app and start it over ADB. The pattern is documented; it is not shipped.
- **MediaProjection screen capture.** Reading the screen as pixels (for
  canvas-drawn UI) needs a MediaProjection consent flow. The node tree covers
  the vast majority of apps; pixel capture is the next step.
- **A multi-step planner that drives the layer autonomously.** The layer exposes
  the primitives; wiring an LLM planner to call them in a loop is a separate
  piece of work.
