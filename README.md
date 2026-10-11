# COMPLETED — RARE-THE-SIXTH + RARE-INTELLIGENCE-MODEL (Integrated)

This repository is the **fully integrated** result of wiring the
**RARE-INTELLIGENCE-MODEL** engine into the **RARE-THE-SIXTH** application, with
all previously prepared bug fixes included.

```
COMPLETED/
├── rare-the-sixth/            # The app (React 19 + Vite 8 + Express / TypeScript)
│   └── src/server/providers/RareIntelligenceProvider.ts   # ← the integration bridge
└── rare-intelligence-model/   # The intelligence engine (React 19 + Vite 8 + Express / TypeScript)
```

## What was integrated

RARE-THE-SIXTH now treats the RARE-INTELLIGENCE engine as a **first-class model
provider** (`RareIntelligenceProvider`), registered in `ProviderRegistry` and
exposed through a new status endpoint `GET /api/integration/rare-intelligence`.

- **Purely additive.** The bridge is inert unless `RARE_INTELLIGENCE_URL` is set
  *and* the engine answers. When unset/offline, RARE-THE-SIXTH keeps its existing
  Ollama → offline-cognitive behaviour unchanged.
- **Genuine AI, zero mandatory cost.** The engine can serve inference from a free
  local OpenAI-compatible server (llama.cpp, LM Studio, vLLM, LocalAI, Ollama
  shim), a free-tier provider, or a user-supplied key. No paid service is required.
- **Graceful fallback.** If the engine is configured but unreachable, the app
  degrades to its native offline cognitive engine and still replies.

## Quick start (two terminals)

```bash
# 1) Intelligence engine (port 3000)
cd rare-intelligence-model
npm install
cp .env.example .env          # optional: point OPENAI_BASE_URL at a free local server
npm run start

# 2) The app (port 5000), bridged to the engine
cd ../rare-the-sixth
npm install
RARE_INTELLIGENCE_URL=http://127.0.0.1:3000 \
RARE_INTELLIGENCE_API_KEY=<engine client key> \
npm run dev
```

Then open http://localhost:5000 and chat — replies are produced by the engine.

## Verification (all green)

| Check | RARE-THE-SIXTH | RARE-INTELLIGENCE-MODEL |
|---|---|---|
| `npm install` | ✅ clean | ✅ clean |
| `npx tsc --noEmit` | ✅ 0 errors | ✅ 0 errors |
| `npm test` | ✅ all suites pass | ✅ all suites pass |
| `npm run build` | ✅ web + server | ✅ vite build |
| End-to-end genuine AI reply | ✅ via bridge | ✅ `isSimulated:false` |

See `INTEGRATION.md` for the full report, diffs, and remaining limitations.

## Bug fixes included

- **RARE-THE-SIXTH** — `package-lock.json` regenerated against the public npm
  registry (no Replit proxy URLs); `server.ts` settings references fixed to
  `appSettings.*`; `AppUser.password?` type fix.
- **RARE-INTELLIGENCE-MODEL** — `esbuild` bumped `^0.25.0 → ^0.28.0` to resolve
  the Vite 8 peer-dependency conflict.
