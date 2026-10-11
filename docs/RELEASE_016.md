# RARE 016

RARE 016 is the release-blocking consolidation and final source-audit pass over the RARE 015 implementation.

## Release corrections

- Ollama is the default local provider with the installed testing model pinned to `qwen2.5-coder:7b`.
- RARE never downloads an Ollama model automatically and does not require a paid API key for the local setup.
- Ollama discovery still supports any compatible installed model when the configured model is unavailable and fallback is enabled.
- Daniel remains a separate assistant/orchestration layer connected to the shared RARE capability system.
- Typed Chat/Ask, Build, Documents, Research, Live Conversation and device-control routes share the same core services.
- The live agent system supports specialist roles, concurrent independent workers, progress events, human-readable agent handoffs and failure handoffs.
- The Flutter client provides responsive desktop/phone layouts, assistant orb states, live activity, differentiated workspaces, voice flow, memory, documents, research, tools and settings.
- The local HTTP API remains loopback by default. A LAN host can be selected explicitly with `python -m rare_core serve --host 0.0.0.0` for development-time phone↔laptop testing; remote clients must use the generated API token.
- Login/account identity is intentionally deferred for the current development/testing build. Device pairing uses explicit peer URL + token fields.

## Audit result

The exact release archive is extracted into a clean directory and checked with:

- full Python test suite
- RARE self-test
- Python compile check
- clean import sweep
- JSON configuration validation
- deterministic Ollama adapter tests using an HTTP-compatible local test server
- provider model-selection tests including the configured Qwen model and arbitrary installed-model fallback
- HTTP API smoke coverage
- archive integrity and release-hygiene inspection

The final report must distinguish source-level verification from platform builds that require Flutter/Dart and the native Android/Windows toolchains.
