# RARE 018

RARE 018 is the audited correction release following the RARE 017 cross-check. It consolidates the completed RARE core, Daniel assistant routing, device bridge, agent orchestration, UI client source, model configuration, and release-test hardening.

## Default local model

Ollama is enabled with `qwen2.5-coder:7b` as the preferred local model. If that exact tag is unavailable, RARE may select another compatible model actually installed in Ollama. RARE never downloads a model automatically and basic local operation does not require a paid API key.

## Release-test hardening

- Pytest discovery includes both the core `tests/` suite and capability tests without demo-workspace import collisions.
- `demo_workspace` is excluded from test discovery.
- Release packages exclude runtime `.rare` state, tokens, bytecode, pytest caches and build artifacts.
- The Flutter client source has a clean delimiter/syntax preflight; native Android/Windows compilation remains a machine-specific verification step because those toolchains are not present in the audit environment.
