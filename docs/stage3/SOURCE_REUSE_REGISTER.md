# RARE — Source-Code Reuse Register

Required by the assignment (§2.12 and §21.4). Every entry records the origin,
licence, what was reused, what was modified, and where it lives in RARE.

**Rule applied throughout:** no code was copied from a project whose licence
was not verified. Where a project informed a design without any code being
copied, that is stated explicitly as *architecture reference only* — it is not
a reuse claim.

---

## 1. Reused code

| # | Origin | Repository | Licence | Reused component | Modification | RARE location |
|---|---|---|---|---|---|---|
| 1 | **pdf.js** (Mozilla) | `mozilla/pdf.js` | Apache-2.0 | PDF text extraction (`getDocument` → per-page `getTextContent`) | Wrapped in RARE's `processBuffer`/`processUrl` pipeline; page text joined and page count recorded | `src/server/content/DocumentIntelligence.ts` (invoked from `POST /api/documents/parse`) |
| 2 | **Model Context Protocol SDK** | `modelcontextprotocol/typescript-sdk` | MIT | Client transport (stdio/SSE/HTTP), `listTools`, `callTool` | Wrapped in `McpClientManager`; servers restricted to operator-configured `RARE_MCP_SERVERS` so a user cannot spawn arbitrary commands | `src/server/mcp/` + `GET /api/mcp/servers`, `GET /api/mcp/tools`, `POST /api/mcp/call` |
| 3 | **Transformers.js** (`@huggingface/transformers`) | `huggingface/transformers.js` | Apache-2.0 | ONNX Runtime inference, tokenizer loading, generation loop | Wrapped in `LocalTransformersServerProvider`; model id and quantisation configurable; memory guard added | `src/server/providers/LocalTransformersServerProvider.ts` |
| 4 | **ONNX Runtime** | `microsoft/onnxruntime` | MIT | Inference execution provider | Used through Transformers.js; no direct modification | transitive dependency |
| 5 | **Express** | `expressjs/express` | MIT | HTTP server and routing | RARE's own middleware chain (session, CSRF, origin allowlist) layered on top | `server.ts` |
| 6 | **Vite** | `vitejs/vite` | MIT | Dev server and production bundling for the React client | Standard config; RARE-specific proxy and build output paths | `vite.config.ts` |
| 7 | **React** | `facebook/react` | MIT | UI runtime | Application code only | `src/components/` |
| 8 | **Tailwind CSS** | `tailwindlabs/tailwindcss` | MIT | Utility CSS generation | Design tokens in RARE's own config | `tailwind.config.*` |
| 9 | **tsx** | `privatenumber/tsx` | MIT | TypeScript execution for scripts and the dev server | None | dev dependency |
| 10 | **pdfjs-dist** | `mozilla/pdf.js` | Apache-2.0 | PDF parsing (see entry 1) | — | dependency |
| 11 | **onnxruntime-node** | `microsoft/onnxruntime` | MIT | Native ONNX execution provider | None | dependency |

> **Correction recorded during verification:** an earlier draft of this
> register listed **Vitest** as a reused test runner. It is **not installed** in
> this repository. RARE's tests run through `tsx tests/run_all_tests.ts` with
> Node's own `assert`. The entry was removed rather than left as an unverified
> claim.

## 2. Architecture reference only — no code copied

These projects were inspected to understand a design. **No source was copied**,
so no licence obligation attaches. They are listed for transparency.

| Project | Repository | Licence | What was learned | Where it influenced RARE |
|---|---|---|---|---|
| **zafiro** | `niki914/zafiro` | MIT | Layering of a device-control provider behind a capability interface | Shape of the device-provider abstraction; implemented independently |
| **Ollama** | `ollama/ollama` | MIT | Local model server HTTP contract (`/api/generate`, `/api/tags`) | `OllamaProvider` speaks that contract so an existing Ollama install can be used |
| **Open WebUI** | `open-webui/open-webui` | BSD-3-Clause (with additional branding clause) | Conversation/workspace information architecture | UI organisation only; no assets or code reused |

## 3. Rejected candidates

| Project | Licence | Reason rejected |
|---|---|---|
| Several Android "AI assistant" shells reviewed during the device-layer work | GPL-3.0 / AGPL-3.0 / unlicensed | Copyleft or no licence would impose obligations incompatible with RARE's distribution model, or grant no rights at all |
| A popular "agent framework" with an SSPL-style licence | SSPL | Not an OSI-approved licence; service-use restrictions unacceptable |

## 4. Verification method

For each reused entry the licence file in the installed package was read
(`node_modules/<pkg>/LICENSE`) and the SPDX identifier recorded. This is a
point-in-time record; a dependency upgrade should re-check the licence.

## 5. What this register does **not** claim

- It does not claim RARE wrote these libraries.
- It does not claim any GPL/AGPL code was incorporated — none was.
- It does not claim the "architecture reference" projects contributed code.
