# Vision Studio — final verification

**Commit:** `c49b66c` · **Date:** 2026-11-27 · **Environment:** local sandbox + production `rareproject.vercel.app`

Status labels: **PASS** (operation executed and outcome verified) · **PARTIAL** · **BLOCKED** · **NOT IMPLEMENTED** · **NOT TESTED**

---

## 1. Provider: Pollinations (FLUX)

| Question | Answer | Evidence |
|---|---|---|
| Model / endpoint | `image.pollinations.ai/prompt/{prompt}` | `src/server/providers/FreeImageProvider.ts` |
| Payment method required | **No** | Live GET with no key, no account |
| Billing activation required | **No** | Same |
| API key required | **No** | Same |
| Free usage | Paced, not metered — 1 image / ~45 s per IP; over-limit returns `402 FREE_LIMIT` | Provider response handling in `FreeImageProvider.ts` |
| Expiry | No expiry date published; terms changed 2026-11-17 to a wallet model for *paid* tiers, anonymous tier retained | `pollinations.ai/terms` scraped 2026-11-27 |
| Licence | FLUX.1 [schnell] — Apache 2.0 | Black Forest Labs model card |

**Live generation test — PASS**

```
GET https://image.pollinations.ai/prompt/a%20red%20apple%20on%20a%20wooden%20table?width=512&height=512&nologo=true&seed=42
HTTP 200 · 512×512 JPEG · no key sent
```

Three consecutive requests: **3/3 HTTP 200**. The returned image was opened and visually confirmed as a photorealistic apple on a wooden table — genuine model output, not a placeholder.

**Caveat, stated plainly:** Pollinations' anonymous tier is a courtesy service. It is free today and requires no payment details, which satisfies the owner's constraint, but it is not a contractual guarantee. The provider adapter is therefore swappable and the procedural renderer remains as a labelled last resort.

---

## 2. Generation and editing

| Test | Status | Evidence |
|---|---|---|
| AI image generation | **PASS** | `POST /api/images/generate` → 201, `aiGenerated: true`, `provider: pollinations`, 68,429 bytes, 1024×1024 |
| AI image editing | **PARTIAL** | `POST /api/images/edit` → 201, 65,971 bytes, watercolour apple with visible brush strokes. Prompt-guided **regeneration**, not inpainting |
| True inpainting (mask-based) | **NOT IMPLEMENTED** | No `mask`/`inpaint` code exists in `src/server`. Pollinations accepts no mask parameter |
| Procedural fallback labelled | **PASS** | Every record carries `aiGenerated: false` when procedural |
| Silent substitution prevented | **PASS** | `FreeImageProvider` throws typed errors; it never returns a placeholder |

**On inpainting:** implementing it would need either a mask-capable hosted model (none available free without billing) or a local diffusion model (needs ≥6 GB VRAM; the sandbox has 773 MB RAM). Documented as unsupported rather than faked with a procedural transform.

---

## 3. Binary export to Documents — fixed this phase

**The defect:** `/api/images/export` called `DocumentsService.importBuffer()`, which ran text extraction and saved only `result.text`. Exporting an image stored a *description* of the picture. The endpoint returned 201, so it looked like it worked.

**The fix (commit `0cd49b0`):**

- `DocumentRecord` gains `binaryData` / `binarySize` / `mimeType`
- `DocumentsService.saveBinary()` / `readBinary()` / `readWithoutBinary()`
- `/api/images/export` stores the original bytes, keeps extracted text in `content` for search
- `GET /api/documents/*/download` serves the original bytes, registered **before** the wildcard reader so it is not swallowed
- Binary uploads keep their file; extraction metadata (`pages`, `kind`, `ocr`) is preserved so a stored PDF keeps real page provenance

**Tests — PASS** (`tests/test_documents_increment.ts`, 14 new assertions)

```
ok  PNG upload is accepted
ok  PNG upload reports the real byte count
ok  PNG download returns 200
ok  PNG download is served as image/png
ok  PNG bytes round-trip byte-for-byte
ok  PNG download is an attachment with a filename
ok  JPEG upload is accepted
ok  JPEG download is served as image/jpeg
ok  JPEG bytes round-trip byte-for-byte
ok  document JSON read omits the raw binary payload
ok  document JSON read still reports the binary size
ok  text document downloads as a file
ok  another account cannot download this image
ok  stored PDF preserves page provenance
```

The PNG and JPEG fixtures are built byte-by-byte in the test (real CRC32, real JPEG markers), so the comparison is against bytes the test fully controls — a single corrupted byte fails it.

| Test | Status |
|---|---|
| Real image bytes export to Documents | **PASS** |
| PNG integrity | **PASS** |
| JPEG integrity | **PASS** |
| Download returns original binary | **PASS** |
| Owner isolation on download | **PASS** (404 for another account) |
| Image opens outside Vision Studio | **PASS** (valid PNG/JPEG served with correct MIME) |

---

## 4. Gallery, quota and failure handling

| Test | Status | Evidence |
|---|---|---|
| Gallery persistence | **PASS** | Records survive reload; `GET /api/images` returns them |
| Owner isolation | **PASS** | Another account → 404 |
| Download | **PASS** | 200, correct MIME, correct byte count |
| Unauthenticated access | **PASS** | 401 |
| Quota exhaustion reported | **PASS** | `402 FREE_LIMIT` parsed and surfaced, not swallowed |
| Provider failure handling | **PASS** | Typed errors; no silent procedural substitution |
| Status endpoint probes live | **PASS** | `activeProvider: pollinations`, `requiresBilling: false` |

---

## 5. Gemini image generation

**BLOCKED.** `gemini-3-pro-image-preview` returns **HTTP 429** with free-tier `limit: 0` — a zero allowance, not a rate limit. No billing will be enabled, so this path stays unavailable. It is retained as a secondary provider for accounts that do have quota.

---

## Summary

| Capability | Status |
|---|---|
| Genuine AI image generation, zero cost | **PASS** |
| Image editing (regeneration) | **PARTIAL** |
| True inpainting | **NOT IMPLEMENTED** — documented |
| Binary export to Documents | **PASS** |
| Gallery / history / download | **PASS** |
| Owner isolation | **PASS** |
| Quota and failure reporting | **PASS** |
| Gemini image generation | **BLOCKED** — zero free quota |
| No billing enabled | **PASS** |
