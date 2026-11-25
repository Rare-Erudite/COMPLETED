# RARE — Deployment Access: Cause, Fix and Procedure

**Date:** 2026-11-24
**Project:** `rareproject` · team `mypremierai-2827`
**Repo:** `Rare-Erudite/COMPLETED`
**Fix commit:** `27ee795` on branch `rare/deploy-access-fix`

---

## 1. The actual cause

The report was "the most recent work was not deployed." That was half right, and
the half that was wrong matters.

**The GitHub → Vercel integration was never broken.** It is healthy and has been
throughout:

- `link.type = github`, `link.repo = COMPLETED`, `link.org = Rare-Erudite`
- `link.productionBranch = main` — correct, and left unchanged
- Every push to a non-production branch **did** create a Preview deployment
  automatically. Commit `3e4dcb4` on `stage2-infra-evidence` was deployed at
  08:22:51Z and reached `READY`.

So the engineer's own handover note — *"Vercel token not present in this
sandbox, so the deploy cannot be triggered from here"* — was a **misdiagnosis of
a symptom**. He could not trigger a deploy from his sandbox, concluded the
deploy had not happened, and never checked whether Vercel had already done it.
It had.

**The real defect was that the deployed preview was unusable.** Every preview
deployment was rejected by the application's own origin allowlist:

```
POST /api/user/guest-session
Origin: https://rareproject-17li6nh93-mypremierai-2827.vercel.app
→ 403 {"error":{"message":"This origin is not allowed."}}
```

`server.ts` built its allowlist from `RARE_ALLOWED_ORIGINS`, a static
comma-separated list. Vercel assigns every preview deployment a **fresh,
unpredictable hostname** (`rareproject-<hash>-<team>.vercel.app`) plus a
per-branch alias (`rareproject-git-<branch>-<team>.vercel.app`). A static list
can never contain a hostname that did not exist when the list was written.

The consequence was worse than a broken page: the SPA loaded fine, so the
preview *looked* deployed, but the API refused every request. The app could not
even create a guest session, so it was a shell with no working backend. That is
why the work "was not deployed" from the engineer's point of view — he was
looking at a preview that rendered but did nothing.

**Evidence of the before/after, same request, same origin:**

| Deployment | Commit | `guest-session` from own origin |
|---|---|---|
| `rareproject-17li6nh93-…` | `3e4dcb4` (no fix) | **403** |
| `rareproject-ov1sf091l-…` | `27ee795` (with fix) | **200** |

---

## 2. The fix

`server.ts` now admits this project's own preview hostnames, and only when the
process is actually running as a Vercel preview:

```ts
const PREVIEW_ORIGIN_PATTERN =
  /^https:\/\/rareproject(?:-git-[a-z0-9][a-z0-9-]*)?(?:-[a-z0-9]+)?-mypremierai-2827\.vercel\.app$/;

function isPreviewDeploymentOrigin(origin: string): boolean {
  if (process.env.VERCEL_ENV !== 'preview') return false;
  return PREVIEW_ORIGIN_PATTERN.test(origin);
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return allowedOrigins.has(origin) || isPreviewDeploymentOrigin(origin);
}
```

The pattern is anchored at both ends and pinned to the project name **and** this
team's scope, so it cannot be widened by a lookalike. It is applied at all three
enforcement points (CORS, the CSRF check, and the `/api` gate) — the CSRF and
gate checks previously used `allowedOrigins.has()` directly and would have
rejected previews even with CORS fixed.

**Production is provably unaffected.** `VERCEL_ENV` is `production` there, so
`isPreviewDeploymentOrigin` returns `false` before the pattern is even tested.

### Verified boundary (real server, both modes)

| Origin | preview mode | production mode |
|---|---|---|
| `rareproject-17li6nh93-…` (own preview) | **200** | 403 |
| `rareproject-git-stage2-infra-evidence-…` (branch alias) | **200** | — |
| `rareproject.vercel.app` (configured) | **200** | **200** |
| `otherproject-abc-…` (other project) | 403 | — |
| `rareproject-abc-someoneelse-9999.…` (other team) | 403 | — |
| `rareproject-evil.attacker.com` (lookalike) | 403 | — |
| `example.com` | 403 | — |

`tests/test_preview_origin.ts` pins both directions — 15 assertions, all
passing. A test that only proved the admit half would let a wildcard regression
through.

---

## 3. Deployment authentication

**No new secret was needed, and none was created.** The Git integration
authenticates Vercel to GitHub on its own; pushes deploy without any token in
the loop. That is the mechanism to rely on, and it is already working.

For the cases that genuinely need the API (promoting a deployment, reading
status), `scripts/deploy.mjs` reads `VERCEL_TOKEN` **from the environment
only**:

- never written to a file
- never echoed, never included in output
- fails with an instruction if unset, rather than prompting — so it is safe in CI

`.env` and `.env.*` are already in `.gitignore`. The token must live in the
shell environment or a CI secret store, never in the repository.

```bash
export VERCEL_TOKEN=...        # never commit this value
node scripts/deploy.mjs status
```

---

## 4. The procedure

### Preview (automatic — this is the normal path)

```bash
git push origin <branch>
```

Vercel creates a Preview deployment automatically. No token, no manual step.
Find it with:

```bash
node scripts/deploy.mjs preview <branch>
```

### Verify a preview before promoting

```bash
node scripts/deploy.mjs verify https://<preview-url>
```

Checks the root, `/api/health` (and reports the commit it is serving), and the
origin check that was broken. Exits non-zero on any failure.

### Promote an approved change to production

Production is `main`. Promotion is a deliberate, reviewed act:

1. **Review the preview.** Open the preview URL, confirm the change, and run
   `verify` against it.
2. **Merge to `main`** through a pull request. The merge commit is what gets
   deployed — not the preview artifact.
3. **Vercel deploys `main` to production automatically** and moves the
   `rareproject.vercel.app` alias.
4. **Verify the live domain:**
   ```bash
   node scripts/deploy.mjs verify https://rareproject.vercel.app
   ```
   Confirm the reported `commit=` matches the merge commit you intended.

**Alternative — promote an existing deployment without merging:**

```bash
node scripts/deploy.mjs promote https://<preview-url>
```

This repoints the production alias at that exact deployment. Use it only when
you deliberately want to ship a build that is not on `main`; the alias will then
diverge from the branch until the next `main` deploy. Prefer the merge path.

### Rollback

Promote the previous known-good deployment:

```bash
node scripts/deploy.mjs promote <previous-deployment-url>
```

---

## 5. What was NOT done

- **Production was not touched.** `rareproject.vercel.app` still serves
  `fbf21a74e` on `main`, verified healthy in this run. The fix is on a branch
  and its preview, awaiting review.
- **`main` was not modified.** No merge, no force-push, no history rewrite.
- **No APK was built** (standing policy).
- **No credential was rotated.** The Supabase password remains in git history
  from an earlier commit; that is the owner's action to take.
