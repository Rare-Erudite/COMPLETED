# Signing Identity Continuity

**Commit:** `4a1bb2f48c7315dd2f2c8a05b0860fe433b569a8`
**Date:** 2026-11-26
**Status:** REPORT ONLY — no key was changed, no secret replaced, no release published.

---

## The discrepancy

Two signing identities exist in this project's history.

| Identity | Certificate SHA-256 | Signed releases |
|---|---|---|
| **A** (handed over) | `C550FD6549D7BBDF2201F9578EFB143128F925CF7F8830DDFFD349F4995BC57B` | v1.0.0, v1.1.0, v1.1.1 |
| **B** (current production) | `37be10e9…badee1df` | v1.1.2, v1.1.3, v1.2.0, v1.3.0 |

Commit `aefc54c` ("Fix release APK delivery and gate final package", 2026-11-06) changed the workflow's expected fingerprint from A to B. Its own release notes state:

> "This release uses a **replacement signing identity**. Existing installs signed by earlier RARE releases cannot update in place… The old published signer was **not recoverable** from the local key or prior Actions secret."

## Consequence

The keystore handover completed earlier — both archives, the rotated password, the CI proof — protects **identity A**, which stopped being the production key on 2026-11-06. The handover was correct for its stated scope; the premise underneath it was already stale.

**Identity B is currently backed up only in GitHub Actions secrets plus a Windows DPAPI file on one machine.** That is a single point of failure. If that machine is lost and the secrets are rotated, identity B is gone and every future release breaks the update path again.

## Options

### Option A — keep identity B as production

- Back up identity B properly: export the keystore, encrypt it, store two offline copies.
- No user impact. Updates continue to work for everyone on v1.1.2+.
- Users still on v1.1.1 or earlier remain stranded (they already are).

### Option B — deliberately return to identity A

- Every install from v1.1.2 onward must be **uninstalled and reinstalled**; in-place update is impossible.
- User data stored in app-private storage is lost on uninstall unless exported first.
- Identity A is already backed up and verified, so this is the better-documented key.

## Recommendation

**Option A**, with a proper backup of identity B. Returning to A costs every current user their install and their local data, to gain nothing except a better-documented key — and that documentation gap can be closed by backing up B.

## Decision gate

This requires the owner's explicit decision. Until then:

- Production signing configuration is **unchanged**.
- No secret was replaced.
- No release was published.
- No new identity was generated.

## What is needed to execute either option

For Option A: access to the machine holding the DPAPI-protected keystore, or the ability to re-export from the Actions secret. Then the same encrypt-and-verify procedure already proven for identity A.
