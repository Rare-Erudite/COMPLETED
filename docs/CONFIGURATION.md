# Configuration and permissions

All settings live in **`rare.config.json`** at the project root. Built-in defaults are in `rare_core/config/defaults.py`.
Your file is merged on top of the defaults and validated at start-up. An invalid config starts RARE in safe mode.
Critical settings are never spread across source files.

| Section | Key settings |
|---|---|
| `project` | `name`, `source_dirs`, `test_dirs`, `ignore` (glob patterns never scanned or checkpointed), `max_file_bytes` |
| `state_dir` | `.rare` |
| `providers` | `order` (tried in turn, e.g. `["ollama","openai_compatible","offline"]`), plus one section per provider: `base_url`, `model`, `timeout_seconds`, `api_key_env` (the *name* of an environment variable, never the key itself) |
| `autonomy.level` | 0–4 (default 2). The `RARE_AUTONOMY_LEVEL` environment variable overrides it for one run |
| `permissions` | `overrides` (action → `auto`/`approve`/`prohibit`), `trusted_actions` (level 4), `protected_paths`, `security_sensitive_paths` |
| `repair` | `max_attempts` (4), `max_same_failure` (2), `use_model`, `on_failure` (`rollback` or `keep`) |
| `validation` | `timeout_seconds`, `checks`: each has `name`, `type` (`python_compile`, `python_import`, `affected_tests`, `unittest`, `capability_tests`, `command`), `when` (`always` = run for every task; `full` = only in full validation) |
| `tools.command_allowlist` | programs `command.run` may start (never through a shell) |
| `checkpoints` | `before_change`, `keep` (retention; the latest known-good checkpoint is never pruned) |
| `security` | `secret_env_vars` (redacted from logs and removed from child processes), `allow_network_tools` (default false) |
| `capabilities` | `dir` (`capabilities`), `auto_activate` |
| `api` | `host` (127.0.0.1), `port` (8765) |

## Autonomy levels

| Level | Low risk | Medium risk | High risk |
|---|---|---|---|
| 0 Observe | auto | prohibited | prohibited |
| 1 Propose | auto | approve each change (no task-wide grants) | approve |
| 2 Build with approval *(default)* | auto | approve | approve |
| 3 Controlled autonomy | auto | auto | approve |
| 4 Trusted development | auto | auto | approve, or auto if in `trusted_actions` |

**Risk classes:**
- **Low:** inspect_files, analyze_repository, read_logs, run_diagnostics, run_tests, run_validation.
- **Medium:** modify_source, create_module, create_file, update_config, install_dependency, activate_capability,
  run_command, restore_checkpoint.
- **High:** delete_file, modify_security, destructive_command, publish_code, alter_external_system,
  irreversible_operation, network_access, execute_code.
- **Critical:** modify_protected. This is always prohibited.

**Hard rules that no setting can relax:**
- **Protected paths can never be changed by the engine.** These are `rare_recovery.py`, `rare_core/bootstrap/**`,
  `.rare/**`, and any capitalisation or `./` variation of them.
- **`modify_security` always needs approval.** This covers `rare.config.json` security keys and RARE's own safety
  modules (permissions, tool executor, patch engine, audit, HTTP server).
- **Interpreters count as `execute_code` (high risk)** when used beyond the known-safe test commands.
- **Only the user can approve.**

**Changing the policy:**
- `python -m rare_core policy --set-level 3`
- `python -m rare_core policy --override run_command=approve`
- Or, when answering an approval, choose `change_policy`.
