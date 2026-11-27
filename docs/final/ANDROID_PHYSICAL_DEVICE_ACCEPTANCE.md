# Physical Android device acceptance — Infinix Smart 8 (Android 13)

**Status: NOT TESTED.** Nothing in this document has been performed on hardware. It is the procedure the owner runs, with the exact expected result for each step.

Emulator install-and-launch is **not** physical-device acceptance and is not counted as such anywhere in this project.

---

## 0. Before you start

| Item | Value |
|---|---|
| Device | Infinix Smart 8, Android 13 |
| Package | `com.rare.ai.intelligence` |
| APK | from the `Build RARE APK` workflow artifact |
| Source commit | recorded in `RELEASE_CANDIDATE_VERIFICATION.md` |

Install: copy the APK to the phone and open it, or `adb install -r rare-*.apk`. Allow "install from unknown sources" for the file manager if prompted.

---

## 1. Permissions — grant all four

| # | Permission | Where | Expected |
|---|---|---|---|
| 1.1 | Accessibility | Settings → Accessibility → Installed apps → RARE → On | Toggle stays on; RARE shows "service connected" |
| 1.2 | Notification access | Settings → Notifications → Device & app notifications → RARE → Allow | Toggle stays on |
| 1.3 | Microphone | First "Hey RARE" attempt, or Settings → Apps → RARE → Permissions | Prompt appears; Allow works |
| 1.4 | Display over other apps | Settings → Apps → RARE → Display over other apps → Allow | Toggle stays on |

**If a toggle flips itself back off**, the OEM is killing the service — see §7.

---

## 2. Wake word — "Hey RARE"

| Test | Procedure | Expected |
|---|---|---|
| 2.1 Screen on, app open | Say "Hey RARE" clearly, 30 cm away | Overlay appears within ~2 s |
| 2.2 Screen on, app backgrounded | Go to home screen, say "Hey RARE" | Overlay appears over the home screen |
| 2.3 Screen off | Lock the phone, say "Hey RARE" | **May not work** — Android 13 restricts background mic. Record what happens |
| 2.4 Another app foreground | Open Chrome, say "Hey RARE" | Overlay appears over Chrome |
| 2.5 False positive | Talk normally for 2 minutes near the phone | No activation, or record how many false triggers |
| 2.6 Homophone | Say "Hey Rare", "Hey Ray" | Record which variants trigger |

**Report for each:** did it trigger, how long it took, and whether the overlay appeared.

---

## 3. Overlay

| Test | Expected |
|---|---|
| 3.1 Appears compact and unobtrusive | Small floating panel, not full-screen |
| 3.2 Renders above other apps | Visible over Chrome / WhatsApp |
| 3.3 Touch works | Tapping the panel responds |
| 3.4 Dismiss | Close button hides it |
| 3.5 Reopen | "Hey RARE" brings it back |
| 3.6 Rotation | Rotate the phone; layout stays usable |
| 3.7 Permission revoked | Turn off "Display over other apps"; overlay must not appear, and RARE must say why |

---

## 4. Device actions — the core test

Say each instruction and record what actually happened on screen.

| # | Instruction | Expected |
|---|---|---|
| 4.1 | "Describe what is on my screen" | RARE reads the visible screen and describes it accurately |
| 4.2 | "Open WhatsApp" | WhatsApp opens |
| 4.3 | "Open WhatsApp and show me my latest unread messages" | WhatsApp opens and navigates to chats |
| 4.4 | "Scroll down" | The current screen scrolls |
| 4.5 | "Tap on <visible button text>" | That control is tapped |
| 4.6 | "Type hello into the search box" | Text appears in the field |
| 4.7 | "Go back" | Previous screen |
| 4.8 | "Open Settings and turn on Wi-Fi" | Settings opens; Wi-Fi toggled |
| 4.9 | "Check my notifications" | RARE lists current notifications |
| 4.10 | "Read the latest notification" | RARE reads it aloud / shows it |
| 4.11 | "Open my browser and search for <topic>" | Browser opens with the search |
| 4.12 | "Send a message to <name> saying hi" | **Must ask for confirmation first** |

**4.12 is a safety test.** If RARE sends without asking, that is a defect — report it immediately.

---

## 5. Permission revocation mid-task

| Test | Procedure | Expected |
|---|---|---|
| 5.1 | Start "Open WhatsApp", then revoke Accessibility while it runs | RARE reports the action failed because accessibility was lost — **not** a success |
| 5.2 | Revoke Notification Access, then "Check my notifications" | RARE says notification access is unavailable |
| 5.3 | Restore both permissions | Next command works again without restarting the app |

This exercises the `onServiceDisconnected` / `onInterrupt` handling added in commit `c49b66c`.

---

## 6. Lifecycle and recovery

| Test | Expected |
|---|---|
| 6.1 Background the app for 10 min, then "Hey RARE" | Still responds |
| 6.2 Force-stop RARE, reopen | Services reconnect |
| 6.3 Reboot the phone | After unlock, services reconnect (may need the app opened once) |
| 6.4 Battery optimisation on | Record whether the service survives; then exclude RARE from optimisation and retest |

---

## 7. Manufacturer restrictions (Infinix / XOS)

Infinix runs XOS, which is aggressive about background apps. If wake word or services die:

1. Settings → Apps → RARE → Battery → **Unrestricted**
2. Settings → Battery → **Disable** "Smart power saving" for RARE
3. Recent apps → long-press RARE → **Lock** (prevents swipe-away)
4. Settings → Apps → RARE → Autostart → **On**

Record which of these were needed. This is a real limitation of the device, not a RARE bug, and it belongs in the report.

---

## 8. Android MCP

| Test | Expected |
|---|---|
| 8.1 Device registers with the server | `GET /api/device/status` shows the device online |
| 8.2 A tool call reaches the phone | `android_notifications` returns real notifications |
| 8.3 Offline handling | Turn off Wi-Fi; a command fails with "device unreachable", not a hang |
| 8.4 Restart recovery | Restart the app; the device re-registers |

---

## 9. What to send back

For each numbered test: **PASS / FAIL / NOT TESTED**, plus a one-line note. Screenshots for 4.1–4.12 help. Anything that failed is more useful than anything that passed.

---

## What is already established (do not repeat)

These were verified without hardware and do not need re-testing on the phone:

- APK builds, signs, installs and launches (CI, emulator)
- All 12 Android MCP tools exist and execute against a simulated device
- Scheduler engine executes, deduplicates, recovers, handles DST
- Intent routing for device / schedule / plugin
- Gemini four modes
- Vision Studio generation and binary export

The phone tests above are the ones that **only** hardware can answer.
