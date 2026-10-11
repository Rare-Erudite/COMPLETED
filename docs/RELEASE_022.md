# RARE 022

RARE 022 is the current sequential release after the latest full-system cross-check. It supersedes RARE 021 without overwriting it.

## Included functional areas

- Persistent conversation/chat with real provider-backed responses, history, recent conversations, user-message editing, copy/share, and whole-chat sharing.
- Think Harder routing through the real provider request path.
- Persistent user-approved memory with search and removal.
- Self-development with inspect/plan/modify/test/diagnose/repair/retest/checkpoint/rollback behavior and controlled source editing.
- Multi-agent workflows with concurrent workers, visible activity, and agent-to-agent handoffs.
- Daniel assistant routing into RARE capabilities and paired-device workflows.
- Model provider abstraction with local Ollama as the default test route and installed-model fallback.
- Bounded Windows/PC operations plus optional host GUI automation.
- Bounded Android ADB operations.
- Research fetch/search with public-address validation.
- Common document inspection, search, edit and export paths.
- Responsive Flutter workspaces for Command Center, Chat/Ask, Build/Projects, Documents, Research, Live Conversation, Memory, Tools/Control and Settings.
- Natural speech recognition plus local neural Piper speech output; no system TTS package is used for the primary voice path.
- Futuristic RARE icon assets and build-preparation scripts for Windows/Android.

## Verification gates

- 143 pytest tests passed.
- 108 unittest tests passed.
- RARE self-test: 13/13 passed and exited normally.
- Python AST parsing and import sweep passed.
- JSON/configuration validation passed.
- Self-edit source round-trip regression passed.
- Ollama-compatible conversation generation and model fallback tests passed.
- Two-way paired-device assistant routing tests passed in the simulated laptop/phone environment.
- Document-format extraction tests passed for supported formats.
- Flutter lexical/delimiter/source-contract audit passed.
- Release hygiene passed: no runtime token/state, Python bytecode, pytest cache, demo workspace, virtualenv or build output is shipped.

## Platform boundary

The audit environment does not contain Flutter/Dart, Android SDK/Gradle, Windows Flutter tooling, or the user's physical devices. The release therefore does not falsely claim native APK/EXE compilation or physical-device execution. The build scripts prepare the missing platform projects, fetch and verify the bundled neural voice model, apply the RARE icon and Android development permissions, and build the Windows and Android artifacts with the user's installed Flutter toolchain.
