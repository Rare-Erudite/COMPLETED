# Tool system (`rare_core/tools/`)

Every tool declares a **`ToolSpec`** with these fields:

| Field | Meaning |
|---|---|
| `name` | The tool's identifier. |
| `purpose` | What the tool is for. |
| `inputs` / `outputs` | What it takes and what it returns. |
| `action` | The permission action it performs, which sets its **risk**. |
| `timeout_seconds` | How long it may run. |
| `failure_behavior` | `raise`, `return_error` or `retry:N`. |
| `network` | Whether it needs network access. |
| `requires_subprocess` | Whether it starts another program. |

`ToolExecutor.execute(name, inputs, task_id=…)` is the **only** path to execution. For every call it:
1. classifies risk from the concrete inputs (`Tool.classify`);
2. asks the policy for a decision, and raises `PermissionDenied` if the action is prohibited;
3. checks for an approval grant, and creates an approval request and raises `ApprovalRequired` if there isn't one;
4. runs the tool with a timeout, scaled up on Android;
5. writes an audit record and emits a `ToolExecuted` event.

Network tools are refused unless `security.allow_network_tools` is true.

## Built-in tools
| Tool | Action / risk | Notes |
|---|---|---|
| `fs.read`, `fs.list`, `fs.search` | inspect_files / low | `.rare/` is not readable through tools |
| `patch.apply` | from the operations (create_module, modify_source, update_config, delete_file, modify_security …) | goes through PatchEngine; all-or-nothing |
| `repo.scan`, `repo.query` | analyze_repository / low | queries: dependencies, dependents, impact, tests, where, isolated, missing, search |
| `python.compile` | run_validation / low | in-process, never executes code |
| `python.unittest`, `python.import_check` | run_tests / low | child process; in-process fallback where processes can't be started |
| `command.run` | classified from argv | allowlist only, never a shell; interpreters count as `execute_code` (high) |
| `git.status`, `git.diff`, `git.log` | inspect_files / low | read-only flags only |
| `pip.install` | install_dependency / medium | needs network access enabled plus approval |
| `checkpoint.create` | inspect_files / low | manual snapshot |

## Adding a tool
```python
from rare_core.tools import Tool, ToolSpec

class WordCountTool(Tool):
    spec = ToolSpec("text.wc", "Count words in a project file", {"path": "file"}, {"words": "int"}, "inspect_files")

    def run(self, inputs, ctx):
        return {"words": len((ctx.root / inputs["path"]).read_text(encoding="utf-8").split())}

ctx.tool_registry.register(WordCountTool())        # ctx = CoreContext
ctx.executor.execute("text.wc", {"path": "README.md"})
```
Override `classify()` if the risk depends on the inputs. Use `tools/process.run_process` for child processes, which
never uses a shell and strips secrets from the environment.


## PC GUI automation

The `pc.gui` tool provides bounded mouse/keyboard/screenshot automation through `pyautogui`. It is an optional dependency (`requirements-optional.txt`) and every action remains subject to RARE policy/approval.
