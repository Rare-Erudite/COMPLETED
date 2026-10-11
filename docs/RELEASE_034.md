# RARE 034

RARE 034 is the sequential documentation-corrected release following RARE 033. It aligns all current-facing release records with the actual package and preserves prior release notes as history.

## Current release metadata

- Release: RARE 034
- Core version: 0.28.0
- Flutter version: 0.28.0+34

## Corrections

- Current README, handoff, Windows start guide, acceptance record, and final audit record identify RARE 034 consistently.
- Historical `docs/RELEASE_033.md` remains unchanged as the RARE 033 record.
- The self-building core, provider/model routing, Ollama streaming, model fallback, and automatic Python environment bootstrap from RARE 033 remain unchanged.

## Verification boundary

The package-level tests and code-level provider integration checks can be verified in a clean environment. A live run against the user's installed Ollama instance and platform-specific Flutter/Android/Windows runtime remains a machine-side acceptance test.
