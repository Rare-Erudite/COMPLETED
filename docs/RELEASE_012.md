# RARE 012

RARE 012 consolidates RARE 011 and adds the missing assistant/device-integration layer required by the current project specification.

## Completed in this release

- Added a separate **Daniel assistant service**. Daniel is not the application UI; it is an orchestration layer that can route requests into conversation, the development engine, bounded tools, or a connected RARE peer.
- Added persistent assistant identity/name state. The default wake name is **Daniel** and the name is configurable.
- Added persistent **development-time device pairing** with local device identity and peer registry. No login is required for testing.
- Added authenticated peer-to-peer HTTP invocation so one RARE instance can send a natural-language assistant request to another RARE instance over a LAN/reachable endpoint.
- Added two-way peer routing logic: explicit `on my laptop` / `on my phone` requests are delegated to the correct peer when paired and fail closed when not paired.
- Added assistant routes to the Core API and HTTP gateway.
- Added a CLI `assistant` entry point.
- Connected the main Flutter home assistant, chat, and live-conversation flows to the assistant service.
- Live voice now recognizes the configured wake name as a separate wake step before listening for the command.
- Added development pairing controls to Flutter settings.
- Fixed the missing top-level `capabilities` Python package marker discovered by the independent pytest collection pass.
- Removed the invalid Flutter asset declaration that referenced a non-existent `assets/` directory.
- Corrected the malformed conversation system prompt.

## Verification performed

- `pytest -q`: **119 passed**.
- `python -m rare_core selftest`: **13 passed, 0 failed**.
- `python -m compileall -q .`: passed.
- `python -m json.tool rare.config.json`: passed.
- Clean HTTP assistant route smoke test: passed.
- Real two-process RARE peer round-trip (phone-role instance ↔ laptop-role instance): **REMOTE_ROUNDTRIP_OK**. The laptop tool executed through the remote assistant path.
- Flutter source lexical syntax audit: passed; delimiter nesting is balanced and required assistant/peer/wake routes are present.

## Explicit platform/toolchain limitation

Flutter/Dart are not installed in the current build environment. Therefore this release does **not** claim an APK build, Windows Flutter build, Android runtime execution, microphone runtime verification, or Android-native device-action verification. The Flutter source itself has been statically audited, but those platform behaviors still require the user's Flutter/Android/Windows test environment.

## Login decision

Account/Gmail login is intentionally **deferred**. Development testing uses the local peer-pairing mechanism so repeated sign-in is not required. The transport is designed so a later account layer can replace the stored peer credentials without changing the assistant invocation protocol.
