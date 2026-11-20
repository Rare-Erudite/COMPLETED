package com.rare.ai.intelligence;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.webkit.JavascriptInterface;

/**
 * JavaScript bridge for the wake-word service, exposed as `window.RareWake`.
 *
 * The web layer can start/stop the foreground wake-word service and read its
 * real state. It never reports "listening" unless the service is actually
 * running, and it states the platform limits (locked screen, force-stop) rather
 * than implying always-on detection.
 */
public class WakeWordBridge {
    private final Context context;

    public WakeWordBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    @JavascriptInterface
    public String status() {
        boolean running = RareWakeWordService.isRunning();
        String detail = running
                ? RareWakeWordService.status()
                : "The wake-word service is not running.";
        return "{\"ok\":true,\"running\":" + running + ",\"detail\":\"" + escape(detail) + "\"}";
    }

    @JavascriptInterface
    public String start() {
        try {
            Intent intent = new Intent(context, RareWakeWordService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            return "{\"ok\":true,\"message\":\"Wake-word service starting.\"}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + escape(e.getMessage()) + "\"}";
        }
    }

    @JavascriptInterface
    public String stop() {
        try {
            context.stopService(new Intent(context, RareWakeWordService.class));
            return "{\"ok\":true,\"message\":\"Wake-word service stopped.\"}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + escape(e.getMessage()) + "\"}";
        }
    }

    private static String escape(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
    }
}
