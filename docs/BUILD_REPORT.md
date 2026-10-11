# historical RARE 011 build report

## Baseline

historical RARE 010 was audited before modification. Its Python suite passed 108/108 before the historical RARE 011 changes.

## historical RARE 011 changes

The release keeps the protected core/self-development architecture and adds connected behavior for:

- responsive Flutter client -> HTTP core
- persistent chat list, load, send and export
- deeper-reasoning conversation mode
- journaled user-message editing
- persistent memory add/search/forget
- DOCX/XLSX/PPTX extraction plus optional PDF extraction
- text-document creation
- development task UI
- provider/tool/health visibility
- live speech recognition -> model -> speech loop
- policy-gated web search/fetch service

## Verification performed in this environment

- `python -m pytest -q` -> **113 passed**
- `python -m compileall -q .` -> success
- `python -m rare_core selftest` -> **13 passed, 0 failed**
- HTTP smoke test -> real conversation, memory, document creation and export routes exercised
- source-tree review for stale release wording and build junk

## Not claimed

Flutter/Dart is not installed in this Linux build environment, so `flutter analyze` and APK/Windows builds were not executed here. This release intentionally does not include fabricated APK/EXE artifacts.

## Free/local model behavior

The configured Ollama provider remains the preferred local model backend and does not auto-download a model. The application uses the existing core provider abstraction.


## historical RARE 014 audit correction
Independent source audit corrected the Daniel wait propagation bug, Flutter orb math call, module-import side effect, concurrent agent persistence, and capability descriptor drift. The release was revalidated with the full test suite and clean-room checks.
