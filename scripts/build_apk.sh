#!/bin/bash
set -e

PROJECT_ROOT="$(pwd)"

# The Android client must talk to the real RARE backend. Without an injected
# URL the WebView falls back to the virtual `rare.local` origin and every API
# call fails, so the build refuses to produce an APK that cannot reach a server.
RARE_BACKEND_URL="${RARE_BACKEND_URL:-https://rareproject.vercel.app}"
if [ -z "$RARE_BACKEND_URL" ]; then
  echo "ERROR: RARE_BACKEND_URL is empty; refusing to build an APK with no backend." >&2
  exit 1
fi
case "$RARE_BACKEND_URL" in
  http://localhost*|http://127.0.0.1*|*localhost:*)
    echo "ERROR: RARE_BACKEND_URL points at localhost ($RARE_BACKEND_URL); a shipped APK must use the deployed backend." >&2
    exit 1
    ;;
esac
echo "=== Backend for this APK: $RARE_BACKEND_URL ==="

# Version identity. Android refuses to install an update whose versionCode is
# not strictly greater than the installed one, so a hardcoded 1 makes every
# future release uninstallable over the last. Both values are overridable and
# default to a monotonically increasing value derived from the build date
# (YYMMDDnn), which is always greater than any previous calendar day.
APP_VERSION_NAME="${RARE_APP_VERSION_NAME:-1.0.0}"
if [ -n "$RARE_APP_VERSION_CODE" ]; then
  APP_VERSION_CODE="$RARE_APP_VERSION_CODE"
else
  APP_VERSION_CODE="$(date -u +%y%m%d)01"
fi
case "$APP_VERSION_CODE" in
  ''|*[!0-9]*)
    echo "ERROR: RARE_APP_VERSION_CODE must be a positive integer, got '$APP_VERSION_CODE'." >&2
    exit 1
    ;;
esac
if [ "$APP_VERSION_CODE" -lt 1 ]; then
  echo "ERROR: RARE_APP_VERSION_CODE must be >= 1, got $APP_VERSION_CODE." >&2
  exit 1
fi
echo "=== Version: ${APP_VERSION_NAME} (versionCode ${APP_VERSION_CODE}) ==="

echo "=== [1/8] Building Web Production Assets with Vite ==="
npm run build:web

# Inject the backend URL into the packaged index.html so the WebView knows which
# server to call before any JavaScript runs.
if [ -f "dist/index.html" ]; then
  python3 - "$RARE_BACKEND_URL" <<'PY'
import sys, pathlib
url = sys.argv[1]
p = pathlib.Path("dist/index.html")
html = p.read_text(encoding="utf-8")
inject = f'<script>window.__RARE_BACKEND_URL__ = {url!r};</script>'
if "__RARE_BACKEND_URL__" not in html:
    html = html.replace("</head>", f"  {inject}\n  </head>", 1)
    p.write_text(html, encoding="utf-8")
    print(f"Injected backend URL into dist/index.html: {url}")
else:
    print("Backend URL already present in dist/index.html")
PY
fi

BUILD_DIR="/tmp/android_apk_build"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/src/com/rare/ai/intelligence"
mkdir -p "$BUILD_DIR/bin/classes"
mkdir -p "$BUILD_DIR/res/values"
mkdir -p "$BUILD_DIR/res/mipmap-mdpi"
mkdir -p "$BUILD_DIR/res/mipmap-hdpi"
mkdir -p "$BUILD_DIR/res/mipmap-xhdpi"
mkdir -p "$BUILD_DIR/res/mipmap-xxhdpi"
mkdir -p "$BUILD_DIR/res/mipmap-xxxhdpi"
mkdir -p "$BUILD_DIR/assets/www"

# 2. Copy web assets to assets/www
echo "=== [2/8] Packaging Web Application Bundle ==="
cp -r dist/* "$BUILD_DIR/assets/www/"
rm -f "$BUILD_DIR/assets/www/"*.apk

# 3. Bundle Offline Knowledge Corpus & Assets
echo "=== [3/8] Packaging Knowledge Corpus and Assets ==="
python3 scripts/prepare_apk_assets.py "$BUILD_DIR/assets"

# 4. App Launcher Icons
echo "=== [4/8] Installing High-Density Launcher Icons ==="
cp public/pwa-192x192.png "$BUILD_DIR/res/mipmap-mdpi/ic_launcher.png"
cp public/pwa-192x192.png "$BUILD_DIR/res/mipmap-hdpi/ic_launcher.png"
cp public/pwa-192x192.png "$BUILD_DIR/res/mipmap-xhdpi/ic_launcher.png"
cp public/pwa-512x512.png "$BUILD_DIR/res/mipmap-xxhdpi/ic_launcher.png"
cp public/pwa-512x512.png "$BUILD_DIR/res/mipmap-xxxhdpi/ic_launcher.png"

# 5. Strings & XML
cat << 'EOF' > "$BUILD_DIR/res/values/strings.xml"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">RARE</string>
</resources>
EOF

cat << EOF > "$BUILD_DIR/AndroidManifest.xml"
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.rare.ai.intelligence"
    android:versionCode="${APP_VERSION_CODE}"
    android:versionName="${APP_VERSION_NAME}">

    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
    <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />

    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:hardwareAccelerated="true"
        android:usesCleartextTraffic="false">

        <activity
            android:name="com.rare.ai.intelligence.MainActivity"
            android:label="@string/app_name"
            android:configChanges="orientation|screenSize|keyboardHidden|screenLayout"
            android:windowSoftInputMode="adjustResize"
            android:theme="@android:style/Theme.NoTitleBar"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
EOF

## 6. Native MainActivity with Embedded Local Asset Server & Splash Screen
cat << 'EOF' > "$BUILD_DIR/src/com/rare/ai/intelligence/MainActivity.java"
package com.rare.ai.intelligence;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String TAG = "RARE_APP";
    private static final String APP_SCHEME_HOST = "https://rare.local";
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private static final int SYSTEM_PERMISSIONS_REQUEST_CODE = 2001;

    private WebView mWebView;
    private FrameLayout mRootLayout;
    private LinearLayout mSplashLayout;
    private ProgressBar mProgressBar;
    private TextView mStatusText;
    private boolean mHasLoadedSuccessfully = false;
    private Handler mHandler = new Handler(Looper.getMainLooper());
    private ValueCallback<Uri[]> mFilePathCallback = null;
    private PermissionRequest mHeldPermissionRequest = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        Window window = getWindow();
        window.setFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED, WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(Color.parseColor("#03040A"));
            window.setNavigationBarColor(Color.parseColor("#03040A"));
        }

        mRootLayout = new FrameLayout(this);
        mRootLayout.setBackgroundColor(Color.parseColor("#03040A"));

        setupWebView();
        mRootLayout.addView(mWebView);

        setupSplashScreen();
        mRootLayout.addView(mSplashLayout);

        setContentView(mRootLayout);

        // Load entry point under virtual secure domain
        mWebView.loadUrl(APP_SCHEME_HOST + "/index.html");

        // Watchdog fallback: Reveal WebView after timeout if needed
        mHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                revealWebView();
            }
        }, 5000);
    }

    private void revealWebView() {
        if (!mHasLoadedSuccessfully) {
            mHasLoadedSuccessfully = true;
            if (mWebView != null && mSplashLayout != null) {
                mSplashLayout.setVisibility(View.GONE);
                mWebView.setVisibility(View.VISIBLE);
            }
        }
    }

    private void setupWebView() {
        mWebView = new WebView(this);
        mWebView.setBackgroundColor(Color.parseColor("#03040A"));
        mWebView.setVisibility(View.INVISIBLE);

        WebSettings settings = mWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportZoom(false);

        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (mStatusText != null) {
                    mStatusText.setText("Initializing RARE Intelligence...");
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                revealWebView();
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    WebResourceResponse resp = handleAssetIntercept(request.getUrl());
                    if (resp != null) return resp;
                }
                return super.shouldInterceptRequest(view, request);
            }

            @SuppressWarnings("deprecation")
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                if (url != null) {
                    WebResourceResponse resp = handleAssetIntercept(Uri.parse(url));
                    if (resp != null) return resp;
                }
                return super.shouldInterceptRequest(view, url);
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                revealWebView();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && (url.startsWith(APP_SCHEME_HOST) || url.startsWith("file:///android_asset/"))) {
                    return false;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }
        });

        mWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                super.onProgressChanged(view, newProgress);
                if (mProgressBar != null) {
                    mProgressBar.setProgress(newProgress);
                }
                if (newProgress >= 80) {
                    revealWebView();
                }
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (mFilePathCallback != null) {
                    mFilePathCallback.onReceiveValue(null);
                    mFilePathCallback = null;
                }
                mFilePathCallback = filePathCallback;

                Intent chooserIntent = null;
                if (fileChooserParams != null) {
                    try {
                        chooserIntent = fileChooserParams.createIntent();
                    } catch (Exception ignored) {}
                }
                if (chooserIntent == null) {
                    chooserIntent = new Intent(Intent.ACTION_GET_CONTENT);
                    chooserIntent.addCategory(Intent.CATEGORY_OPENABLE);
                    chooserIntent.setType("*/*");
                }
                try {
                    startActivityForResult(chooserIntent, FILE_CHOOSER_REQUEST_CODE);
                    return true;
                } catch (Exception e) {
                    Log.e(TAG, "Cannot start system file chooser", e);
                    if (mFilePathCallback != null) {
                        mFilePathCallback.onReceiveValue(null);
                        mFilePathCallback = null;
                    }
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return;

                String[] resources = request.getResources();
                List<String> neededSysPerms = new ArrayList<String>();

                for (String r : resources) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                            checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                            neededSysPerms.add(android.Manifest.permission.RECORD_AUDIO);
                        }
                    } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                            checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                            neededSysPerms.add(android.Manifest.permission.CAMERA);
                        }
                    }
                }

                if (neededSysPerms.isEmpty()) {
                    request.grant(resources);
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    mHeldPermissionRequest = request;
                    requestPermissions(neededSysPerms.toArray(new String[0]), SYSTEM_PERMISSIONS_REQUEST_CODE);
                } else {
                    request.grant(resources);
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                Log.d(TAG, "Console [" + consoleMessage.messageLevel() + "]: " + consoleMessage.message()
                    + " (" + consoleMessage.sourceId() + ":" + consoleMessage.lineNumber() + ")");
                return super.onConsoleMessage(consoleMessage);
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (mFilePathCallback != null) {
                Uri[] results = null;
                if (resultCode == Activity.RESULT_OK && data != null) {
                    String dataString = data.getDataString();
                    if (dataString != null) {
                        results = new Uri[]{ Uri.parse(dataString) };
                    } else if (data.getClipData() != null) {
                        int numSelected = data.getClipData().getItemCount();
                        results = new Uri[numSelected];
                        for (int i = 0; i < numSelected; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    }
                }
                mFilePathCallback.onReceiveValue(results);
                mFilePathCallback = null;
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == SYSTEM_PERMISSIONS_REQUEST_CODE && mHeldPermissionRequest != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                List<String> grantedResources = new ArrayList<String>();
                for (String r : mHeldPermissionRequest.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
                            checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            grantedResources.add(r);
                        }
                    } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
                            checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                            grantedResources.add(r);
                        }
                    }
                }
                if (!grantedResources.isEmpty()) {
                    mHeldPermissionRequest.grant(grantedResources.toArray(new String[0]));
                } else {
                    mHeldPermissionRequest.deny();
                }
            }
            mHeldPermissionRequest = null;
        }
    }

    private WebResourceResponse handleAssetIntercept(Uri uri) {
        String uriStr = uri.toString();
        if (!uriStr.startsWith(APP_SCHEME_HOST)) {
            return null; // External network requests proceed normally
        }

        String path = uri.getPath();
        if (path == null || path.isEmpty() || path.equals("/")) {
            path = "/index.html";
        }
        if (path.startsWith("/")) {
            path = path.substring(1);
        }

        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
        headers.put("Access-Control-Allow-Headers", "*");
        headers.put("Cache-Control", "no-cache");

        // Allow API requests to proceed naturally to local or remote endpoints
        if (path.startsWith("api/")) {
            return null;
        }

        String assetPath = "www/" + path;
        String mime = getMimeType(assetPath);

        try {
            InputStream is = getAssets().open(assetPath);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, is);
            } else {
                return new WebResourceResponse(mime, "UTF-8", is);
            }
        } catch (IOException e) {
            // SPA fallback: ONLY for client-side HTML routes, NEVER for assets or API
            if (!assetPath.startsWith("www/assets/") && !assetPath.startsWith("www/api/")) {
                try {
                    InputStream is = getAssets().open("www/index.html");
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        return new WebResourceResponse("text/html", "UTF-8", 200, "OK", headers, is);
                    } else {
                        return new WebResourceResponse("text/html", "UTF-8", is);
                    }
                } catch (IOException ignored) {}
            }
            byte[] notFound = "Asset Not Found".getBytes();
            InputStream emptyIs = new ByteArrayInputStream(notFound);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", headers, emptyIs);
            } else {
                return new WebResourceResponse("text/plain", "UTF-8", emptyIs);
            }
        }
    }

    private static String getMimeType(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json") || lower.endsWith(".webmanifest")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    private void setupSplashScreen() {
        mSplashLayout = new LinearLayout(this);
        mSplashLayout.setOrientation(LinearLayout.VERTICAL);
        mSplashLayout.setGravity(Gravity.CENTER);
        mSplashLayout.setBackgroundColor(Color.parseColor("#03040A"));
        mSplashLayout.setLayoutParams(new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        TextView titleText = new TextView(this);
        titleText.setText("RARE");
        titleText.setTextSize(38);
        titleText.setTextColor(Color.WHITE);
        titleText.setGravity(Gravity.CENTER);
        titleText.setPadding(0, 0, 0, 8);
        mSplashLayout.addView(titleText);

        TextView subTitle = new TextView(this);
        subTitle.setText("Personal AI Core & VisionCraft");
        subTitle.setTextSize(14);
        subTitle.setTextColor(Color.parseColor("#818CF8"));
        subTitle.setGravity(Gravity.CENTER);
        subTitle.setPadding(0, 0, 0, 32);
        mSplashLayout.addView(subTitle);

        mProgressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        mProgressBar.setIndeterminate(true);
        LinearLayout.LayoutParams pbParams = new LinearLayout.LayoutParams(400, 14);
        pbParams.setMargins(0, 0, 0, 16);
        mProgressBar.setLayoutParams(pbParams);
        mSplashLayout.addView(mProgressBar);

        mStatusText = new TextView(this);
        mStatusText.setText("Loading Intelligence Core...");
        mStatusText.setTextSize(12);
        mStatusText.setTextColor(Color.parseColor("#94A3B8"));
        mStatusText.setGravity(Gravity.CENTER);
        mSplashLayout.addView(mStatusText);
    }

    @Override
    public void onBackPressed() {
        if (mWebView != null && mWebView.canGoBack()) {
            mWebView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
EOF

# Toolchain locations. ANDROID_HOME may point at a full SDK (recommended); the
# Debian-packaged build-tools are used as a fallback for aapt/zipalign/apksigner.
ANDROID_HOME="${ANDROID_HOME:-/usr/lib/android-sdk}"
ANDROID_JAR="${ANDROID_JAR:-$ANDROID_HOME/platforms/android-34/android.jar}"
if [ ! -f "$ANDROID_JAR" ]; then
  echo "ERROR: android.jar not found at $ANDROID_JAR" >&2
  echo "       Install the Android SDK platform (sdkmanager 'platforms;android-34') or set ANDROID_JAR." >&2
  exit 1
fi
D8="${D8:-$ANDROID_HOME/build-tools/34.0.0/d8}"
if [ ! -x "$D8" ]; then
  D8="$(command -v d8 || true)"
fi
if [ -z "$D8" ] || [ ! -x "$D8" ]; then
  echo "ERROR: d8 (Dalvik compiler) not found. Install Android build-tools 34.0.0." >&2
  exit 1
fi
echo "=== Toolchain: android.jar=$ANDROID_JAR d8=$D8 ==="

echo "=== [5/8] Generating R.java with AAPT ==="
aapt package -m -J "$BUILD_DIR/src" \
  -M "$BUILD_DIR/AndroidManifest.xml" \
  -S "$BUILD_DIR/res" \
  -I "$ANDROID_JAR"

echo "=== [6/8] Compiling Java Bytecode with ECJ ==="
# ecj is not part of the Android SDK and is not installed by default on CI
# runners, so resolve it explicitly and fall back to javac (which ships with the
# JDK the build already requires). Both produce Java 8 bytecode that d8 accepts.
ECJ="${ECJ:-$(command -v ecj || true)}"
if [ -n "$ECJ" ] && [ -x "$ECJ" ]; then
  "$ECJ" -proc:none -cp "$ANDROID_JAR" -source 1.8 -target 1.8 -d "$BUILD_DIR/bin/classes" \
    "$BUILD_DIR/src/com/rare/ai/intelligence/R.java" \
    "$BUILD_DIR/src/com/rare/ai/intelligence/MainActivity.java"
else
  JAVAC="${JAVAC:-$(command -v javac || true)}"
  if [ -z "$JAVAC" ]; then
    echo "ERROR: neither ecj nor javac is available; a JDK is required to compile the Android sources." >&2
    exit 1
  fi
  echo "ecj not found; using javac at $JAVAC"
  "$JAVAC" -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" \
    -d "$BUILD_DIR/bin/classes" \
    "$BUILD_DIR/src/com/rare/ai/intelligence/R.java" \
    "$BUILD_DIR/src/com/rare/ai/intelligence/MainActivity.java"
fi

echo "=== [7/8] Converting Bytecode to Dalvik classes.dex ==="
# d8 is the current Dalvik compiler; dalvik-exchange/dx are long removed from
# the Android SDK, so the previous script could not run on a modern toolchain.
"$D8" --min-api 21 --output "$BUILD_DIR/bin" \
  $(find "$BUILD_DIR/bin/classes" -name '*.class')

echo "=== [8/8] Packaging, Aligning & Signing Standalone Release APK ==="
aapt package -f \
  -M "$BUILD_DIR/AndroidManifest.xml" \
  -S "$BUILD_DIR/res" \
  -A "$BUILD_DIR/assets" \
  -I "$ANDROID_JAR" \
  -F "$BUILD_DIR/bin/unaligned.apk"

# Inject classes.dex into the APK
cd "$BUILD_DIR/bin"
aapt add unaligned.apk classes.dex

# 4-byte alignment
zipalign -v -p 4 "$BUILD_DIR/bin/unaligned.apk" "$BUILD_DIR/bin/aligned.apk"

# Keytool and Apksigner (v1 + v2 + v3)
#
# The signing identity MUST be stable: Android refuses to install an update
# signed by a different key than the installed app. The previous script created
# a fresh keystore in /tmp on every run, so every build produced a new identity
# and no update could ever be installed over an existing RARE install.
#
# The keystore is therefore read from RARE_ANDROID_KEYSTORE (default
# .rare/android/rare-release.keystore, gitignored) and its passwords from the
# environment. If no keystore exists the build FAILS rather than silently
# minting a new identity that would break update compatibility.
KEYSTORE="${RARE_ANDROID_KEYSTORE:-$PROJECT_ROOT/.rare/android/rare-release.keystore}"
KEY_ALIAS="${RARE_ANDROID_KEY_ALIAS:-rarekey}"
STORE_PASS="${RARE_ANDROID_STORE_PASS:-}"
KEY_PASS="${RARE_ANDROID_KEY_PASS:-$STORE_PASS}"

if [ ! -f "$KEYSTORE" ]; then
  echo "ERROR: release keystore not found at $KEYSTORE" >&2
  echo "       A new key would break update compatibility with installed RARE apps." >&2
  echo "       Restore the existing keystore, or set RARE_ANDROID_KEYSTORE to it." >&2
  exit 1
fi
if [ -z "$STORE_PASS" ]; then
  echo "ERROR: RARE_ANDROID_STORE_PASS is not set; cannot sign the release APK." >&2
  exit 1
fi

apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$STORE_PASS" --key-pass "pass:$KEY_PASS" \
  --ks-key-alias "$KEY_ALIAS" --out "$BUILD_DIR/bin/rare-v${APP_VERSION_NAME}-release.apk" "$BUILD_DIR/bin/aligned.apk"

echo "=== Verifying APK Signature Schemes ==="
apksigner verify --verbose "$BUILD_DIR/bin/rare-v${APP_VERSION_NAME}-release.apk"

# Record the signing certificate so update compatibility can be checked against
# the certificate of an already-installed build.
echo "=== Signing certificate (must match the installed app) ==="
apksigner verify --print-certs "$BUILD_DIR/bin/rare-v${APP_VERSION_NAME}-release.apk" | head -5

# Export APK to standard release locations
mkdir -p "$PROJECT_ROOT/exports" "$PROJECT_ROOT/public" "$PROJECT_ROOT/dist"
cp "$BUILD_DIR/bin/rare-v${APP_VERSION_NAME}-release.apk" "$PROJECT_ROOT/exports/rare-v${APP_VERSION_NAME}-release.apk"
cp "$BUILD_DIR/bin/rare-v${APP_VERSION_NAME}-release.apk" "$PROJECT_ROOT/public/rare-v${APP_VERSION_NAME}-release.apk"
cp "$BUILD_DIR/bin/rare-v${APP_VERSION_NAME}-release.apk" "$PROJECT_ROOT/dist/rare-v${APP_VERSION_NAME}-release.apk" 2>/dev/null || true

echo "=== Android APK Successfully Created and Exported! ==="
ls -lh "$PROJECT_ROOT/exports/rare-v${APP_VERSION_NAME}-release.apk"
