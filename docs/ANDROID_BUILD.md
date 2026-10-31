# RARE Android APK — reproducible build

The Android client is a WebView shell (`com.rare.ai.intelligence`) that packages
the built web app into `assets/www/` and serves it from a virtual
`https://rare.local` origin, forwarding `/api/*` to the configured backend.

## Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| JDK | 17 (`openjdk-17-jdk-headless`) | `keytool`, `apksigner` |
| Android SDK platform | `platforms;android-34` | provides `android.jar` |
| Android build-tools | `34.0.0` | provides `d8`, `aapt`, `zipalign`, `apksigner` |
| ECJ | Debian `ecj` package | compiles the Java sources |
| Node.js | 20.x | builds the web bundle |

Install the SDK pieces:

```bash
export ANDROID_HOME=/path/to/android-sdk
sdkmanager "platforms;android-34" "build-tools;34.0.0"
```

## Signing identity (required)

Android will not install an update signed by a different key than the installed
app, so the release keystore must be **stable and preserved**.

```bash
export RARE_ANDROID_KEYSTORE=.rare/android/rare-release.keystore
export RARE_ANDROID_KEY_ALIAS=rarekey
export RARE_ANDROID_STORE_PASS=...   # never commit
```

`.rare/android/` and `*.keystore` are gitignored. The build **fails** if the
keystore or password is missing rather than minting a new identity.

## Backend URL (required)

```bash
export RARE_BACKEND_URL=https://rareproject.vercel.app
```

The build injects `window.__RARE_BACKEND_URL__` into `dist/index.html` before
packaging. It refuses to build with an empty or `localhost` URL, because a
shipped APK that cannot reach a server is not a working app.

## Build

```bash
npm ci
bash scripts/build_apk.sh
```

Output: `exports/rare-v1.0.0-release.apk` (also copied to `public/` and `dist/`).

## Verify the artifact

```bash
sha256sum exports/rare-v1.0.0-release.apk
apksigner verify --print-certs exports/rare-v1.0.0-release.apk
unzip -p exports/rare-v1.0.0-release.apk assets/www/index.html | grep __RARE_BACKEND_URL__
```

## Update compatibility

`GET /api/updates/check?clientVersion=1.0.0` returns the latest published
release for the requested channel. A release is only accepted by
`UpdateStore.publish` when it points at a GitHub Releases URL under
`Rare-Erudite/COMPLETED`, carries a byte size and a SHA-256 checksum.

**Device-level verification is still required**: installing the APK on a
physical or emulated Android device, confirming the WebView loads the deployed
backend, and confirming an in-place update over a previous install. That has not
been performed in this environment (no device/emulator available).
