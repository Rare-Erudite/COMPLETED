# Vision Studio Verification

**Commit:** `4a1bb2f48c7315dd2f2c8a05b0860fe433b569a8`
**Date:** 2026-11-26

---

## Provider status — BLOCKED

Direct call to the image endpoint with the supplied key:

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent
HTTP 429
{
  "error": {
    "code": 429,
    "message": "You exceeded your current quota... Quota exceeded for metric:
      generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0"
  }
}
```

**`limit: 0`** — the free tier grants **zero** image-generation requests for this model. This is not a transient rate limit; it is a hard zero quota. No amount of retrying will produce an image.

**Genuine AI image generation: BLOCKED.** No image-capable provider is available on this key without enabling billing, which would be an unapproved charge.

## What does work

| Item | Status | Evidence |
|---|---|---|
| Gemini **text** modes (4 modes) | **PASS** | `verify_gemini_modes_live.ts` — casual 3465 chars, professional 3872, creative 4086, concise 1855, all real provider responses |
| `/api/images/status` | **PASS** | Returns model catalogue and `hasKey` |
| `/api/images/gallery` | **PASS** | Owner-scoped gallery read |
| `/api/images/generate` | **BLOCKED** | 429 from provider |
| `/api/images/edit` | **BLOCKED** | Same provider, same quota |
| Procedural renderer | **PASS (as fallback)** | Works, and is labelled a fallback — it is **not** AI generation |
| Export to Documents | **NOT TESTED** | Depends on a generated image existing |

## The honesty requirement

The procedural renderer must never be reported as genuine AI image generation. It is a deterministic drawing routine. Any UI or report that presents its output as "AI generated" is wrong and should be corrected.

## What would unblock it

One of:
1. Enable billing on the Google AI project and use a paid image model.
2. Supply a key with image-generation quota.
3. Connect an alternative image provider the owner approves.

Until one of those exists, Vision Studio can generate **procedural** images only, and must say so.
