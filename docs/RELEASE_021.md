# RARE 021

RARE 021 is the consolidated correction release after the final audit of RARE 020.

It includes corrected Windows application/URL opening, configurable assistant wake names, public-network research with private-address blocking, current stable Flutter speech dependencies, demo-workspace cleanup, test import isolation, Android microphone/LAN preparation, checked-in RARE icon assets, and regression coverage for the corrected contracts.

The RARE core remains model-provider agnostic and uses Ollama with `qwen2.5-coder:7b` for the current free local testing path. RARE does not automatically download models and no paid API key is required for local operation.

The Flutter source implements the required responsive workspaces, chat controls, build/task UI, documents, research, live assistant, memory, device control, settings, activity stream and agent visualization. Native APK/Windows compilation remains a target-machine step because this audit environment does not contain Flutter/Dart/Android/Windows toolchains.
