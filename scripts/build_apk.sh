#!/bin/bash
set -e

PROJECT_ROOT="$(pwd)"

echo "=== [1/8] Building Web Production Assets with Vite ==="
npm run build:web

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

cat << 'EOF' > "$BUILD_DIR/AndroidManifest.xml"
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.rare.ai.intelligence"
    android:versionCode="1"
    android:versionName="1.0.0">

    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.VIBRATE" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:hardwareAccelerated="true"
        android:usesCleartextTraffic="true">

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
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String TAG = "RARE_APP";
    private static final String APP_SCHEME_HOST = "https://rare.local";
    private WebView mWebView;
    private FrameLayout mRootLayout;
    private LinearLayout mSplashLayout;
    private ProgressBar mProgressBar;
    private TextView mStatusText;
    private boolean mHasLoadedSuccessfully = false;
    private Handler mHandler = new Handler(Looper.getMainLooper());

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
            public void onPermissionRequest(final PermissionRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    request.grant(request.getResources());
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

        // API Requests: Never return index.html for API endpoints!
        if (path.startsWith("api/")) {
            String jsonErr = "{\"offline\":true,\"message\":\"Local offline mode active. Configure Cloud Backend URL in Settings for remote sync.\"}";
            byte[] errBytes = jsonErr.getBytes();
            InputStream is = new ByteArrayInputStream(errBytes);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                return new WebResourceResponse("application/json", "UTF-8", 503, "Offline", headers, is);
            } else {
                return new WebResourceResponse("application/json", "UTF-8", is);
            }
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

ANDROID_JAR="/usr/lib/android-sdk/platforms/android-23/android.jar"

echo "=== [5/8] Generating R.java with AAPT ==="
aapt package -m -J "$BUILD_DIR/src" \
  -M "$BUILD_DIR/AndroidManifest.xml" \
  -S "$BUILD_DIR/res" \
  -I "$ANDROID_JAR"

echo "=== [6/8] Compiling Java Bytecode with ECJ ==="
ecj -proc:none -cp "$ANDROID_JAR" -source 1.8 -target 1.8 -d "$BUILD_DIR/bin/classes" \
  "$BUILD_DIR/src/com/rare/ai/intelligence/R.java" \
  "$BUILD_DIR/src/com/rare/ai/intelligence/MainActivity.java"

echo "=== [7/8] Converting Bytecode to Dalvik classes.dex ==="
dalvik-exchange --dex --output="$BUILD_DIR/bin/classes.dex" "$BUILD_DIR/bin/classes"

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
KEYSTORE="/tmp/rare_release.keystore"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkey -v -keystore "$KEYSTORE" -alias rarekey -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass androidrare -keypass androidrare \
    -dname "CN=RARE Intelligence, OU=Mobile, O=RARE Core, L=Global, S=Global, C=US"
fi

apksigner sign --ks "$KEYSTORE" --ks-pass pass:androidrare --key-pass pass:androidrare \
  --ks-key-alias rarekey --out "$BUILD_DIR/bin/rare-v1.0.0-release.apk" "$BUILD_DIR/bin/aligned.apk"

echo "=== Verifying APK Signature Schemes ==="
apksigner verify --verbose "$BUILD_DIR/bin/rare-v1.0.0-release.apk"

# Export APK to standard release locations
mkdir -p "$PROJECT_ROOT/exports" "$PROJECT_ROOT/public" "$PROJECT_ROOT/dist"
cp "$BUILD_DIR/bin/rare-v1.0.0-release.apk" "$PROJECT_ROOT/exports/rare-v1.0.0-release.apk"
cp "$BUILD_DIR/bin/rare-v1.0.0-release.apk" "$PROJECT_ROOT/public/rare-v1.0.0-release.apk"
cp "$BUILD_DIR/bin/rare-v1.0.0-release.apk" "$PROJECT_ROOT/dist/rare-v1.0.0-release.apk" 2>/dev/null || true

echo "=== Android APK Successfully Created and Exported! ==="
ls -lh "$PROJECT_ROOT/exports/rare-v1.0.0-release.apk"
