# RARE Android APK — reproducible build

RARE packages a web build inside a native Android WebView shell (`com.rare.ai.intelligence`). The build is source-first and does not use an existing APK as input.

## Toolchain

- Node.js 20.19 or later.
- Java JDK. CI uses JDK 17; the available Android Studio JBR on the development laptop is JDK 25.
- Android SDK platform and build-tools. `scripts/build_apk.sh` discovers the highest installed platform/build-tools unless `ANDROID_COMPILE_SDK`, `ANDROID_JAR`, or `ANDROID_BUILD_TOOLS` is specified.
- Git Bash on Windows or Bash on Linux/macOS. Windows tool launchers are handled explicitly.

The CI workflow pins Android platform 34/build-tools 34.0.0 for reproducible packaging and uses a separate API 33 (Android 13) emulator to validate installation and in-place update compatibility.

## Permanent signing identity

The published 1.1.0 and 1.1.1 APKs use a certificate that is no longer recoverable from the available secure backups or the previous Actions secret. The owner authorized a clean-install transition. RARE now has a replacement RSA-4096 release identity with certificate SHA-256:

`37:BE:10:E9:94:49:FB:C5:F9:03:31:96:59:05:E8:D2:CC:D3:1A:44:63:01:EA:FA:20:62:0F:11:BA:DE:E1:DF`

The Actions secret was updated and verified by a fingerprint-only workflow. The encrypted PKCS#12 keystore and a DPAPI-protected password backup are stored outside the repository under the owner's Windows profile at `Documents\Codex\RARE-Signing-Backup`. The password can be restored while signed in to that Windows account. `restore-github-secrets.ps1` verifies the fingerprint before restoring the four Actions secrets; it does not print secret values.

The old APKs have a different signer. Android will not install this replacement over those builds. Users must sync accounts and export any device-only data, uninstall the old app, then install the new APK. Cloud-backed accounts and records remain available only if the production database is configured, reachable, and verified.

## Backend and version

The shipped client must point to `https://rareproject.vercel.app`. The build injects this backend URL into the packaged web shell and rejects localhost URLs. The current source package/release version is 1.1.2. CI derives a unique monotonically increasing Android version code from the UTC build date and workflow run number.

## Local build

```bash
npm ci
export ANDROID_SDK_ROOT=/path/to/android-sdk
export RARE_BACKEND_URL=https://rareproject.vercel.app
export RARE_ANDROID_KEYSTORE=.rare/android/rare-release.keystore
export RARE_ANDROID_KEY_ALIAS=rarekey
export RARE_ANDROID_STORE_PASS='load-from-your-secret-manager'
export RARE_ANDROID_KEY_PASS='load-from-your-secret-manager'
bash scripts/build_apk.sh
```

Output: `exports/rare-v1.1.2-release.apk` (also copied to `public/` and `dist/`). Do not check local signing material into Git.

## Final release verification

Ordinary CI never packages APKs. The separate final workflow requires a frozen tag whose commit is the exact current `main` commit and whose production deployment status and `/api/health` response attest the same SHA. It checks production database health and the replacement signer, builds one APK, and performs clean installs on API 21, 33, and 36. After the emulator matrix passes, it creates a draft GitHub Release, downloads the assets back, verifies the SHA-256 file, then publishes the release. No in-place update from 1.1.1 is claimed or attempted.

## Current verification state

The replacement key was generated once, its DPAPI backup was restored and verified, and it successfully signed a temporary test JAR; no APK was built. The fingerprint-only Actions workflow confirmed the encrypted repository secret matches the replacement certificate. No final source tag exists, the application release gates are incomplete, and the emulator clean-install matrix has not run. Do not build or publish an APK until the final production source passes those gates.
