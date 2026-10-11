# RARE 019 release

RARE 019 is the consolidated source release after the final cross-check pass over RARE 018.

## Corrections and hardening
- Assistant invocation now forwards the deeper-reasoning flag through local and peer paths.
- Chat/Ask passes the Think Harder setting and refreshes the conversation after asynchronous assistant invocation so the persisted response becomes visible.
- The demo workspace is removed automatically after the standard out-of-place demonstration, preventing generated demo content from contaminating subsequent test runs.
- A complete `requirements.txt` is included for the Python runtime/test dependency surface; core operation remains standard-library based apart from optional/full PDF parsing via `pypdf`.
- The checked-in RARE launcher icon source and platform-sized assets are included.
- PowerShell scripts are included to generate missing Flutter Android/Windows platform folders and apply the RARE icon before builds.
- Release metadata and documentation are aligned to RARE 019.

## Verification gate
- Full pytest suite: 127 passed.
- Full unittest discovery: 108 passed.
- RARE self-test: 13/13 passed.
- Python AST parse/import sweep: pass.
- JSON/configuration validation: pass.
- Ollama-compatible provider integration: pass with the configured `qwen2.5-coder:7b` model contract and installed-model fallback logic.
- Agent workflow, peer bridge, document operations, permissions, repair/rollback and HTTP API regression coverage: pass.
- Release hygiene: no runtime state, API token, bytecode cache, pytest cache, virtual environment, demo workspace or build output is included.
- Flutter source preflight: pass. Native Flutter/Android/Windows compilation remains a machine-specific check because the audit environment does not have those toolchains installed.

## Model policy
The default local model is `qwen2.5-coder:7b` through Ollama. No paid API key is required for local use and RARE never downloads a model automatically.
