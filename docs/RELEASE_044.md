# RARE 044 — Windows/Android packaging and Flutter build correction

RARE 044 is a corrective release based on the fully tested RARE 043 baseline.

## Fixes
- Fixed the Windows Flutter build error caused by `Path.basename` in the document viewer; the app now uses the existing `package:path` import alias (`path_util.basename`).
- Preserved the previously confirmed ThemeData brightness fix.
- Preserved the previously confirmed NavigationRail labelType fix.
- Preserved RARE as the default assistant identity and natural assistant renaming.
- Preserved conversation persistence, persistent user memory, local Ollama/qwen2.5-coder:7b routing, checkpoints/rollback, and the self-building core.
- Added native Flutter Windows and Android project scaffolding to the release archive so a fresh extraction is an actual Flutter platform project instead of requiring `flutter create` before first run.

## Release baseline
- Core: 0.34.0
- Flutter app: 0.34.0+44
- Local provider: Ollama
- Expected local model: qwen2.5-coder:7b
- API: 127.0.0.1:8765 for Windows-local development

## Voice
The approximately 63 MB Piper model is not duplicated in the source archive. The included preparation script installs/verifies the model only when it is missing.
