# Checkpoints, rollback and recovery

## Checkpoints (`rare_core/development/checkpoints.py`)
- **Storage:** checkpoints are content-addressed snapshots in `.rare/checkpoints/`. File contents are stored once in
  `objects/<sha[:2]>/<sha256>`, and each checkpoint has a manifest in `manifests/<id>.json`. This is format 1.
- **Status:** `known_good` (validated by tests that actually ran), `experimental` or `unverified`.
- **Kinds:** `baseline`, `pre_change`, `post_change`, `manual` and `pre_restore`.
- **Retention:** `checkpoints.keep`. The latest `known_good` checkpoint is **never pruned**.

## Three levels of undo
| Situation | What to do | What it restores |
|---|---|---|
| One task went wrong | `python -m rare_core rollback <task-id>` (menu 10) | **Only the files that task touched**, from its pre-change checkpoint. Your other work is untouched. Verified after restoring. |
| Go back to an earlier state | `python -m rare_core checkpoint list`, then `checkpoint restore <id>` | The whole project. A `pre_restore` safety checkpoint is taken first, so the restore itself can be undone. |
| **RARE won't start at all** | `python rare_recovery.py list`, then `python rare_recovery.py restore latest-good` | The whole project, from the last known-good checkpoint. |

## The protected recovery layer (spec §25)
- **`rare_recovery.py`** imports **nothing** from `rare_core`, so it works even when the core is broken. It verifies
  checkpoint integrity (SHA-256) before restoring and skips protected files unless you pass `--include-protected`.
- **`rare_core/bootstrap/`** starts the system. If loading the core fails, `boot()` returns a **safe-mode** report with
  the error and the recovery instructions instead of crashing.
- The engine can never modify `rare_recovery.py`, `rare_core/bootstrap/**` or `.rare/**` at any autonomy level.

## Other commands
- `python -m rare_core checkpoint create --good -m "note"` runs full validation and labels the snapshot known-good only
  if tests ran.
- `python -m rare_core checkpoint diff <a> [<b>|current]` shows what was added, removed or modified.
- `python -m rare_core health` shows the last known-good checkpoint and what has changed since.
