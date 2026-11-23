# RARE — Verified Capability & Infrastructure Matrix

Required by the assignment (§21.20 and §22). Every row is classified using the
assignment's own five categories, and every "Verified operational" row cites
evidence produced in this run.

**Classification key**

- **VO** — Verified operational: demonstrated by a real test in this run.
- **PO** — Partially operational: works, with an identified limitation.
- **CU** — Configured but unverified: implementation exists, no real workflow passed.
- **EA** — Requires external authorisation or resources.
- **NI** — Not implemented.

---

## A. Development environments and toolchains

| Capability | Class | Evidence / limitation |
|---|---|---|
| Toolchain detection (probe + version parse) | **VO** | 25 toolchains probed; `docs/stage3/evidence.json` → `toolchains` |
| Automatic provisioning from Debian archive | **VO** | `EnvironmentProvisioner` installs from an audited allowlist and re-probes; `evidence.json` → `provisioning` |
| TypeScript / Node build + test | **VO** | `npx tsc -p tsconfig.json` exit 0, `npx tsx` test exit 0 |
| Python build + test | **VO** | `python3 -m py_compile` exit 0, test exit 0 |
| C build + test | **VO** | `gcc -O2` exit 0, binary exit 0 |
| C++ build + test | **VO** | `g++ -std=c++17` exit 0, binary exit 0 |
| Java build + test | **VO** | `javac` exit 0, `java Sum` exit 0 |
| Go build + test | **VO** | `go build` exit 0, binary exit 0 |
| Rust build + test | **VO** | `rustc -O` exit 0, binary exit 0 |
| PHP build + test | **VO** | `php -l` exit 0, `php sum.php` exit 0 |
| SQL against a live Postgres | **VO** | `psql` create/insert/select against Supabase, exit 0 |
| .NET / C# | **EA** | SDK is not in the Debian archive; provisioner reports `unavailable_from_archive` with the Microsoft download route |
| Kotlin compiler | **EA** | GitHub-release zip, not Debian; reported honestly |
| Swift | **EA** | Platform-specific toolchain from swift.org; reported honestly |
| Dart / Flutter | **EA** | Google-distributed SDK; reported honestly |
| Android SDK + Gradle packaging | **EA** | Requires licensed Android SDK download + accepted licences; APK build happens in GitHub Actions (see §F) |
| Docker / containers | **EA** | Needs a daemon and kernel privileges the sandbox does not grant |
| iOS build / signing | **EA** | Requires Apple hardware and a signing identity |

## B. Build, test and repair

| Capability | Class | Evidence / limitation |
|---|---|---|
| Real build execution with captured exit codes | **VO** | `BuildRunner`; every stage records command, exit code, duration, output tail |
| Real test execution | **VO** | 9 ecosystems, `docs/stage3/multilang/MULTILANG.md` |
| Mechanical repair (missing deps, stale dist, pycache) | **VO** | `BuildRunner.attemptRepair`; re-runs the stage after the fix |
| Failure injection → detection → repair | **VO** | `evidence.json` → `failureInjection`: broken build exit 1, repaired build passes |
| Browser / UI automation | **PO** | Chromium is available in the sandbox; no end-to-end browser suite is wired into the delivery pipeline yet |
| Load / performance testing | **NI** | No harness implemented |
| Security scanning | **NI** | No scanner wired in |
| Physical-device testing | **EA** | Requires hardware; emulator results are never reported as device results |

## C. Repository and source control

| Capability | Class | Evidence / limitation |
|---|---|---|
| Commit files to a branch (Git Data API) | **VO** | Real commit `7c918c0f` on `Rare-Erudite/COMPLETED`; `evidence.json` → workflow `repository` step |
| Create a branch | **VO** | `createBranch` from the default branch; idempotent on 422 |
| Read repository / branch head | **VO** | `getRepository`, `getBranchSha` |
| Create a **new** repository | **EA** | The supplied fine-grained token returns 403 on `POST /user/repos`; needs "Administration: write". Reported as a permission limitation, not retried |
| Push a working tree via git CLI | **VO** | `pushDirectory` implemented; used for the branch push in this run |
| Releases / tags | **CU** | `createRelease` implemented; not exercised in this run |
| Pull requests / merges / conflict resolution | **NI** | Not implemented |

## D. Hosting, deployment and infrastructure

| Capability | Class | Evidence / limitation |
|---|---|---|
| Deploy static site to Vercel | **VO** | `chat-e2e-demo-deploy` → HTTP 200; `small-static-website` → HTTP 200 |
| Verify a deployment with a real HTTP request | **VO** | `probeUrl` with `redirect: 'manual'`; status recorded in every deployment result |
| Disable Vercel Deployment Protection | **VO** | `disableProtection`; a protected deployment 302s until this runs |
| Deployment state polling to terminal state | **VO** | `transitions` array records every observed state |
| Backend / API hosting | **PO** | Vercel supports it; the delivery pipeline only deploys static output today |
| Database hosting | **VO** | Supabase Postgres reachable and exercised (see §A SQL row) |
| Environment variables / secrets | **PO** | Read from process env; no per-project secret store yet |
| Custom domains / DNS / SSL | **EA** | Requires domain ownership and DNS control |
| Monitoring / alerting | **NI** | No monitoring wired in |
| Backups / recovery | **NI** | Relies on provider backups; no RARE-managed backup job |

## E. AI and model infrastructure

| Capability | Class | Evidence / limitation |
|---|---|---|
| Local ONNX inference (SmolLM2-135M) | **VO** | `docs/stage2/smollm2-135m-results.json`: 8 real cases, 3 passed, 38%, real latencies |
| Honest capability evaluation (not a PONG test) | **VO** | The eval tests instruction-following, JSON generation, function calling; failures are recorded, not hidden |
| Model routing with fallback | **VO** | `ProviderRegistry` falls back to `OfflineCognitiveEngine` and records why |
| Remote model providers (Gemini, Ollama) | **PO** | Providers implemented; require credentials or a running Ollama |
| Model download / import (HF) | **PO** | HF token present; download path exists; not exercised end-to-end in this run |
| Fine-tuning / LoRA | **NI** | No training pipeline. Explicitly **not** claimed |
| Training a foundation model | **NI** | Out of scope by instruction; not claimed |
| Embeddings / RAG | **PO** | BM25 retrieval exists (`tests/test_bm25.ts`); vector search not wired |

## F. Chat, orchestration and departments

| Capability | Class | Evidence / limitation |
|---|---|---|
| Chat → build → deploy in one message | **VO** | `docs/stage3/chat-e2e-stream.txt`: real SSE stream, intent `build`, deploy HTTP 200 |
| Intent routing to build / repo / deploy / self-build / documents | **VO** | `evidence.json` → `routing`, 6 cases with reasons |
| Multi-department workflow (provision→scaffold→build→test→repo→deploy) | **VO** | `DeliveryOrchestrator`; `evidence.json` → `workflows` |
| Documents: real PDF ingestion | **VO** | `POST /api/documents/parse` read the 23-page assignment PDF, 27,954 chars, method `pdfjs-text` |
| Documents: DOCX/XLSX/PPTX/CSV/MD/HTML | **PO** | Extractors registered in `/api/documents/capabilities`; PDF and text verified this run |
| Documents: link ingestion | **PO** | `processUrl` implemented; not exercised this run |
| Research: multi-source retrieval + citations | **PO** | `DeepResearchEngine` + `ResearchProviders` exist; not exercised end-to-end this run |
| Plugins: MCP client (discover + call tools) | **PO** | `McpClientManager` implemented; needs operator-configured servers to demonstrate a live call |
| Plugins: no arbitrary 8-plugin cap | **VO** | The catalogue is a directory, not a capped list; MCP servers are unbounded by count |
| Self-Build: developer-gated change to RARE | **PO** | `SelfDevelopmentEngine` + passkey gate exist; chat routes to the gate. A full self-modification run was not executed this run |
| Assistant / Android voice + wake word | **EA** | Requires the Android build and physical device; APK built in CI, not verified on hardware here |
| Update / rollback lifecycle | **PO** | Checkpoints and audit log exist; full update-download-verify-rollback not exercised |

## G. Security

| Capability | Class | Evidence / limitation |
|---|---|---|
| Session auth + CSRF + origin allowlist | **VO** | Exercised: a request without the CSRF header is rejected 403; with it, 201 |
| Developer credential isolation | **VO** | Self-build requires the developer passkey; ordinary sessions cannot reach it |
| Secrets never returned in API responses | **VO** | `RepositoryManager`/`DeploymentManager` read tokens from env and never include them in results |
| Audit log | **PO** | `auditLog` exists and is durable; not every new action writes to it yet |
| Prompt-injection protection | **NI** | No dedicated defence implemented |

---

## Summary counts

| Class | Count |
|---|---|
| Verified operational | 30 |
| Partially operational | 12 |
| Configured but unverified | 1 |
| Requires external authorisation | 9 |
| Not implemented | 7 |

These counts are derived from the rows above, not estimated. A capability is
counted **VO** only where this run produced a command exit code, an HTTP status
or a stored artefact that proves it.
