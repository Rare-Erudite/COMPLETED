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
        String engine = RareWakeWordService.activeEngine();
        return "{\"ok\":true,\"running\":" + running
                + ",\"engine\":\"" + escape(engine) + "\""
                + ",\"detail\":\"" + escape(detail) + "\"}";
    }

    // -- optional offline (Vosk) engine -------------------------------------

    /**
     * Real state of the optional offline engine: whether the model is installed,
     * whether a download is in progress, and the download size in bytes.
     */
    @JavascriptInterface
    public String offlineStatus() {
        boolean ready = VoskModelManager.isModelReady(context);
        boolean downloading = VoskModelManager.isDownloading();
        int progress = VoskModelManager.progress();
        String state = VoskModelManager.status(context);
        return "{\"ok\":true"
                + ",\"ready\":" + ready
                + ",\"downloading\":" + downloading
                + ",\"progress\":" + progress
                + ",\"downloadBytes\":" + VoskModelManager.MODEL_ZIP_BYTES
                + ",\"unpackedBytes\":" + VoskModelManager.MODEL_UNPACKED_BYTES
                + ",\"modelName\":\"" + escape(VoskModelManager.MODEL_NAME) + "\""
                + ",\"licence\":\"" + escape(VoskModelManager.MODEL_LICENCE) + "\""
                + ",\"state\":\"" + escape(state) + "\"}";
    }

    /**
     * Downloads the model in the background. Returns immediately; the web layer
     * polls offlineStatus() for progress. The download is ~41 MB and is only
     * started by an explicit user action.
     */
    @JavascriptInterface
    public String downloadOfflineModel() {
        if (VoskModelManager.isModelReady(context)) {
            return "{\"ok\":true,\"message\":\"The offline model is already installed.\"}";
        }
        if (VoskModelManager.isDownloading()) {
            return "{\"ok\":true,\"message\":\"A download is already in progress.\"}";
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                VoskModelManager.download(context);
            }
        }, "rare-vosk-download").start();
        return "{\"ok\":true,\"message\":\"Downloading the offline model (~41 MB).\"}";
    }

    /** Removes the downloaded model; the wake word falls back to the online engine. */
    @JavascriptInterface
    public String deleteOfflineModel() {
        VoskModelManager.delete(context);
        return "{\"ok\":true,\"message\":\"The offline model was removed.\"}";
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
