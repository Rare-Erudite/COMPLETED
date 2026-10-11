# Planner hard-guard update — Rare 004

This update closes the remaining existing-capability planning gap.

## Problem corrected

RARE previously relied on the specification to identify an existing capability. A reasoning provider could misread a request such as **“Extend the existing conversation capability”** and turn the target into a name such as `existing_conversation`. That caused the planner to enter **new-capability** mode and propose a `create_module` action for files that already existed.

## Corrections

- The planner now reconciles the task description, capability specification, component paths, and live repository capability inventory before selecting create-vs-update mode.
- Known request modifiers such as `existing`, `current`, `configured`, `available`, and `default` cannot become part of an existing capability ID when the repository contains the real capability.
- Existing capability source, manifest, package, and test files are supplied under the resolved capability ID.
- A malformed capability specification is corrected internally before model planning when the repository and request provide unambiguous evidence.
- The final plan metadata is normalized to the resolved existing capability ID.
- The hard guard still rejects `create_file` against an existing capability file, including `overwrite=true`; the model must use a targeted update operation.
- The offline provider now recognizes update verbs such as `extend`, `update`, `modify`, `enhance`, `improve`, `fix`, and `repair` as capability requests and removes existing-capability modifiers from the parsed ID when repository evidence confirms the target.
- New compound capability names remain protected from false matches; for example, `persistent conversation` is not silently treated as the existing `conversation` capability.

## Verification

The complete automated suite passes after the correction, including regressions for malformed existing-capability names, targeted update context, offline parsing, existing-file overwrite collisions, persistent collisions, and normal new-capability behavior.
