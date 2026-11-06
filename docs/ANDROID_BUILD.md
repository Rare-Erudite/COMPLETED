# RARE Android APK — reproducible build

RARE packages a web build inside a native Android WebView shell (`com.rare.ai.intelligence`). The build is source-first and does not use an existing APK as input.

## Toolchain

- Node.js 20.19 or later.
- Java JDK. CI uses JDK 17; the available Android Studio JBR on the development laptop is JDK 25.
- Android SDK platform and build-tools. `scripts/build_apk.sh` discovers the highest installed platform/build-tools unless `ANDROID_COMPILE_SDK`, `ANDROID_JAR`, or `ANDROID_BUILD_TOOLS` is specified.
- Git Bash on Windows or Bash on Linux/macOS. Windows tool launchers are handled explicitly.

The CI workflow pins Android platform 34/build-tools 34.0.0 for reproducible packaging and uses a separate API 33 (Android 13) emulator to validate installation and in-place update compatibility.

## Permanent signing identity

One stable 3072-bit RSA signing identity has been generated for RARE. Its SHA-256 certificate fingerprint is:

`92:85:A1:E7:80:3E:D7:80:91:68:E9:51:AD:09:D2:C8:51:F3:AC:21:AF:04:04:48:96:B6:82:72:05:75:2F:92`

The local keystore is stored under the gitignored `.rare/android/` directory. CI receives the keystore, alias, and passwords from encrypted repository Actions secrets. Never place passwords in source, logs, or command-line literals. The script refuses to build without the configured keystore and password.

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

## CI candidate and update check

The Android Actions job builds a fresh candidate from the checked-out source, installs it on an API 33 emulator, rebuilds from the same source with the same keystore and a larger version code, then runs `adb install -r` without uninstalling the candidate. It verifies the installed version code changes. The final APK receives signature, package metadata, cleartext policy, size, and SHA-256 checks before artifact upload.

## Current verification state

The local Android 36/JBR 25 toolchain built fresh web assets, Java, DEX, resources, and an aligned APK. The local verification intentionally stopped at signing with an invalid password, so it produced no signed release artifact. The SDK manager failed while attempting to install API 33, and the laptop has no configured AVD or connected phone. The first actual signed build and emulator update result must be taken from the feature-branch Actions run; no APK has yet been delivered by this checkpoint.
