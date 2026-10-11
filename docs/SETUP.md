# Setup

**Requirements:** Python **3.13 or newer**. There are no third-party packages. The release test environment uses Python 3.13.

## Windows
1. Install Python from python.org and tick **"Add Python to PATH"**.
2. Unzip the release folder somewhere, for example `C:\Users\you\Documents\rare`.
3. Open **PowerShell** or **Command Prompt** in the extracted release root and run:
   `py -3.13 rare_launcher.py`  (or `python rare_launcher.py`)

## macOS / Linux
```
cd ~/rare
python3 rare_launcher.py
```

## Android core-only testing: Pydroid 3
1. Copy the release folder to phone storage.
2. Open `rare_launcher.py` with a Python environment such as Pydroid 3 and run it.
3. This is core-only development testing; the normal phone experience is the Flutter app.

## Android: Termux
```
pkg install python
cd /sdcard/rare        # or wherever you copied it (run termux-setup-storage first for /sdcard)
python rare_launcher.py
```

## First run
The launcher (or `python -m rare_core init`) creates:
- `rare.config.json`, which holds all settings (see CONFIGURATION.md);
- `.rare/`, which holds tasks, checkpoints, memory, the audit log, approvals, the index and the API token;
- `knowledge/knowledge.json`, the project knowledge base with its initial rules.

## Check the install
```
python -m rare_core selftest                 # 13 checks, run in a temporary sandbox
python -m unittest discover -s tests -t .    # 58 tests
python -m rare_core demo                     # end-to-end demonstration on a copy (demo_workspace/)
```

## Optional: free local AI model
- **Ollama** (ollama.com): install and leave the server running at `127.0.0.1:11434`. RARE automatically detects compatible installed local models; it does not download models automatically. Qwen coding models are preferred, with fallback to other compatible local models.
- **OpenAI-compatible servers** (LM Studio, llama.cpp `llama-server`, LocalAI, vLLM): enable `providers.openai_compatible` in the config.
- **On Android**, Ollama and llama.cpp can run inside Termux, but a PC is recommended for speed.
- **Check what RARE sees:** `python -m rare_core providers`.

## Packaging status
- **Windows EXE:** not included in this source release because the native packaging toolchain is environment-specific.
- **Android APK:** not included in this source release because Android/Flutter packaging requires the platform toolchain.
- The Python core uses only the standard library; the Flutter client has its declared Flutter package dependencies in `rare_app/pubspec.yaml`.
