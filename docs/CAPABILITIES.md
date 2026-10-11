# Capability system (`rare_core/capabilities/`)

RARE features are **capabilities**: self-describing modules that the core builds, tests, registers and activates. In this release, local conversation, documents, and device diagnostics are built in alongside the development engine; The Flutter client now exercises the core through its HTTP transport; voice and mobile behavior remain platform-dependent where the operating system owns microphone/speech services.

## Layout
```
capabilities/__init__.py
capabilities/<id>/capability.json     manifest
capabilities/<id>/__init__.py
capabilities/<id>/core.py             implementation + health_check() + lifecycle hooks
capabilities/<id>/tests/              unittest tests
```

## Manifest (`capability.json`)
```json
{
  "id": "text_statistics", "name": "Text Statistics", "description": "…", "version": "0.1.0",
  "module": "capabilities.text_statistics.core",
  "interfaces": [{"name": "word_count", "kind": "function", "signature": "(text: str) -> int"}],
  "dependencies": {"capabilities": [], "python": []},
  "permissions": [], "config": {}, "health_check": "health_check", "tests": "tests",
  "lifecycle": {"activate": "activate", "deactivate": "deactivate"}, "core_api": "1.0"
}
```
**Validation rules:**
- `id` must be snake_case and match its folder name.
- `version` must be semantic (x.y.z).
- The module must live inside `capabilities.<id>`.
- Permissions must be known actions.
- The core API major version must match.

## Lifecycle (`CapabilityRegistry`)
`discover` → `register` (validate, resolve dependency order, reject cycles) → `health_check` (in a **separate
interpreter**) → `activate` (dependencies must be active; calls the activate hook) → `deactivate` → `forget`.
State is stored in `.rare/capabilities.json`. `get_module(id)` gives the future RARE runtime access to an active
capability.

## How new capabilities are built (self-extension, spec §23)
```
python -m rare_core task new "Create a capability called Note Keeper"
```
1. RARE writes a spec.
2. It plans the manifest, module and tests.
3. It asks for approval (`create_module` and `activate_capability`).
4. It creates the files, runs the tests, and repairs or rolls back.
5. It activates the capability and records what it learned.

**Offline,** RARE can build deterministic known recipes and structured changes. For genuinely open-ended new behaviour, a real local model provider is required; RARE does not report a model-dependent implementation as complete without one.

**CLI:**
- `python -m rare_core capabilities` lists all capabilities.
- `python -m rare_core capabilities health <id>` runs a health check.
- `python -m rare_core capabilities activate|deactivate <id>` switches one on or off.


## Assistant / device coordination
RARE includes a distinct RARE assistant service with persistent name/wake state and a development peer bridge. The assistant can route a request to the local conversation/development/tool stack or delegate explicit laptop/phone requests to a paired RARE peer.


## Current descriptor reconciliation
Built-in capability manifests were reconciled with the real runtime services so document formats/mutations, conversation controls, reasoning, and device/peer controls are no longer advertised incompletely.
