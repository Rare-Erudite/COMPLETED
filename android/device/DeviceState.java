package com.rare.ai.intelligence;

/**
 * Process-wide device state shared by the accessibility service, the
 * notification listener and the WebView bridge.
 *
 * Kept deliberately tiny: only what the bridge must report to the web layer so
 * the assistant can tell the user the truth about what it can currently do.
 */
final class DeviceState {
    private static volatile boolean accessibility = false;
    private static volatile boolean notificationAccess = false;
    private static volatile boolean overlayGranted = false;
    private static volatile String foregroundPackage = "";
    private static volatile int notificationCount = 0;

    private DeviceState() { }

    static void setAccessibility(boolean value) { accessibility = value; }
    static boolean hasAccessibility() { return accessibility; }

    static void setNotificationAccess(boolean value) { notificationAccess = value; }
    static boolean hasNotificationAccess() { return notificationAccess; }

    static void setOverlayGranted(boolean value) { overlayGranted = value; }
    static boolean hasOverlay() { return overlayGranted; }

    static void setForegroundPackage(String value) { foregroundPackage = value == null ? "" : value; }
    static String getForegroundPackage() { return foregroundPackage; }

    static void setNotificationCount(int value) { notificationCount = value; }
    static int getNotificationCount() { return notificationCount; }
}
