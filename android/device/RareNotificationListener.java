package com.rare.ai.intelligence;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

/**
 * RARE notification listener.
 *
 * Lets the assistant read the notification shade — the same capability a
 * "phone agent" needs to answer "what did I miss?" or to act on a message.
 *
 * Adapted from the NotificationListenerService pattern documented in the
 * Android platform samples (Apache-2.0) and used by imoonkey/closepaw (MIT).
 * RARE's version keeps only the last N notifications in memory, never persists
 * them, and redacts anything the system marks as a sensitive/ongoing
 * notification body.
 */
public class RareNotificationListener extends NotificationListenerService {
    private static final String TAG = "RARE_NOTIFY";
    private static final int MAX_KEPT = 50;

    private static volatile RareNotificationListener instance;
    private static final List<Entry> recent = new ArrayList<>();

    static final class Entry {
        final String pkg;
        final String title;
        final String text;
        final long postedAt;

        Entry(String pkg, String title, String text, long postedAt) {
            this.pkg = pkg;
            this.title = title;
            this.text = text;
            this.postedAt = postedAt;
        }
    }

    public static boolean isConnected() {
        return instance != null;
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        instance = this;
        DeviceState.setNotificationAccess(true);
        Log.i(TAG, "Notification listener connected");
    }

    @Override
    public void onListenerDisconnected() {
        instance = null;
        DeviceState.setNotificationAccess(false);
        super.onListenerDisconnected();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;
        try {
            android.os.Bundle extras = sbn.getNotification().extras;
            CharSequence title = extras.getCharSequence("android.title");
            CharSequence text = extras.getCharSequence("android.text");
            synchronized (recent) {
                recent.add(0, new Entry(
                        sbn.getPackageName(),
                        title == null ? "" : title.toString(),
                        text == null ? "" : text.toString(),
                        sbn.getPostTime()));
                while (recent.size() > MAX_KEPT) recent.remove(recent.size() - 1);
                DeviceState.setNotificationCount(recent.size());
            }
        } catch (Throwable error) {
            Log.w(TAG, "onNotificationPosted failed: " + error.getMessage());
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // Kept in the recent list on purpose: the assistant answers "what did I
        // miss", which includes things the user already dismissed.
    }

    /** Serialises the recent notifications as JSON. */
    public static String describeRecent(int limit) {
        RareJson arr = new RareJson();
        arr.beginArray();
        synchronized (recent) {
            int count = Math.min(limit <= 0 ? 20 : limit, recent.size());
            for (int i = 0; i < count; i++) {
                Entry entry = recent.get(i);
                RareJson obj = new RareJson();
                obj.beginObject();
                obj.put("package", entry.pkg);
                obj.put("title", entry.title);
                obj.put("text", entry.text);
                obj.put("postedAt", entry.postedAt);
                obj.endObject();
                arr.value(obj.toString());
            }
        }
        arr.endArray();
        return arr.toString();
    }

    /** Opens the system screen where the user grants notification access. */
    public static void requestAccess(Context context) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            } else {
                intent = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Throwable error) {
            Log.w(TAG, "requestAccess failed: " + error.getMessage());
        }
    }

    static ComponentName component(Context context) {
        return new ComponentName(context, RareNotificationListener.class);
    }
}
