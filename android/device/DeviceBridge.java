package com.rare.ai.intelligence;

import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * The JavaScript bridge between the RARE web layer and the Android device layer.
 *
 * Exposed to the WebView as `window.RareDevice`. Every method returns a JSON
 * string so the web layer can parse a single, uniform shape:
 *
 *   { "ok": true|false, "error": "...", "data": ... }
 *
 * Nothing here claims success it did not observe: each action returns the
 * boolean the platform call produced, and a missing permission is reported as
 * `ok:false` with the exact reason and the settings screen the user must open.
 *
 * The accessibility service is only reachable on the main thread, so every
 * call is marshalled there and awaited with a bounded latch. A hung screen can
 * therefore delay a call by at most ACTION_TIMEOUT_MS, never forever.
 */
public class DeviceBridge {
    private static final String TAG = "RARE_BRIDGE";
    private static final long ACTION_TIMEOUT_MS = 4000;

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());

    public DeviceBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    // ------------------------------------------------------------------
    // Capability reporting
    // ------------------------------------------------------------------

    /**
     * Reports exactly which device capabilities are live right now.
     * The Assistant UI renders this verbatim, so it must never overstate.
     */
    @JavascriptInterface
    public String capabilities() {
        RareJson json = new RareJson();
        json.beginObject();
        json.put("ok", true);
        json.put("platform", "android");
        json.put("sdk", android.os.Build.VERSION.SDK_INT);
        json.put("accessibility", RareAccessibilityService.isConnected());
        // Why accessibility is unavailable, when it was lost mid-session. Null
        // while connected. Lets the server report "permission revoked" instead
        // of a generic failure.
        String lostReason = RareDeviceService.getAccessibilityLostReason();
        if (lostReason != null) {
            json.put("accessibilityLostReason", lostReason);
        }
        json.put("notifications", RareNotificationListener.isConnected());
        json.put("overlay", RareOverlay.canDraw(context));
        json.put("foregroundService", RareDeviceService.isRunning());
        json.put("foregroundPackage", DeviceState.getForegroundPackage());
        json.put("notificationCount", DeviceState.getNotificationCount());
        json.endObject();
        return json.toString();
    }

    // ------------------------------------------------------------------
    // Permission requests (user-controlled, never auto-granted)
    // ------------------------------------------------------------------

    @JavascriptInterface
    public String requestAccessibility() {
        try {
            Intent intent = new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return ok("Opened Accessibility settings. Enable RARE under 'Installed services'.");
        } catch (Throwable error) {
            return fail("Could not open Accessibility settings: " + error.getMessage());
        }
    }

    @JavascriptInterface
    public String requestNotificationAccess() {
        try {
            RareNotificationListener.requestAccess(context);
            return ok("Opened Notification access settings. Enable RARE.");
        } catch (Throwable error) {
            return fail("Could not open Notification access settings: " + error.getMessage());
        }
    }

    @JavascriptInterface
    public String requestOverlay() {
        try {
            RareOverlay.requestPermission(context);
            return ok("Opened 'Display over other apps'. Enable RARE.");
        } catch (Throwable error) {
            return fail("Could not open overlay settings: " + error.getMessage());
        }
    }

    // ------------------------------------------------------------------
    // Screen reading
    // ------------------------------------------------------------------

    @JavascriptInterface
    public String describeScreen() {
        return onService("describeScreen", new ServiceCall() {
            public String run(RareAccessibilityService service) { return service.describeScreen(); }
        });
    }

    @JavascriptInterface
    public String listApps() {
        return onService("listApps", new ServiceCall() {
            public String run(RareAccessibilityService service) { return service.listApps(); }
        });
    }

    @JavascriptInterface
    public String notifications(int limit) {
        if (!RareNotificationListener.isConnected()) {
            return fail("Notification access is not granted. Call requestNotificationAccess() and enable RARE.");
        }
        RareJson json = new RareJson();
        json.beginObject();
        json.put("ok", true);
        json.put("data", RareNotificationListener.describeRecent(limit));
        json.endObject();
        return json.toString();
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    @JavascriptInterface
    public String tapText(final String text) {
        return onService("tapText", new ServiceCall() {
            public String run(RareAccessibilityService service) {
                return actionResult(service.clickByText(text), "Tapped '" + text + "'", "No clickable node matched '" + text + "'");
            }
        });
    }

    @JavascriptInterface
    public String tapId(final String viewId) {
        return onService("tapId", new ServiceCall() {
            public String run(RareAccessibilityService service) {
                return actionResult(service.clickById(viewId), "Tapped " + viewId, "No clickable node matched id " + viewId);
            }
        });
    }

    @JavascriptInterface
    public String tapAt(final int x, final int y) {
        return onService("tapAt", new ServiceCall() {
            public String run(RareAccessibilityService service) {
                return actionResult(service.tapAt(x, y), "Tapped (" + x + "," + y + ")", "Gesture dispatch was refused");
            }
        });
    }

    @JavascriptInterface
    public String swipe(final int x1, final int y1, final int x2, final int y2, final int durationMs) {
        return onService("swipe", new ServiceCall() {
            public String run(RareAccessibilityService service) {
                return actionResult(service.swipe(x1, y1, x2, y2, durationMs), "Swiped", "Gesture dispatch was refused");
            }
        });
    }

    @JavascriptInterface
    public String typeText(final String text) {
        return onService("typeText", new ServiceCall() {
            public String run(RareAccessibilityService service) {
                return actionResult(service.setText(text), "Typed into the focused field", "No editable field was focused");
            }
        });
    }

    @JavascriptInterface
    public String scroll(final String direction) {
        return onService("scroll", new ServiceCall() {
            public String run(RareAccessibilityService service) {
                return actionResult(service.scroll(direction), "Scrolled " + direction, "No scrollable node was found");
            }
        });
    }

    @JavascriptInterface
    public String globalAction(final String name) {
        return onService("globalAction", new ServiceCall() {
            public String run(RareAccessibilityService service) {
                return actionResult(service.globalAction(name), "Performed " + name, "Unknown or refused global action: " + name);
            }
        });
    }

    @JavascriptInterface
    public String openApp(final String packageName) {
        return onService("openApp", new ServiceCall() {
            public String run(RareAccessibilityService service) {
                return actionResult(service.openApp(packageName), "Launched " + packageName, "No launchable activity for " + packageName);
            }
        });
    }

    // ------------------------------------------------------------------
    // Overlay + background service
    // ------------------------------------------------------------------

    @JavascriptInterface
    public String showOverlay(final String text) {
        boolean shown = RareOverlay.show(context, text);
        return shown ? ok("Overlay shown") : fail("Overlay permission is not granted. Call requestOverlay().");
    }

    @JavascriptInterface
    public String hideOverlay() {
        RareOverlay.hide();
        return ok("Overlay hidden");
    }

    @JavascriptInterface
    public String startBackgroundService() {
        try {
            Intent intent = new Intent(context, RareDeviceService.class);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            return ok("Background service start requested");
        } catch (Throwable error) {
            return fail("Could not start the background service: " + error.getMessage());
        }
    }

    @JavascriptInterface
    public String stopBackgroundService() {
        try {
            context.stopService(new Intent(context, RareDeviceService.class));
            return ok("Background service stopped");
        } catch (Throwable error) {
            return fail("Could not stop the background service: " + error.getMessage());
        }
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private interface ServiceCall {
        String run(RareAccessibilityService service);
    }

    /**
     * Runs a call against the accessibility service on the main thread and
     * waits at most ACTION_TIMEOUT_MS. Returns a JSON error when the service is
     * not connected, so the web layer can prompt the user precisely.
     */
    private String onService(String name, final ServiceCall call) {
        final RareAccessibilityService service = RareAccessibilityService.get();
        if (service == null) {
            return fail("Accessibility service is not connected. Call requestAccessibility() and enable RARE in Settings.");
        }
        final AtomicReference<String> result = new AtomicReference<>(null);
        final CountDownLatch latch = new CountDownLatch(1);
        main.post(new Runnable() {
            @Override public void run() {
                try {
                    result.set(call.run(service));
                } catch (Throwable error) {
                    Log.w(TAG, "service call failed: " + error.getMessage());
                    result.set(fail("Device action failed: " + error.getMessage()));
                } finally {
                    latch.countDown();
                }
            }
        });
        try {
            if (!latch.await(ACTION_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                return fail("Device action '" + name + "' timed out after " + ACTION_TIMEOUT_MS + "ms");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return fail("Device action '" + name + "' was interrupted");
        }
        String value = result.get();
        return value == null ? fail("Device action '" + name + "' produced no result") : value;
    }

    private static String actionResult(boolean success, String successMessage, String failureMessage) {
        RareJson json = new RareJson();
        json.beginObject();
        json.put("ok", success);
        json.put("message", success ? successMessage : failureMessage);
        json.endObject();
        return json.toString();
    }

    private static String ok(String message) {
        RareJson json = new RareJson();
        json.beginObject();
        json.put("ok", true);
        json.put("message", message);
        json.endObject();
        return json.toString();
    }

    private static String fail(String message) {
        RareJson json = new RareJson();
        json.beginObject();
        json.put("ok", false);
        json.put("error", message);
        json.endObject();
        return json.toString();
    }
}
