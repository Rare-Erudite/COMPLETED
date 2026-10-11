# Verification update — 2026-09-11

Independent verification found and corrected two issues in the original v0.3.0 source:

1. Affected-test validation treated `__init__.py` as a runnable unittest module. Direct affected-test modules are now limited to `test_*.py`, while test directories remain valid targets.
2. The demonstration forced its main context to `offline`, so it could not exercise a configured local model. The main demo context now inherits project provider configuration; its rollback-only scenario uses a separate offline context.

Ollama model handling was also made flexible. The default is `model: "auto"`: RARE queries the local Ollama server for installed models, prefers coding-oriented Qwen families, and falls back to other installed coding/general models such as Llama. RARE never downloads a model automatically. A specifically configured model can still be pinned, with automatic fallback enabled by default when that model is unavailable.

Verification in the available environment:

- Automated tests: **58/58 passed** on Python 3.13.5.
- RARE self-test: **13/13 passed**.
- Auto-selection test: a local Qwen coder model is preferred when available; fallback to an installed Llama model works when a requested model is absent.
- No generated `.rare` state, demo workspace, Python bytecode, or `rare.config.json` is included in this release ZIP.

Device verification still required: real Windows/Android runs, Python 3.9/3.11 reruns, and a real model-assisted task using Ollama. Those are not claimed as independently verified here.
