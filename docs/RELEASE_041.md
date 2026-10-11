# RARE 041

RARE 041 is a correction release after RARE 040. Release numbers 036–039 remain intentionally unused.

## Correction

The Windows/CLI menu action **Chat with RARE** now resumes the most recently updated saved conversation when one exists, instead of launching `chat` without a conversation ID and silently creating a new conversation on every restart.

If no saved conversation exists, the menu still starts a new conversation normally. The underlying conversation store and provider runtime are unchanged.

## Scope discipline

Functional change is confined to the menu/session handoff in `rare_launcher.py` and its regression tests. The conversation store, provider adapters, self-development engine, permissions, checkpoints, rollback, memory, tools, documents, devices, voice, agents, and Flutter source were not rewritten for this correction.

## Verification

- Full pytest and unittest suites must pass before release.
- Launcher tests cover both resume-existing and create-new behavior.
- Release metadata and Flutter version are aligned to RARE 041.

## Machine acceptance

After restart, selecting menu option 14 should display the same saved conversation ID as the latest conversation from the previous run, allowing the stored history to be used by the chat runtime.

## Release metadata

- Core: 0.31.0
- Flutter: 0.31.0+41
- Release: RARE 041
