# RARE 020 release

RARE 020 is the consolidated release after the final audit of RARE 019. It incorporates the interface, assistant, agent, device, model-routing, documentation, release-hygiene, and regression corrections made during the audit cycle.

## Model policy

The default local model is `qwen2.5-coder:7b`. RARE does not require a paid API key for the local path and does not automatically download another model. If the configured model is unavailable and fallback is enabled, the Ollama adapter may select another compatible model that is actually installed and exposed by the Ollama server.

## Current interface

The Flutter source contains dedicated Command Center, Chat / Ask, Projects / Build, Documents, Research, Live Conversation, Memory, Tools / Control, and Settings workspaces. Chat remains capable of initiating work; Build exposes the richer engineering workflow. Daniel is a separate assistant layer that routes into the same RARE capability system and can delegate to a paired laptop/phone peer.

## Testing boundary

The source and backend package are audited and clean-room tested. Native APK/Windows compilation still requires the user's installed Flutter/Dart and platform toolchains; the release includes scripts to generate the platform projects and build both artifacts.

## Final cross-check additions

During the final audit, a real HTTP contract defect in conversation message editing was corrected: the server now reads the message id from `/conversations/<conversation>/messages/<message>/edit`, matching the Flutter client. Daniel also now handles device-status requests directly so they can be executed on either side of the peer bridge. The Live Conversation client now supports auto-listening, explicit keyboard entry, and interruption; Chat provides per-message copy/share/edit controls plus whole-conversation sharing.

Final verification before packaging: 133 pytest tests, 108 unittest tests, 13/13 self-test checks, 131 Python files parsed, all non-test modules imported, JSON/configuration validation, independent Ollama-compatible generation, full core capability black-box checks, real two-way assistant peer round-trip, document-format checks, Flutter delimiter/source contract checks, release hygiene, and clean-room ZIP verification.
