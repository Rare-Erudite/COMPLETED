# RARE 015

RARE 015 is the cross-check correction release from the RARE 013 audit. It preserves the RARE 013 feature set and fixes defects found during independent source inspection.

## Corrections

- Fixed the Daniel build-dispatch path so the public `wait` option is passed correctly into the real multi-agent development run.
- Fixed the Flutter assistant-orb animation to call `dart:math` functions explicitly instead of invoking a nonexistent numeric `.sin()` method.
- Made `python -m rare_core` safe to import as a module by guarding its CLI execution with `if __name__ == "__main__"`.
- Removed the empty temporary bridge artifact from the release tree.
- Serialized concurrent agent run persistence so simultaneous specialist workers cannot race their durable snapshots.
- Expanded built-in capability descriptors so they advertise the functionality actually provided by the runtime (conversation editing/export/reasoning, document formats and document mutations, and device/peer control).
- Added a regression test for assistant build dispatch with `wait=False`.

## Verification

- Full pytest suite: 124 passed.
- Python compileall: passed.
- Python module import sweep: passed without executing the CLI on import.
- RARE self-test: 13 passed, 0 failed.
- JSON configuration validation: passed.
- Clean-room ZIP verification: passed.
- Static Flutter delimiter/lexical audit: passed; actual Flutter/Dart compilation remains unverified because no Dart/Flutter toolchain is installed in the build environment.
- Ollama was checked without downloading anything; it was not running in this environment, so no model-backed claim is made from this machine.

## Platform limitation

No APK, Android runtime test, Windows executable build, or Flutter runtime test is claimed unless the corresponding native toolchain is available and the target can actually be executed.
