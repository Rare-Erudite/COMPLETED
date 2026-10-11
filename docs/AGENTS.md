# RARE Agents

RARE uses specialist agents around the protected core. Agents perform real operations through existing services; they are not UI placeholders.

Build workflow: Architect + Code Scout can inspect independently/concurrently, then Builder drives SelfDevelopmentEngine, then Validator verifies the resulting state.

Domain workflows include document reader/analyst/verifier, research/synthesis/verifier, and device dispatcher/operator/verifier.

Every agent emits start/progress/completion/failure events. Handoffs and failures are persisted in the agent run record and event journal so the UI can render a subdued live activity stream.

The main UI can show multiple agents as separate coloured orbs. Agent messages are operational handoffs and status, not private model chain-of-thought.
