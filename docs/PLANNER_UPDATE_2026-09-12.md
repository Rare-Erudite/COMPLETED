# Planner update — 2026-09-12

The Self-Building Core now distinguishes creating a new capability from updating an existing capability.

Changes:
- planning payload identifies when a named capability already exists;
- existing capability files are supplied to the planner as relevant context;
- prompts explicitly require targeted update operations for existing files;
- a model plan that collides with an existing file receives one corrective planning retry;
- regression tests cover the existing-file collision and existing-capability context.

Verification in this build: 64 automated tests passed, plus the 13-point core self-test.
