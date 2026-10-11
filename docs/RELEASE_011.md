# RARE 011

RARE 011 is the next sequential release after RARE 010. It keeps the RARE 010 core architecture and replaces several unfinished interface/backend gaps with connected implementations.

## Implemented in this release

- Real responsive Flutter client wired to the RARE HTTP core instead of static capability cards.
- Persistent chat list/loading, real provider-backed messages, copy/export, and a usable deeper-reasoning switch.
- Persistent memory add/search/forget flows.
- Journaled user-message editing with restart recovery.
- Document inspection expanded to TXT/MD/JSON/CSV/LOG plus OOXML DOCX/XLSX/PPTX and optional PYPDF-backed PDF extraction.
- Text document creation through the core API.
- Real development-task submission/continuation in the Projects UI.
- Real health/tool visibility in the Tools UI.
- Live speech-recognition -> RARE -> speech-output loop in Flutter, with listening/thinking/speaking states and stop controls.
- Standard-library web fetch/search research service, policy-gated by `security.allow_network_tools`.
- Loopback UI marker for the local desktop client; remote clients still use the RARE API token.

## Verification

The Python regression suite passes 114 tests in the build environment. Python source is compiled with `py_compile`. A full Flutter/Dart build was **not** claimed because Flutter/Dart is not installed in this build environment.

## Important runtime notes

- Local Ollama remains the preferred free provider. RARE does not automatically download models.
- PDF extraction requires the optional `pypdf` package if a project needs PDF parsing; the release does not download it automatically.
- The live voice experience uses the device speech-recognition and speech-synthesis engines available to the Flutter platform. Naturalness and interruption quality depend on those platform engines.
- Android/Windows APK/EXE artifacts are not included in this source ZIP unless they were actually built and verified with the corresponding toolchain.
