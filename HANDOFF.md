# RARE 045 Master Handoff

RARE 045 is the protected, local-first AI system with a Universal Build Engine, multi-department workspace suite, and developer-gated self-development core.

## System Architecture

1. **Theme System (6 Semantic Palettes)**:
   - **Blue (Default)**: Deep navy background (`#03040A`), panel (`#0A0D19`), card (`#101427`), with electric indigo accent (`#5C7CFF`).
   - **White**: Clean light palette (`#F8FAFC` background, white surfaces, slate text).
   - **Dark**: Deep onyx carbon palette (`#000000` background, high contrast).
   - **Red**: Crimson ruby palette (`#0B0305` background, rose accents).
   - **Green**: Emerald matrix palette (`#020B06` background, vibrant emerald accents).
   - **Yellow**: Amber gold palette (`#0B0802` background, warm amber accents).
   - Semantic tokens persist across restarts via `localStorage` and `/api/settings`.

2. **Universal Build Engine (Dual Entry Points)**:
   - **Sidebar Project/Build**: General-purpose builder available to authorized users to generate applications across all domains (Web, Android APK, Windows EXE, Backend, CLI, Games, AI systems).
   - **Command Center Project/Build**: Privileged self-development engine restricted by the Developer Authorization Gate (`rare-master-dev` passkey) to inspect RARE's own source code, execute the `SNAPSHOT → INSPECT → PLAN → MODIFY → VALIDATE → DIAGNOSE → REPAIR → ACCEPT or ROLLBACK` loop, and safeguard against regressions.
   - **Diagnose-and-Repair Cycle**: Automatically runs test suites, diagnoses failure causes, applies targeted patches, and reverts upon unrecoverable faults.
   - **Toolchain Matrix**: Detects Node.js 22, TypeScript, Vite, Python 3.13, Android Gradle, Windows MSVC, and Rust Cargo.

3. **Documents & Context-Aware Audio Transcription**:
   - Multi-format file reader & editor (Markdown, Text, Code, Transcripts).
   - Cloud / Google Drive URL importer.
   - Context-aware audio transcription engine: reconciles acoustic ambiguity against trusted domain corpora (e.g. verifying faint audio followed by quotation *"Therefore, leaving the discussion of the elementary principles of Christ..."* as **Hebrews 6:1–2** with 98.4% confidence).
   - Multi-format export (PDF, Markdown, HTML, JSON).

4. **Research Department**:
   - Multi-source evidence synthesis across documentation, academic publications, and technical repositories.
   - Credibility ratings, comparative matrices, citations, and export bridges to Documents and the Universal Build Engine.

5. **Local-First Model Control**:
   - Prioritizes local deterministic reasoning and Ollama without requiring paid API keys for core operation.
   - Graceful remote integration with `@google/genai` when an authorized Google AI Studio key is provided.

6. **Updates, Checkpoints & Reliability**:
   - In-app release updater (v0.45.0 → v0.45.1) with package SHA-256 verification.
   - Atomic checkpoints and rollback registry to restore known-good states.
   - Full selftest diagnostics matrix validating syntax, sandboxing, and concurrency.

7. **Clean User Interface Audit**:
   - Stripped all internal developer-oriented text, implementation notes, diagnostic labels, and architecture jargon from ordinary user-facing screens.
   - Document Center focuses exclusively on document management, editing, and transcription.
   - Command Center provides clean project metrics, quick actions, and readable progress stages.

8. **Dedicated Developer Space (Settings → Developer Space)**:
   - Centrally located under Settings and protected by a server-enforced developer passkey (`rare-master-dev`).
   - Houses the privileged Self-Development Engine, Live Multi-Agent Telemetry, Real System Configuration, Test Suite Diagnostics, Checkpoints & Rollback, and Engineering History.

9. **Collaborative Multi-Agent Architecture**:
   - Coordinator / Orchestrator assigns specialized agents (Architect, Mobile/Frontend Developer, Backend Engineer, QA/Test Engineer, Release Specialist).
   - Real-time inter-agent messaging, structured handoffs, tool activity, and visible collaboration with polished circular agent emblems and status badges.
   - Clean user progress indicators separated from deeper developer telemetry.

10. **Live Voice Dialogue Engine**:
   - Integrated full Web Speech recognition (`SpeechRecognition` / `webkitSpeechRecognition`) with continuous listening and live interim transcript feedback.
   - Real-time microphone audio visualizer with dynamic waveform equalizer bars and pulsating decibel meters driven by Web Audio API (`AudioContext` + `createAnalyser`).
   - Bidirectional audio loop: captures user speech, processes via `/api/voice/chat`, and audibly responds with `SpeechSynthesis` through speakers/headphones.
   - Automatic re-arming for hands-free conversational flow, audible greeting upon initiation, and quick voice prompt fallbacks.
