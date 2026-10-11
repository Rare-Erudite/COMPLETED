# API

## Internal Python API: `rare_core.api.RareCoreAPI`
All results are plain JSON-serialisable data.

| Method | Purpose |
|---|---|
| `submit_task(description, parameters=None, priority="normal", run=True)` | Submit a development task (and drive it) |
| `run_task(id)` / `get_task(id)` / `task_status(id)` / `list_tasks(status)` / `get_plan(id)` | Task control and inspection |
| `pending_approvals(task_id)` / `resolve_approval(req_id, resolution, authority, policy_decision=None)` | Approvals. Resolution is `approve`, `approve_once`, `allow_for_task`, `reject` or `change_policy` |
| `list_changes(task_id)` / `get_change(id)` | Change records, with diffs |
| `checkpoints()` / `create_checkpoint(desc, known_good=False)` / `restore_checkpoint(id, authority)` | Snapshots |
| `rollback_task(id, authority)` | Roll back a completed or failed task |
| `validate(scope)` / `health(run_tests)` / `diagnostics(topic)` | Checks and diagnostics |
| `history(limit, task_id)` / `events(since_seq, task_id)` | Audit trail and event journal |
| `repository_summary()` / `query_architecture(query, target)` | Repository intelligence |
| `capabilities()` / `tools()` / `providers()` / `policy()` / `set_autonomy_level(level, authority)` | System info and control |

| `create_conversation(...)` / `chat(...)` / `conversations(...)` / `conversation(...)` | Persistent local conversation runtime |
| `add_user_memory(...)` / `search_user_memory(...)` | Persistent user memory |
| `read_document(...)` / `search_document(...)` / `list_documents(...)` | Safe local document access |
| `device_diagnostics()` / `execute_tool(...)` | Device diagnostics and permission-gated tools |

The `diagnostics` topics are: `healthy`, `failing_modules`, `dependencies`, `recent_changes`, `last_good_state`,
`recurring_errors`, `failing_tests`, `incomplete_capabilities`, `architecture`.

## Local HTTP API
Start it with `python -m rare_core serve`. It listens on `127.0.0.1:8765` by default.

- **Authentication:** every request needs `Authorization: Bearer <token>`. The token is in `.rare/api_token` (file mode 0600).
- **Missing or wrong token:** the server returns `401`.
- **Errors:** they come back as `{"error": {"code", "message", "details"}}` with status 400, 403 or 404.

| Method | Path | Body / query |
|---|---|---|
| GET | `/health` | `?tests=1` also runs the full suite |
| GET | `/tasks` | `?status=` |
| POST | `/tasks` | `{"description", "parameters"?, "priority"?, "run"?}` returns 201 |
| GET | `/tasks/<id>`, `/tasks/<id>/status`, `/tasks/<id>/plan` | |
| POST | `/tasks/<id>/run`, `/tasks/<id>/rollback` | |
| GET | `/approvals` | `?task_id=` |
| POST | `/approvals/<request_id>` | `{"resolution", "policy_decision"?, "note"?}`. The task continues automatically when nothing is left pending |
| GET | `/changes`, `/changes/<id>` | `?task_id=` |
| GET / POST | `/checkpoints` | POST `{"description", "known_good"?}` |
| POST | `/validate` | `{"scope": "full" or "task"}` |
| GET | `/diagnostics/<topic>` | |
| GET | `/history`, `/events` | `?limit=`, `?since=`, `?task_id=` |
| GET | `/capabilities`, `/tools`, `/providers`, `/policy`, `/repo` | |
| GET | `/repo/query` | `?query=&target=` |
| POST | `/autonomy` | `{"level": 0-4}` |

Requests are handled one at a time. A long task blocks other calls until it finishes.

## Conversation and user memory
The local runtime also exposes a persisted assistant conversation layer:

| Method | Purpose |
|---|---|
| `create_conversation(title="New conversation")` | Create a persistent conversation |
| `chat(conversation_id, message, ...)` | Generate a response through the configured model provider, persist both messages, and retry/fallback across providers |
| `conversations(limit=20)` | List recent conversations |
| `conversation(id, include_messages=True, limit=None)` | Retrieve a conversation and its messages |
| `add_user_memory(kind, text, tags=None, importance=1)` | Persist user facts/preferences/goals/notes separately from development memory |
| `search_user_memory(query, limit=10)` | Retrieve relevant user memory |
| `execute_tool(name, inputs, reason=...)` | Run a registered tool through the existing permission gate |

The terminal command `python -m rare_core chat` starts an interactive local conversation. The conversation endpoint is
`POST /conversations/<id>` with a JSON body containing `message`. User memory is available at `GET /user-memory` and
`POST /user-memory`; tool execution is available at `POST /tools/execute`. These endpoints use the same bearer token as
all other local API routes.

Conversation terminal commands supported inside chat include `/remember <kind> <text>`, `/memory <query>`, `/build <request>`,
and `/tool <tool-name> <json-object>`. Tool execution is still subject to RARE's normal permission and approval policy.


## RARE 011 additions

- `POST /conversations/{id}` accepts `think_harder` and routes a real model-backed response.
- `POST /conversations/{id}/messages/edit` edits a user message using its message id and persists the edit.
- `GET /conversations/{id}/export?format=json|text` exports a conversation.
- `GET /user-memory` lists/searches persistent user memory.
- `POST /user-memory/forget` removes memory by `id` or matching `query`.
- `POST /documents` creates a text document inside the project root.
- `POST /research/search` and `POST /research/fetch` are network-policy-gated research operations.
- `X-RARE-Local: 1` is accepted only from loopback clients; remote clients should send the generated API token.


## RARE 012 assistant/device bridge

### GET `/assistant`
Returns assistant identity, wake name, conversation id, and device-bridge status.

### POST `/assistant/invoke`
Body: `{ "message": "...", "target": "", "hop": 0, "source_device": {...} }`. The assistant routes local work or delegates to a paired peer.

### POST `/assistant/name`
Body: `{ "name": "RARE" }`. Persists the configured assistant/wake name.

### GET `/devices`
Returns the local device identity and paired peers without returning stored bearer tokens.

### POST `/devices/peer`
Body: `{ "name": "My Laptop", "role": "laptop", "base_url": "http://...", "token": "...", "device_id": "" }`. Stores a development peer.

### POST `/devices/peer/remove`
Body: `{ "id": "peer-..." }`. Removes a development peer.
