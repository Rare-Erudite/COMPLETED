# RARE 017

RARE 017 is the final correction release after the historical RARE 016 release-blocking audit. It preserves the consolidated RARE feature set, removes shipped runtime state/secrets, hardens Daniel permission error handling, aligns setup documentation, and records the final source/clean-room verification.

## Default local model

Ollama is enabled with `qwen2.5-coder:7b` as the configured default. If that exact model is unavailable, the provider may select another compatible model actually installed in Ollama. RARE never auto-downloads a model and no paid API key is required for the local route.

## Release verification

- Python AST parse: all project Python files passed.
- Python unit/pytest regression: 125 pytest tests passed; 108 unittest tests passed.
- RARE self-test: 13/13 passed.
- Live Ollama-compatible provider -> conversation API smoke: passed.
- Flutter delimiter/source preflight: passed.
- Release hygiene: no runtime API token, `.pyc`, `__pycache__`, `.pytest_cache`, virtualenv or generated build state shipped.
- ZIP integrity: verified after clean-room extraction.

Platform-native Flutter compilation remains a machine-specific test because this release environment does not contain Flutter/Dart or Android/Windows native toolchains.
