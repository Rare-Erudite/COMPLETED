# RARE 031

## Purpose
This release addresses the live local-model failure observed during self-building and adds a permanent Windows first-run bootstrap.

## Changes
- Ollama can fail over from an installed but unusable model to another compatible installed generative model after a generation failure.
- Structured model requests no longer force Ollama native JSON-constrained decoding.
- Structured reasoning uses bounded generation budgets.
- Open-ended behavioural capability requests cannot silently degrade into shell-only implementations when no model is available.
- Explicit requested functions are preserved as hard plan requirements.
- `START_RARE.cmd` creates the project `.venv` and installs `requirements.txt` only when needed, then launches RARE.

## Versions
- Core: 0.25.0
- Flutter: 0.25.0+31

## Validation
- Full pytest suite: 150 passed
- Unittest suite: 114 passed
- RARE self-test: 13 passed

The live Ollama path still requires verification on the user's Windows machine because the local model runtime is external to the audit environment.
