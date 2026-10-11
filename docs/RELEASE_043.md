# RARE 043

RARE 043 is the cleaned correction release after RARE 042.

## Corrections

- Updated current-facing release metadata from RARE 042 to RARE 043 / core 0.33.0 / Flutter 0.33.0+43.
- Removed stale current-facing Daniel and RARE 040 wording; historical release records remain unchanged.
- Changed the Flutter voice asset declaration to the existing `assets/voice/` directory so the source archive does not reference absent binary files.
- Added an explicit voice-assets README and made the build-preparation contract clear: `scripts/prepare_voice_model.ps1` prepares the optional ~63 MB Piper model only when it is missing and verifies its SHA-256.
- Preserved the user-confirmed Flutter ThemeData/ColorScheme brightness fix and NavigationRail label-mode fix.
- Preserved conversation persistence, persistent user memory, provider routing, documents, research, devices, recovery/rollback, agents, and self-development behavior.

## Verification target

This release must pass the full Python suite, compile/import checks, self-test, source-level Flutter delimiter checks, archive integrity checks, and a clean extracted-tree pytest run. Platform-native Flutter build/runtime remains a target-machine validation step.

## Release metadata

- Core: 0.33.0
- Flutter: 0.33.0+43
- Release: RARE 043
