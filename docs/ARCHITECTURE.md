# Architecture

The RARE Self-Building Core is RARE's **development engine**. It is a set of small modules with clear boundaries,
all written in pure Python 3.9+ with only the standard library. The modules connect through one dependency-injection
container, `rare_core/runtime.py` (`CoreContext`). There is no hidden global state.

```
rare_recovery.py            PROTECTED standalone recovery (imports nothing from rare_core)
rare_launcher.py            menu front-end (desktop + Android)
rare_core/
  bootstrap/    PROTECTED: locate project, create state dirs, boot → CoreContext or safe mode, launch recovery
  config/       defaults.py (every setting) + loader.py (merge, validate, typed access)
  platforms/    OS/device detection + adapters (desktop, Windows, Android: timeouts, process spawning)
  storage/      atomic writes, JSON/JSONL, safe project-relative paths, glob matching, ids
  events/       EventBus + event types + persistent journal (.rare/audit/events.jsonl)
  audit/        audit trail + secret redaction (.rare/audit/audit.jsonl)
  repo/         FileScanner, language analyzers (Python AST; Dart/JS/TS/Kotlin/Java regex; JSON), RepositoryIndex,
                SymbolIndex, ArchitectureGraph
  tasks/        DevTask + state machine + persistent store
  requirements/ RequirementsEngine: request → technical specification
  reasoning/    ModelProvider interface + adapters (Ollama, OpenAI-compatible, offline rules), ReasoningService
                (ordered fallback + validation), prompts, Planner
  development/  PatchEngine (7 structured operations), ChangeManager, CheckpointManager, RollbackManager
  permissions/  risk classification, autonomy levels 0–4, ApprovalManager, UserAuthority
  tools/        ToolSpec/Tool contract, ToolExecutor (the single execution gate), 15 built-in tools, process runner
  validation/   ValidationEngine (checks) + FailureAnalyzer (diagnoses)
  repair/       repair strategies + RepairEngine (budget and stop rules) + RepairHistory
  memory/       DevelopmentMemory (structured records) + KnowledgeBase (project rules)
  capabilities/ CapabilityRegistry (manifests, dependencies, health, lifecycle) + scaffold/recipes
  diagnostics/  HealthChecker, DiagnosticEngine, FailureRegistry, self-test
  engine/       SelfDevelopmentEngine: the development loop
  api/          RareCoreAPI (internal facade) + local HTTP JSON server
  cli.py        command-line interface     demo.py   end-to-end demonstration
```

## How the parts relate

```
user / UI / API ──► SelfDevelopmentEngine ──► RequirementsEngine ──► ReasoningService ──► ModelProvider(s)
                          │                    Planner ───────────────┘       (Ollama | OpenAI-compatible | offline)
                          │                       └─► RepositoryIndex + ArchitectureGraph (impact, tests)
                          ├─► ToolExecutor ──► PermissionPolicy + ApprovalManager (UserAuthority only)
                          │         └─► tools: patch.apply (PatchEngine), python.unittest, python.compile, git.* ...
                          ├─► CheckpointManager / ChangeManager / RollbackManager
                          ├─► ValidationEngine ──► FailureAnalyzer ──► RepairEngine (rules + model)
                          ├─► DevelopmentMemory, FailureRegistry, RepairHistory, KnowledgeBase
                          ├─► CapabilityRegistry
                          └─► EventBus ──► AuditLog, event journal, future UI and sync
```

## Separation for future products (spec §33–34)

The layers are kept apart so that a future Windows EXE and Android APK can embed the same engine:

- **Core logic:** engine, reasoning, development, validation, repair.
- **Platform adapters:** `platforms/`.
- **Storage:** `storage/` and `.rare/`.
- **Interfaces:** `api/`, `cli.py`, `rare_launcher.py`.
- **Integrations:** model providers, tools.

All stored paths are POSIX and project-relative, so state can move between a PC and a phone.

## Key design rules

1. The change sequence is fixed: **Understand → Plan → Check risk → Approve if needed → Snapshot → Modify →
   Validate → Repair → Accept/Rollback.**
2. Risk comes from *what an operation concretely touches* (paths, JSON keys, command argv), never from what a model says.
3. Only a `UserAuthority`, created by user channels, can resolve approvals.
4. A change is "completed" only after validation passes. Untested changes are checkpointed as `experimental`.
5. Nothing depends on a paid API. The offline provider is the floor, and it honestly refuses what it can't do.
6. Protected components (bootstrap, recovery, checkpoints) can never be modified by the engine.
