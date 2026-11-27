# Gemini CI — verification

**Commit:** `c49b66c` · **Date:** 2026-11-27

Status labels: **PASS** · **PARTIAL** · **BLOCKED** · **NOT IMPLEMENTED** · **NOT TESTED**

---

## 1. The gap

`scripts/verify_gemini_modes_live.ts` existed but **no workflow referenced it**. `grep -i gemini .github/workflows/` returned nothing. "Gemini works" rested on one hand-run — exactly the "a single successful manual run is not proof of an automated CI workflow" failure.

Worse: the script **always exited 0**, even when every mode returned empty text. A CI job built on it would have gone green while the provider was down.

---

## 2. What was added

### `scripts/verify_gemini_modes_live.ts` — now a real gate

```ts
if (failedModes > 0) {
  console.error(`FAILED: ${failedModes} of ${PERSONA_MODES.length} mode(s) returned no text.`);
  process.exit(1);
}
```

**Verified both directions:**

| Key | Result | Exit |
|---|---|---|
| Valid key | 4/4 modes returned real text | **0** |
| `invalid-key-for-test` | all modes empty | **1** |

A gate that cannot fail is not a gate. This one fails.

### `.github/workflows/gemini-live.yml`

| Property | Value |
|---|---|
| Triggers | `workflow_dispatch` + `pull_request` on `main` (paths: providers, persona, the script, the workflow) |
| Secret | `GEMINI_API_KEY` from GitHub Actions secrets, passed as an env var |
| Never printed | No `echo`, no artifact, no URL |
| Missing key | `::warning::` + `configured=false` → the job **skips loudly** and the summary says "This is not a pass" |
| Modes | casual, professional, creative, concise |
| Cost | exactly 4 small text calls per run; no image calls |
| Artifact | `gemini_mode_results.json`, 14-day retention |

**Deliberately excluded:** image generation. It is quota-blocked (`limit: 0`) and would fail for reasons unrelated to the text provider — a text test must not be used as proof that image generation works.

---

## 3. Live run — PASS

```
GEMINI_API_KEY=<provided> npx tsx scripts/verify_gemini_modes_live.ts

casual        model=gemini-3.8-flash  chars= 2976  ms=4528
professional  model=gemini-3.8-flash  chars= 4557  ms=15404
creative      model=gemini-3.8-flash  chars= 4157  ms=3686
concise       model=gemini-3.8-flash  chars= 1404  ms=6610

PASSED: all 4 modes returned real text.
```

All four modes returned genuine provider output with distinct lengths and latencies — not cached, not templated.

**Retired models:** `gemini-2.0-flash` and `gemini-2.5-flash` return 404. The provider defaults to `gemini-3.8-flash`, which is current. No retired id was reintroduced.

---

## 4. Status

| Item | Status |
|---|---|
| Script fails when the provider fails | **PASS** |
| Workflow committed and correct | **PASS** |
| Four modes against the real provider | **PASS** |
| Key never exposed | **PASS** (header/env only, no echo) |
| Missing key skips, not passes | **PASS** |
| Workflow has actually run in CI | **NOT TESTED** — needs `GEMINI_API_KEY` in repository secrets |

**Owner action:** add `GEMINI_API_KEY` under Settings → Secrets and variables → Actions. Until then the workflow skips by design and reports that honestly.

---

## 5. Note on the key in this conversation

The key was pasted in plaintext into chat. It should be rotated. The workflow reads it from secrets, so rotation only requires updating the secret — no code change.
