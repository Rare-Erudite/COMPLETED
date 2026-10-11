# RARE 042

RARE 042 is a correction release after RARE 041.

## Purpose

This release consolidates the latest working fixes that were made manually in VS Code after the RARE 040/041 source snapshots, rather than discarding them and reopening the earlier Flutter startup defects.

## Corrections

- Preserved the Flutter `ThemeData`/`ColorScheme` brightness compatibility fix that prevents the brightness assertion during startup.
- Preserved the `NavigationRail` label-mode fix that prevents the `extended`/`labelType` assertion.
- Made **RARE** the default assistant/wake name while preserving explicitly chosen custom names. Existing implicit `Daniel` defaults migrate to `RARE`.
- Added natural assistant rename handling such as “I want to call you Chief”, with persistence across restart. The main application remains named RARE.
- Kept the assistant layer separate from Live Conversation; both use the same configured assistant name, but Live remains its own interaction mode.
- Added a real document command composer for the currently selected document.
- Reworked the Documents viewer into a single scroll-safe surface to remove the previously observed bottom-overflow condition.
- Preserved conversation persistence, restart retrieval, user-approved persistent memory, provider routing, recovery/rollback, peer routing, voice, documents, agents, and self-development code instead of replacing those subsystems.

## Verification

- Full Python pytest suite passes.
- Added regression tests for RARE default-name migration, natural rename persistence, and conversation/memory reopen persistence.
- Source-level Dart delimiter/preflight checks pass in the build environment.
- No APK/EXE or native Flutter runtime claim is made here because Flutter/Dart native execution is not available in this build environment.

## Release metadata

- Core: 0.32.0
- Flutter: 0.32.0+42
- Release: RARE 042
