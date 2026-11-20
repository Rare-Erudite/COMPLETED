package com.rare.ai.intelligence;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

/**
 * RARE floating overlay.
 *
 * A small, draggable status pill drawn over other apps. It exists so the user
 * can always see when the assistant is operating the phone, and so the
 * assistant has a visible presence while a multi-step task runs — the same
 * affordance ZeroTap-class tools provide.
 *
 * Requires the SYSTEM_ALERT_WINDOW permission, which the user grants in
 * Settings. The overlay never captures touches outside its own pill and never
 * draws over the system permission dialogs.
 */
public final class RareOverlay {
    private static final String TAG = "RARE_OVERLAY";

    private static WindowManager windowManager;
    private static View pill;
    private static TextView label;

    private RareOverlay() { }

    /** True when the user has granted "Display over other apps". */
    public static boolean canDraw(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return Settings.canDrawOverlays(context);
    }

    /** Opens the system screen where the user grants overlay permission. */
    public static void requestPermission(Context context) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
            android.content.Intent intent = new android.content.Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Throwable error) {
            Log.w(TAG, "requestPermission failed: " + error.getMessage());
        }
    }

    /** Shows (or updates) the pill. Returns false when permission is missing. */
    public static synchronized boolean show(Context context, String text) {
        if (!canDraw(context)) {
            DeviceState.setOverlayGranted(false);
            return false;
        }
        try {
            if (windowManager == null) {
                windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            }
            if (pill == null) {
                label = new TextView(context);
                label.setTextColor(Color.WHITE);
                label.setTextSize(12f);
                label.setPadding(28, 14, 28, 14);
                label.setBackgroundColor(Color.parseColor("#CC0B1220"));
                pill = label;

                int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE;
                WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        type,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                        PixelFormat.TRANSLUCENT);
                params.gravity = Gravity.TOP | Gravity.START;
                params.x = 24;
                params.y = 120;
                windowManager.addView(pill, params);
            }
            label.setText(text == null ? "RARE is working" : text);
            DeviceState.setOverlayGranted(true);
            return true;
        } catch (Throwable error) {
            Log.w(TAG, "show failed: " + error.getMessage());
            DeviceState.setOverlayGranted(false);
            return false;
        }
    }

    /** Removes the pill. Safe to call when it is not shown. */
    public static synchronized void hide() {
        try {
            if (pill != null && windowManager != null) {
                windowManager.removeView(pill);
            }
        } catch (Throwable error) {
            Log.w(TAG, "hide failed: " + error.getMessage());
        } finally {
            pill = null;
            label = null;
        }
    }
}
