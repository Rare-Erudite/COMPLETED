package com.rare.ai.intelligence;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.accessibilityservice.GestureDescription;
import android.content.Intent;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

/**
 * RARE device-control service.
 *
 * This is the layer that lets the assistant actually operate the phone: read
 * the screen, tap, type, scroll, navigate and launch apps. It is a standard
 * Android AccessibilityService — the only mechanism a non-root app has for
 * driving other apps, and the same mechanism every "phone agent" product uses.
 *
 * Architecture (adapted from the accessibility-service pattern in
 * KnifeLemon/Droidline, MIT, and imoonkey/closepaw, MIT — see
 * docs/DEVICE_LAYER.md for the attribution and what was changed):
 *
 *   WebView  --JS bridge-->  DeviceBridge  --static call-->  RareAccessibilityService
 *                                                                  |
 *                                                          AccessibilityNodeInfo tree
 *                                                                  |
 *                                                          dispatchGesture / performAction
 *
 * Design rules kept from RARE's existing code:
 *  - Nothing is reported as done unless the platform call returned success.
 *  - Every action is bounded (depth, node count, gesture timeout) so a hostile
 *    or broken screen cannot hang the service.
 *  - The service never reads password fields: nodes flagged
 *    isPassword() are redacted before they leave the process.
 */
public class RareAccessibilityService extends AccessibilityService {
    private static final String TAG = "RARE_DEVICE";
    private static final int MAX_DEPTH = 40;
    private static final int MAX_NODES = 1200;

    private static volatile RareAccessibilityService instance;

    /** True when the user has enabled RARE in Settings > Accessibility. */
    public static boolean isConnected() {
        return instance != null;
    }

    public static RareAccessibilityService get() {
        return instance;
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        AccessibilityServiceInfo info = new AccessibilityServiceInfo();
        info.eventTypes = AccessibilityEvent.TYPES_ALL_MASK;
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
        info.flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
                | AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
                | AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
        info.notificationTimeout = 50;
        setServiceInfo(info);
        Log.i(TAG, "Accessibility service connected");
        DeviceState.setAccessibility(true);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        try {
            CharSequence pkg = event.getPackageName();
            if (pkg != null) DeviceState.setForegroundPackage(pkg.toString());
        } catch (Throwable ignored) {
            // A malformed event must never take the service down.
        }
    }

    @Override
    public void onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted");
    }

    @Override
    public boolean onUnbind(Intent intent) {
        instance = null;
        DeviceState.setAccessibility(false);
        return super.onUnbind(intent);
    }

    // ------------------------------------------------------------------
    // Screen reading
    // ------------------------------------------------------------------

    /**
     * Serialises the current screen into a compact JSON tree.
     *
     * Each node carries the fields an agent needs to decide what to do:
     * text, content description, view id, class, bounds, and the flags that
     * say whether it can be clicked / edited / scrolled. Password fields are
     * redacted. The tree is capped so a pathological screen cannot exhaust
     * memory.
     */
    public String describeScreen() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        RareJson json = new RareJson();
        json.beginObject();
        json.put("ok", root != null);
        json.put("package", DeviceState.getForegroundPackage());
        if (root == null) {
            json.put("error", "No active window. The screen may be locked or the service may have just started.");
            json.endObject();
            return json.toString();
        }
        int[] budget = new int[]{MAX_NODES};
        json.put("nodeCount", countNodes(root, 0, budget));
        json.put("tree", nodeToJson(root, 0, new int[]{MAX_NODES}));
        json.endObject();
        return json.toString();
    }

    private int countNodes(AccessibilityNodeInfo node, int depth, int[] budget) {
        if (node == null || depth > MAX_DEPTH || budget[0] <= 0) return 0;
        budget[0]--;
        int total = 1;
        for (int i = 0; i < node.getChildCount(); i++) {
            total += countNodes(node.getChild(i), depth + 1, budget);
        }
        return total;
    }

    private String nodeToJson(AccessibilityNodeInfo node, int depth, int[] budget) {
        if (node == null || depth > MAX_DEPTH || budget[0] <= 0) return "null";
        budget[0]--;
        RareJson json = new RareJson();
        json.beginObject();

        boolean password = false;
        try { password = node.isPassword(); } catch (Throwable ignored) { }

        CharSequence text = node.getText();
        CharSequence desc = node.getContentDescription();
        String viewId = node.getViewIdResourceName();

        json.put("text", password ? "[redacted]" : (text == null ? "" : text.toString()));
        json.put("desc", password ? "[redacted]" : (desc == null ? "" : desc.toString()));
        json.put("id", viewId == null ? "" : viewId);
        json.put("class", node.getClassName() == null ? "" : node.getClassName().toString());
        json.put("clickable", node.isClickable());
        json.put("editable", node.isEditable());
        json.put("scrollable", node.isScrollable());
        json.put("enabled", node.isEnabled());
        json.put("checked", node.isCheckable() && node.isChecked());
        json.put("password", password);

        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        json.put("x", bounds.left);
        json.put("y", bounds.top);
        json.put("w", bounds.width());
        json.put("h", bounds.height());

        json.put("children", childArray(node, depth, budget));
        json.endObject();
        return json.toString();
    }

    private String childArray(AccessibilityNodeInfo node, int depth, int[] budget) {
        RareJson arr = new RareJson();
        arr.beginArray();
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            if (budget[0] <= 0) break;
            arr.value(nodeToJson(node.getChild(i), depth + 1, budget));
        }
        arr.endArray();
        return arr.toString();
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    /** Finds the first node whose text/description/id matches, breadth-first. */
    private AccessibilityNodeInfo findNode(String needle, boolean byId) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || needle == null || needle.isEmpty()) return null;
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < MAX_NODES) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            if (node == null) continue;
            if (byId) {
                String id = node.getViewIdResourceName();
                if (id != null && id.equals(needle)) return node;
            } else {
                CharSequence text = node.getText();
                CharSequence desc = node.getContentDescription();
                if ((text != null && text.toString().equalsIgnoreCase(needle))
                        || (desc != null && desc.toString().equalsIgnoreCase(needle))) {
                    return node;
                }
            }
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return null;
    }

    /** Clicks a node by exact text, content description or view id. */
    public boolean clickByText(String text) {
        AccessibilityNodeInfo node = findNode(text, false);
        return clickNode(node);
    }

    public boolean clickById(String viewId) {
        AccessibilityNodeInfo node = findNode(viewId, true);
        return clickNode(node);
    }

    private boolean clickNode(AccessibilityNodeInfo node) {
        if (node == null) return false;
        AccessibilityNodeInfo target = node;
        // Walk up to the nearest clickable ancestor: many apps put the label on
        // a TextView inside a clickable container.
        for (int i = 0; i < 6 && target != null; i++) {
            if (target.isClickable()) {
                return target.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            }
            target = target.getParent();
        }
        return false;
    }

    /** Types into the focused editable field, or the first editable node. */
    public boolean setText(String text) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo target = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (target == null || !target.isEditable()) {
            target = firstEditable(root, 0);
        }
        if (target == null) return false;
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        return target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
    }

    private AccessibilityNodeInfo firstEditable(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > MAX_DEPTH) return null;
        if (node.isEditable() && node.isEnabled()) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo found = firstEditable(node.getChild(i), depth + 1);
            if (found != null) return found;
        }
        return null;
    }

    /** Scrolls the first scrollable node in the given direction. */
    public boolean scroll(String direction) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo target = firstScrollable(root, 0);
        if (target == null) return false;
        int action;
        switch (direction == null ? "down" : direction) {
            case "up": action = AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD; break;
            case "left": action = AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD; break;
            case "right": action = AccessibilityNodeInfo.ACTION_SCROLL_FORWARD; break;
            default: action = AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;
        }
        return target.performAction(action);
    }

    private AccessibilityNodeInfo firstScrollable(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > MAX_DEPTH) return null;
        if (node.isScrollable()) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo found = firstScrollable(node.getChild(i), depth + 1);
            if (found != null) return found;
        }
        return null;
    }

    /** Global navigation actions. */
    public boolean globalAction(String name) {
        int action;
        switch (name == null ? "" : name) {
            case "back": action = GLOBAL_ACTION_BACK; break;
            case "home": action = GLOBAL_ACTION_HOME; break;
            case "recents": action = GLOBAL_ACTION_RECENTS; break;
            case "notifications": action = GLOBAL_ACTION_NOTIFICATIONS; break;
            case "quick_settings": action = GLOBAL_ACTION_QUICK_SETTINGS; break;
            case "lock": action = GLOBAL_ACTION_LOCK_SCREEN; break;
            default: return false;
        }
        return performGlobalAction(action);
    }

    /**
     * Taps an absolute screen coordinate with a real gesture.
     * Used when a node is not exposed (canvas-drawn UI, games, some WebViews).
     */
    public boolean tapAt(int x, int y) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription.StrokeDescription stroke =
                new GestureDescription.StrokeDescription(path, 0, 60);
        GestureDescription gesture = new GestureDescription.Builder().addStroke(stroke).build();
        return dispatchGesture(gesture, null, null);
    }

    /** Swipes from one point to another. */
    public boolean swipe(int x1, int y1, int x2, int y2, int durationMs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        Path path = new Path();
        path.moveTo(x1, y1);
        path.lineTo(x2, y2);
        GestureDescription.StrokeDescription stroke =
                new GestureDescription.StrokeDescription(path, 0, Math.max(50, durationMs));
        GestureDescription gesture = new GestureDescription.Builder().addStroke(stroke).build();
        return dispatchGesture(gesture, null, null);
    }

    /** Launches an app by package name. */
    public boolean openApp(String packageName) {
        try {
            Intent intent = getPackageManager().getLaunchIntentForPackage(packageName);
            if (intent == null) return false;
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            return true;
        } catch (Throwable error) {
            Log.w(TAG, "openApp failed: " + error.getMessage());
            return false;
        }
    }

    /** Lists launchable packages so the assistant can pick a target. */
    public String listApps() {
        List<String> names = new ArrayList<>();
        try {
            Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            for (android.content.pm.ResolveInfo info : getPackageManager().queryIntentActivities(launcher, 0)) {
                String pkg = info.activityInfo.packageName;
                if (!names.contains(pkg)) names.add(pkg);
            }
        } catch (Throwable error) {
            Log.w(TAG, "listApps failed: " + error.getMessage());
        }
        RareJson arr = new RareJson();
        arr.beginArray();
        for (String name : names) arr.value(name);
        arr.endArray();
        return arr.toString();
    }
}
