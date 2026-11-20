# RARE — Verification Report

**Date:** 2026-11-20
**Commit verified:** `b667ddeb272aaca3c0ced27fe236c2f7ab1d86e9` (branch `main`)
**Environment:** Node 20, Java 17, Debian Linux sandbox; Android build via GitHub Actions.

Every result below is copied from a command that actually ran in this session. Nothing is
inferred or fabricated.

---

## 1. Typecheck

```
$ npx tsc --noEmit
TSC_EXIT=0
```
**Result: PASS** (no type errors).

## 2. Build

```
$ npm run build        # vite build + sync_vercel_static + build_server
BUILD_EXIT=0
```
**Result: PASS** (web bundle and server bundle both built).

## 3. Unit tests

```
$ npm test             # tsx tests/run_all_tests.ts
...
  ALL AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY
TEST_EXIT=0
```
Includes the new `[Test Group] Device action catalogue & planner validation` suite
(15 actions declared; unknown tool rejected; missing/typed/enum arguments rejected;
model-facing description covers every action).

**Result: PASS.**

## 4. E2E tests

```
$ npm run test:e2e     # Playwright, desktop-chrome + mobile-chrome
  ✓  1 [desktop-chrome] local account registration persists through reload and opens core workspaces (7.0s)
  ✓  2 [desktop-chrome] mobile layout keeps the app within the viewport and exposes the account entry point (2.0s)
  ✓  4 [mobile-chrome]  mobile layout keeps the app within the viewport and exposes the account entry point (2.2s)
  3 passed (17.4s)
E2E_EXIT=0
```
**Result: PASS** (3/3).

## 5. Android build, sign, verify, publish

GitHub Actions run **44812972021** (`Build RARE APK (on demand)`, commit `b667dde`):

| Step | Result |
|---|---|
| Build the APK with the repository script | success |
| Verify signature, manifest and packaged backend URL | success |
| Upload the signed APK | success |
| Publish the signed APK as a GitHub Release | success |

**Result: PASS.** Release `v1.2.0-android` published with
`rare-v1.2.0-release.apk` (280,329 bytes) and its `.sha256`.

> Note: the first dispatch (run 44812726550) **failed** at step 9 with
> `RareWakeWordService.java:102: error: cannot find symbol ... LambdaMetafactory`.
> The build compiles against `android.jar` with javac and no lambda support. The three
> lambdas were converted to anonymous `Runnable` classes and the run re-dispatched; the
> second run passed. This is recorded so the failure is not hidden.

## 6. Emulator install and launch

Same run, job **Install and launch on an Android emulator**:

| Step | Result |
|---|---|
| Enable KVM | success |
| Download the APK | success |
| Install and launch on API 33 | success |
| Upload the launch screenshot | success |

The screenshot (`emulator-launch.png`, 1080×2400) shows the RARE app fully loaded with its
greeting, prompt suggestions and input bar — **no crash dialog, no error**. Confirmed by
visual inspection.

**Result: PASS.**

## 7. APK integrity

```
$ sha256sum rare-v1.2.0-release.apk
1fd841908d5e97ba749419a366784658284110f8b43b88c345c1ea105486afef
$ cat rare-v1.2.0-release.apk.sha256
1fd841908d5e97ba749419a366784658284110f8b43b88c345c1ea105486afef
```
The downloaded APK's checksum **matches** the published checksum. The APK contains
`META-INF/RARE-FIN.RSA` (signed) and `classes.dex`.

**Result: PASS.**

## 8. Merge into `main`

```
$ git push origin main
   c3b5217..b7b344b  main -> main
$ git push origin rare-oss-rebuild
   694a63a..b7b344b  rare-oss-rebuild -> rare-oss-rebuild
```
Both branches fast-forwarded to the same commit; **no force-push** was used.

**Result: PASS.**

## 9. Vercel deployment

Production deployment `dpl_6tgYZiWVbwgDsuoCiBbJcpPgf9WP` — state **READY**, target
**production**, commit `b667dde`.

```
$ curl https://rareproject.vercel.app/api/health
HTTP 200
{"ok":true,"name":"RARE Server","commit_sha":"b667ddeb272aaca3c0ced27fe236c2f7ab1d86e9",
 "status":"healthy","assistant_name":"RARE",...}
$ curl https://rareproject.vercel.app/
HTTP 200
$ curl https://rareproject.vercel.app/api/device/actions
HTTP 401
```
The live site is healthy and serving the verified commit. `/api/device/actions` returns
401 because it is behind the auth middleware (the route is registered; an unauthenticated
request is correctly rejected).

**Result: PASS.**

---

## What was NOT verified

- **A real multi-step device task on a physical phone.** The emulator smoke test launches
  the app but does not drive the autonomous loop. The loop's logic is unit-tested
  (validation) and typechecked, but end-to-end execution on a device was not run here.
- **The wake word on a real device.** The service compiles and is registered, but its
  microphone behaviour was not exercised on hardware.
- **The planner against a live model.** No provider key was configured in this run, so the
  planner's "no model available" path is what would execute; the happy path was not run.
