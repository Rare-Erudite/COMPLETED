# Developer guide: building the rest of RARE with this core

## The rule
Build new RARE features **through the core**, as capabilities or as structured tasks, not by hand-editing around it.
That way every change is planned, approved, checkpointed, tested, repairable, reversible and recorded.

## Typical workflow
1. `python -m rare_core health` and `python -m unittest discover -s tests -t .`, to start from a green state.
2. `python -m rare_core checkpoint create --good -m "before <feature>"`.
3. Submit the request:
   - with a model: `task new "Make RARE able to store and search notes"`;
   - offline: `task new "Create a capability called Notes"`, then follow-up tasks with exact `ops`.
4. Review `task show <id> --diff`, then approve (`approve <id>`, or `--scope task`).
5. Check the result: `completed` with a known-good checkpoint, or read the diagnosis if the task was rolled back.
6. Add lasting rules to the knowledge base, which feeds future planning:
   `python -m rare_core knowledge add coding_convention "Title" "Rule text"`.

## Programmatic use
```python
from rare_core.bootstrap import boot
from rare_core.api import RareCoreAPI
from rare_core.permissions import UserAuthority

ctx, report = boot("path/to/rare")          # report.safe_mode tells you if the core failed to load
api = RareCoreAPI(ctx)
task = api.submit_task("Create a capability called Notes")
for req in api.pending_approvals(task["id"]):
    api.resolve_approval(req["id"], "allow_for_task", UserAuthority("me", "script"))
print(api.task_status(task["id"]))
```

## Extending the core itself (meta-development, spec §24)
Each of these is a plug-in point:

| To add | Mechanism |
|---|---|
| A language analyzer | subclass `repo.analyzers.LanguageAnalyzer` and register it with `AnalyzerRegistry` |
| A failure parser | `FailureAnalyzer.register_parser(fn)` |
| A repair strategy | subclass `repair.strategies.RepairStrategy` and add it to the `RepairEngine` strategies |
| A tool | see TOOLS.md |
| A model backend | subclass `ModelProvider` and add it to `reasoning/providers/registry.FACTORIES` |
| A validation check | add it to `validation.checks` in the config |

Changes to the core's safety modules count as `modify_security` and always need approval.

## Invariants: do not break these
- Standard library only, Python 3.9+. Paths are stored POSIX and project-relative.
- No provider-specific code outside `reasoning/providers/`.
- The protected paths stay protected. `rare_recovery.py` imports nothing from the core and stays compatible with checkpoint format 1.
- Only a `UserAuthority` approves. Risk is always derived from concrete paths and argv.
- "Completed" only after validation passes. `known_good` only if tests ran.
- Every change keeps its checkpoint, change record, audit entry and events.
- Run the tests, `selftest` and `demo` after every change to the core.
