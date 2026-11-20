package com.rare.ai.intelligence;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/**
 * RARE background service.
 *
 * A foreground service that keeps the device layer alive while a multi-step
 * task runs, so the assistant is not killed the moment the user switches apps.
 * It holds no work of its own: it is a lifetime anchor for the accessibility
 * service and the notification listener, and it shows a persistent, dismissible
 * notification so the user always knows it is running.
 *
 * Android requires a foreground service to post a notification; RARE uses the
 * lowest-importance channel so it does not interrupt.
 */
public class RareDeviceService extends Service {
    private static final String TAG = "RARE_SERVICE";
    private static final String CHANNEL_ID = "rare_device_layer";
    private static final int NOTIFICATION_ID = 4201;

    private static volatile boolean running = false;

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        createChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        Log.i(TAG, "Device service started");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        Log.i(TAG, "Device service stopped");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "RARE device layer", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Keeps RARE able to operate the phone while a task runs.");
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }
        return builder
                .setContentTitle("RARE is active")
                .setContentText("The assistant can operate this device while this is shown.")
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setOngoing(true)
                .build();
    }
}
