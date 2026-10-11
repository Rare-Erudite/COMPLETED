# RARE 028

This sequential release contains the provider-path hardening required by the real Windows self-build test.

## Changes
- Reduced structured reasoning generation budgets by task kind.
- Limited Ollama structured reasoning context to 8192 tokens to reduce local prompt-evaluation cost.
- Tightened specify/plan prompts to preserve explicit user behaviours while producing compact JSON.
- Kept the RARE 027 self-building, agent, provider-adaptation and validation protections intact.
- Bumped core version to `0.23.0` and Flutter application version to `0.23.0+28`.

## Reason
The prior release could spend the full local-provider timeout during the `specify` phase even though the Ollama server itself was healthy. This release targets that exact execution path.
