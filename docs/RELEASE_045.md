# RARE 045 — cross-platform packaging, fast intent routing, and response-efficiency correction

RARE 045 is a corrective release based on the fully tested RARE 044 baseline.

## Corrections

- Fixed the Windows Flutter build regression in `rare_app/lib/main.dart` by using `path_util.basename`.
- Kept canonical Flutter platform projects under `rare_app/windows/` and `rare_app/android/`; removed duplicate root-level CMake/runner scaffolding.
- Replaced generated Android identity `com.example.rare_app` with deliberate package id `com.rare.personal`, including namespace and Kotlin package.
- Added Android `INTERNET` and `RECORD_AUDIO` permissions, enabled cleartext HTTP for the development LAN path, and set Android minSdk to 24.
- Updated the platform-preparation script so regeneration preserves the deliberate Android identity and runtime permissions.
- Added a high-confidence model-free fast intent router for greetings, thanks, identity/capability questions, and memory-view requests. Ambiguous requests still use the real model.
- Reused cached provider status during conversation requests instead of forcing a fresh Ollama probe for every message.
- Added bounded response-token budgeting for ordinary requests while retaining the larger deliberate budget for `think_harder`.
- Bounded conversation history included in model prompts by characters while retaining the newest context, reducing avoidable prompt-processing work on long chats.
- Added regression tests for fast intents, response budgets, provider caching, canonical platform layout, and Android identity/permissions.

## Preserved

RARE identity/naming, persistent conversations and memory, local Ollama/qwen2.5-coder:7b, self-development/validation/repair/checkpoints/rollback, tools/documents/device bridge, the existing Flutter UI, and the previously confirmed ThemeData and NavigationRail fixes.

## Acceptance boundary

Automated core validation is required to pass in the source tree and after clean-room ZIP extraction. Physical Windows Flutter compilation and physical Android-device/LAN execution remain machine-level acceptance tests.
