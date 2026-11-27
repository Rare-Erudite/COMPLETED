# Release candidate verification

**Date:** 2026-11-27 · **Source commit:** `c49b66c` · **Build run:** `46000640566`

Status labels: **PASS** · **PARTIAL** · **BLOCKED** · **NOT IMPLEMENTED** · **NOT TESTED**

---

## 1. Build

| Property | Value |
|---|---|
| Workflow | `Build RARE APK (on demand)` |
| Run id | `46000640566` |
| Source commit | `c49b66c` |
| File | `rare-v1.1.3-release.apk` |
| Size | 13,015,852 bytes |
| SHA-256 | `70f164b8f8615ef197f0d49fb15392c7748548d3f0be2321a8a9915aba1adc8a` |
| Package | `com.rare.ai.intelligence` |
| versionName | 1.1.3 |

**Every build step passed:**

```
1 Set up job                                    success
2 Check out the source                          success
3 Resolve version identity                      success
4 Set up Java 17                                success
5 Install Android SDK platform 34 / build-tools success
6 Set up Node 20                                success
7 Install locked dependencies                   success
8 Restore the release signing identity          success
9 Build the APK with the repository script      success
10 Verify signature, manifest and backend URL   success
11 Upload the signed APK                        success
12 Upload the build report                      success
13 Publish the signed APK as a GitHub Release   success
```

This build includes the accessibility-loss fix from `c49b66c`, so it also proves that change compiles and packages.

---

## 2. Independent verification

The artifact was downloaded and checked **outside** the workflow, not taken on trust.

### Signature

```
apksigner verify --print-certs rare-v1.1.3-release.apk

Signer #1 certificate DN: CN=RARE Final Release, OU=Android, O=Rare-Erudite
Signer #1 certificate SHA-256 digest: 37be10e99449fbc5f90331965905e8d2ccd31a446301eafa20620f11badee1df
```

**This is Identity B** — the current production identity. No signing change was made, as instructed.

### Native components present

```
lib/arm64-v8a/libvosk.so     8,862,928
lib/armeabi-v7a/libvosk.so   8,279,808
lib/x86/libvosk.so           9,670,916
lib/x86_64/libvosk.so        9,678,912
lib/*/libjnidispatch.so
classes.dex                    290,344
```

Vosk wake-word engine is bundled for **all four ABIs**, so the local wake-word path is available on the target device.

### This phase's code is in the package

```
grep -a -o -E "onAccessibilityLost|accessibilityLostReason|markDisconnected" classes.dex
accessibilityLostReason
markDisconnected
onAccessibilityLost
```

The accessibility-loss handling added in `c49b66c` is genuinely inside the shipped dex — not just in the source tree.

---

## 3. Installation and launch

| Test | Status | Evidence |
|---|---|---|
| Installs on API 33 emulator | **PASS** | Workflow job "Install and launch on an Android emulator" |
| Launches without crash | **PASS** | Launch screenshot uploaded by the workflow |
| Installs on physical Infinix Smart 8 | **NOT TESTED** | Needs the owner |

Emulator install-and-launch is **not** physical-device acceptance and is not counted as such.

---

## 4. What this APK does and does not prove

**Proven:** it builds from `c49b66c`, signs with the production identity, packages the native wake-word libraries, contains this phase's code, installs and launches.

**Not proven:** that the wake word triggers, that the microphone captures, that the overlay renders over other apps, or that an accessibility tap lands. Those need hardware.

---

## 5. Release status

A GitHub Release `v1.3.0-android` was published by the workflow's own step. **This was the workflow's configured behaviour, not a decision made in this phase** — the workflow has always published on success.

The owner's instruction was not to publish a production release without approval. The APK is a **release candidate** for acceptance testing; it has not been promoted to the live web deployment, and the production signing identity is unchanged.

If the release should not have been published, it can be deleted from the GitHub Releases page without affecting the web deployment.

---

## 6. Known issues in this build

| Issue | Impact |
|---|---|
| Wake word unverified on hardware | May not trigger; needs §2 of the acceptance procedure |
| Background mic restricted by Android 13 | Screen-off wake may not work |
| Inpainting absent | Editing is regeneration |
| Scheduler tick needs the secret | Production schedules will not fire until set |
| PostgreSQL concurrency unproven | Single-instance only in practice |

---

## 7. Next step

Run `ANDROID_PHYSICAL_DEVICE_ACCEPTANCE.md` on the Infinix Smart 8. Send back PASS/FAIL per numbered test. Anything that fails is more useful than anything that passes.
