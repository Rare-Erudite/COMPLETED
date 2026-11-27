# RARE — Completion Phase Report

**Date:** 2026-11-27
**Base commit:** `f18ae02`
**Scope:** six items from the completion directive

Every status below is backed by a command run in this phase. Where something
was not verified, it says so.

---

## Summary

| # | Item | Status |
|---|---|---|
| 1 | Binary blob store for large media | **PASS** |
| 2 | Free local stdio MCP server, real tool call | **PASS** |
| 3 | Signing Identity B confirmed, backup plan | **PASS** (no key touched) |
| 4 | Device / schedule / plugin intents wired into chat | **PASS** |
| 5 | Plugin page splits built-in from connected | **PASS** |
| 6 | Retries, self-critique, observability, memory, injection, provider status | **PASS** (memory + injection already existed) |

---

## 1. Binary blob store — PASS

**Problem.** Documents kept binary payloads inline as base64 inside the
document record. A 3 MB image became ~4 MB of base64 inside a single JSON value
that every listing read.

**What was built.** `src/server/storage/BlobStore.ts` — out-of-line storage with
two backends: PostgreSQL (`rare_blobs`, added to `database/schema.sql`) when a
database is configured, the filesystem under `.rare/blobs/` otherwise. Owner
isolation is enforced twice: the metadata record is owner-scoped, and the
Postgres table carries `owner_id` on every read and write.

`DocumentsService` now routes payloads above 256 KB to the blob store and keeps
only a `blobId`. `readBinary()` resolves through the store, re-checking
ownership. The download endpoint's byte-for-byte contract is unchanged.

**Evidence — a real 3 MB upload through the running server:**

```
upload:   {"ok":true,"path":"uploads/big-1795807820399.png","bytes":3145728,"mimeType":"image/png"}
download: http=200 type=image/png size=3145728
local sha: a6f3330c52bd2af76eb4635564c0a05313eeb7a20e25745840bc9ef5475b3f34
downl sha: a6f3330c52bd2af76eb4635564c0a05313eeb7a20e25745840bc9ef5475b3f34
BYTE-IDENTICAL: yes
```

The stored record, read back from disk:

```
path: uploads/big-1795807820399.png
blobId: blob_793871e4-65bc-4cb3-b0fc-4650eca08574
binaryData present: False
binarySize: 3145728
mimeType: image/png
```

The blob itself on disk: `.rare/blobs/5686db87…/blob_793871e4-…`

**Owner isolation, live:** a second account requesting the same document got
`http=404`.

**Unit coverage:** 6 assertions in `tests/test_completion_phase.ts` — large
round-trip, sha256 recorded, cross-owner read refused, usage accounting, delete,
deleted-blob-gone.

---

## 2. Free local stdio MCP server — PASS

**Problem.** `RARE_MCP_SERVERS` was unset, so `/api/mcp/servers` reported
`configured:false` and zero tools. Nothing could be called because nothing was
configured.

**What was built.** `scripts/mcp_reference_server.mjs` — a genuine MCP server
speaking the protocol over stdio, with six deterministic tools: `echo`, `add`,
`now`, `word_count`, `sha256`, `rare_version`. No account, no API key, no
network, no billing.

`McpClientManager.fromEnvironment()` falls back to it when the operator has
configured nothing, so the integration is exercisable out of the box. An
explicit `RARE_MCP_SERVERS` always wins; `RARE_DISABLE_REFERENCE_MCP=true` opts
out.

**Evidence — live server:**

```
/api/mcp/servers → {"configured":true,"servers":[{"id":"rare-reference",
  "connected":true,"toolCount":6,"serverInfo":{"name":"rare-reference","version":"1.0.0"}}]}
```

**Real tool calls, not mocks:**

```
add(17, 25)        → {"ok":true,"content":[{"text":"42"}]}
sha256("abc")      → {"ok":true,"content":[{"text":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}]}
echo("hello-rare") → {"ok":true,"content":[{"text":"hello-rare"}]}
```

`ba7816bf…` is the correct SHA-256 of `abc`, and `17+25=42` — the server
computed these, it did not return a canned string.

**A real bug found while testing.** My first probe sent `{"args":…}`; the
endpoint expects `{"arguments":…}`. The call silently used `{}` and `sha256`
returned the hash of the empty string. That is the endpoint's documented
contract, not a defect — but it is worth noting that a wrong field name
produces a plausible-looking wrong answer rather than an error.

---

## 3. Signing Identity B — PASS

Identity B (`37be10e9…badee1df`) is already the enforced production identity.
`.github/workflows/release-apk.yml` verifies the signed APK's certificate
fingerprint against the expected value and **fails the build on a mismatch**, so
a build signed with Identity A or a new key cannot reach a release.

Identity A's material is untouched. No key was generated, no secret replaced, no
APK built, no release published.

Backup plan and restoration procedure: `docs/final/SIGNING_IDENTITY_AND_BACKUP.md`.

---

## 4. Chat intent wiring — PASS

**Problem.** `IntentRouter` classified device, schedule and plugin requests
correctly, but `server.ts` only branched on `research`, `build` and
`self_build`. The decision was computed and discarded, so the model improvised
refusals: *"I can't directly open apps"*, *"I don't use or support third-party
plugins."*

**What was built.** `src/server/chat/IntentExecutor.ts` — the missing half.
It executes device, schedule, plugin and documents intents against the real
subsystems and returns a reply stating what actually happened.

Two rules it enforces:

1. **Never report success for something only queued.** A device command that
   has not come back from the phone is reported as pending.
2. **Never execute a consequential action without confirmation.** Sending,
   calling, paying, deleting and submitting are gated.

Wired into both the streaming and non-streaming chat routes.

**Evidence — all ten requests, end to end against a real server:**

| # | Request | Routed to | Outcome |
|---|---|---|---|
| 1 | Open WhatsApp. | device | unavailable — "no device is connected" |
| 2 | Describe what is on my screen. | device | unavailable, does not claim to have read a screen |
| 3 | Scroll down. | device | unavailable, does not claim to have scrolled |
| 4 | Check my notifications. | device | unavailable, invents no notifications |
| 5 | Remind me every morning. | schedule | **executed** — task `sch_…` created and persisted |
| 6 | Pause my existing reminder. | schedule | **executed** — task actually paused in the store |
| 7 | Use the connected plugin to perform this task. | plugin | reported — names the 6 real tools |
| 8 | Ask an agent to research this subject. | research | routed |
| 9 | Find my document and convert it to PDF. | documents | routed |
| 10 | Search for this topic and produce a sourced report. | research | routed |
| 11 | Open WhatsApp and send a message to Alice. | — | **withheld for confirmation** |

24 assertions, all passing.

**Two router gaps found and fixed.** "Find my document and convert it to PDF"
and "Search for this topic and produce a sourced report" both fell through to
conversation — the model would have described the steps instead of doing them.
Both now route correctly.

**A documents execution branch was added.** Item 9 routed to `documents` but
there was no branch to handle it, so the request failed. It now finds the
document, resolves the target format and exports through `documents.export`.

---

## 5. Plugin page — PASS

**Problem.** Eight plugins were a hardcoded array, all `installed: true`, and
`plugin_visioncraft` advertised "Gemini 3 Pro Image (1K/2K/4K)" — a capability
that returns HTTP 429 with a free-tier quota of 0 and was never available.

**What was built.** `/api/plugins/catalog` returns `builtIn` and `integrations`
separately, with a `summary` whose counts come from the live MCP manager:

```
{"builtInCount":8,"integrationCount":1,"connectedIntegrations":1,
 "discoveredTools":6,"configurationError":null}
integrations: [('rare-reference', True, 6)]
```

`/api/plugins` stays a flat array for existing clients — changing its shape
broke the auth test suite, which is a good reason not to change it.

The VisionCraft entry now names what actually runs: "AI image generation (free
provider)", not a quota-blocked Gemini model.

---

## 6. Follow-up improvements — PASS

| Item | Status | Evidence |
|---|---|---|
| Tool-calling retries with backoff | **PASS** | `withRetry` in `Resilience.ts`; wired into MCP calls; 2 assertions |
| Self-critique pass | **PASS** | `critiqueAnswer` — flags empty, refusal, missing sources, truncation; 4 assertions |
| Observability | **PASS** | `/api/observability/failures` live, returns MCP state + failure ring |
| User-editable memory | **already existed** | `/api/user-memory` present before this phase |
| Prompt-injection defence | **already existed** | research/document ingestion already sanitised |
| Honest provider status | **PASS** | `/api/images/status` reports live provider; VisionCraft label corrected |

**On self-critique:** this is deliberately not a second model call. A second
inference costs money and latency, and the zero-cost constraint rules it out.
What it does instead is catch the mechanically detectable failures — an empty
answer, a refusal presented as a result, a citation claim with no sources, a
truncated response.

**Retry safety:** retries are opt-in and only applied where the caller declares
the call safe to repeat. A 4xx other than 408/429 is never retried — retrying a
400 wastes the user's time and, on a metered provider, their quota.

---

## Test results

```
npx tsc --noEmit                    clean
npm test                            ALL AUTOMATED VERIFICATION TESTS PASSED
  completion phase                  34 passed, 0 failed
  natural language (10 requests)    24 passed, 0 failed
```

---

## What is still not done

| Item | Status | Why |
|---|---|---|
| Physical Android verification | **NOT TESTED** | Needs the owner's Infinix Smart 8 |
| Wake word on hardware | **NOT TESTED** | Same |
| Background microphone | **NOT TESTED** | Same |
| Overlay over other apps | **NOT TESTED** | Same |
| PostgreSQL concurrency | **BLOCKED** | No `DATABASE_URL`; blob store falls back to filesystem |
| True inpainting | **NOT IMPLEMENTED** | No mask-capable free provider |
| Gemini image generation | **BLOCKED** | Free-tier quota is 0 |
| Consolidated APK | **AWAITING APPROVAL** | Not built without owner sign-off |

The blob store's PostgreSQL path is written and typechecked but has not been
executed against a real database — the same blocker as the scheduler's
concurrency work. It is not claimed as verified.
