# RARE 040

RARE 040 is the next sequential release after RARE 035 (release numbers 036–039 are intentionally unused). It fixes the live conversation runtime-identity defect found during Windows acceptance testing.

## Correction

When Chat with RARE is asked which model/provider is actually running, the answer is now derived from the live provider registry rather than left entirely to model self-identification. Runtime identity questions return the authoritative provider/model selected by RARE, and normal model-backed chat requests now also receive authoritative provider/model context in their system prompt.

This corrects the observed case where the configured local Ollama/Qwen runtime was ready, but the model replied that RARE was using OpenAI GPT-4.

## Scope discipline

The Ollama adapter, provider ordering, self-development engine, permissions, checkpoints, rollback, tools, memory store, documents, device controls, voice, agents, and Flutter source were not rewritten for this correction.

## Verification

- `pytest`: 156 passed.
- `unittest discover`: 119 passed.
- Python compile check: passed.
- JSON configuration/capability validation: passed.
- RARE self-test: 13/13 passed.
- Conversation regression tests cover authoritative runtime identity, persistence, provider use, and fallback behavior.

## Machine-specific acceptance

The release is source/test verified in the build environment. Final acceptance on the user's Windows machine must include a fresh live Chat test with the installed Ollama service and configured model. No additional model download is required by this correction.

## Release metadata

- Core: 0.30.0
- Flutter: 0.30.0+40
- Release: RARE 040
