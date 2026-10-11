# RARE 026

This release supersedes RARE 025.

## Corrections in this release

- Structured model-reasoning requests now use a bounded 2048-token generation budget instead of the general 4096-token default, reducing unnecessary local-model generation during self-development.
- Ollama requests keep the selected model warm for 10 minutes by default across the multi-stage self-development workflow.
- The offline provider may still scaffold a bare capability declaration, but it refuses to represent behavioural capability requests as implemented when no deterministic recipe exists; those requests require a real model provider.
- Explicit user function contracts such as `function greet(name)` are preserved as hard requirements and are checked against generated implementation plans.
- Added provider and planner regression tests covering the above safeguards.

## Verification performed

- Full pytest suite: 147 passed.
- Python source compilation/AST checks: performed.
- Agent orchestration regression tests: passed.
- Self-development / patch / rollback regression tests: passed.
- Provider adaptability and offline-fallback regression tests: passed.

The exact release archive is intended for user-side Windows verification with the installed local Ollama model. Physical Flutter/Android/Windows compilation remains outside this Linux audit environment.
