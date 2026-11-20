package com.rare.ai.intelligence;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import java.util.ArrayList;
import java.util.Locale;

/**
 * RARE wake-word service ("Hey Rae").
 *
 * A foreground service that keeps a SpeechRecognizer listening in short cycles
 * and looks for the wake phrase in each partial/final transcript. When it hears
 * the phrase it broadcasts an intent the app turns into an assistant turn.
 *
 * Honest limitations, stated in the UI as well as here:
 *  - This uses Android's own SpeechRecognizer. On most devices that recogniser
 *    is network-backed, so wake detection needs connectivity unless the device
 *    has an offline language pack installed.
 *  - It is a foreground service with a persistent notification, not a
 *    low-power always-on DSP. It costs battery and Android may throttle it.
 *  - It does NOT work when the phone is locked or the app is force-stopped;
 *    Android does not permit continuous microphone capture in those states.
 *
 * The service never claims to have heard the phrase unless the recogniser
 * actually returned it.
 */
public class RareWakeWordService extends Service {
    private static final String TAG = "RARE_WAKE";
    private static final String CHANNEL_ID = "rare_wake_word";
    private static final int NOTIFICATION_ID = 4202;
    public static final String ACTION_WAKE = "com.rare.ai.intelligence.WAKE_DETECTED";

    private static volatile boolean running = false;
    private static volatile String lastStatus = "stopped";

    private SpeechRecognizer recognizer;
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean listening = false;
    private boolean destroyed = false;

    public static boolean isRunning() {
        return running;
    }

    public static String status() {
        return lastStatus;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        destroyed = false;
        createChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        lastStatus = "starting";
        startCycle();
        Log.i(TAG, "Wake-word service started");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        running = false;
        lastStatus = "stopped";
        stopRecognizer();
        Log.i(TAG, "Wake-word service stopped");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void startCycle() {
        if (destroyed) return;
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            lastStatus = "unavailable: no speech recogniser on this device";
            Log.w(TAG, lastStatus);
            return;
        }
        main.post(() -> {
            try {
                if (recognizer == null) {
                    recognizer = SpeechRecognizer.createSpeechRecognizer(this);
                    recognizer.setRecognitionListener(listener);
                }
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toString());
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
                listening = true;
                lastStatus = "listening";
                recognizer.startListening(intent);
            } catch (Exception e) {
                lastStatus = "error: " + e.getMessage();
                Log.e(TAG, "Could not start listening", e);
                scheduleRestart(3000);
            }
        });
    }

    private void stopRecognizer() {
        main.post(() -> {
            try {
                if (recognizer != null) {
                    recognizer.cancel();
                    recognizer.destroy();
                    recognizer = null;
                }
            } catch (Exception ignored) {
            }
            listening = false;
        });
    }

    private void scheduleRestart(long delayMs) {
        if (destroyed) return;
        main.postDelayed(this::startCycle, delayMs);
    }

    /** True when the transcript contains the wake phrase. */
    static boolean matchesWakePhrase(String text) {
        if (text == null) return false;
        String normalized = text.toLowerCase(Locale.ROOT).replaceAll("[^a-z ]", " ").replaceAll("\\s+", " ").trim();
        return normalized.contains("hey rae")
                || normalized.contains("hey ray")
                || normalized.contains("hey rare")
                || normalized.contains("hi rae")
                || normalized.contains("ok rae");
    }

    private void onHeard(String text) {
        lastStatus = "wake phrase detected";
        Log.i(TAG, "Wake phrase detected: " + text);
        Intent broadcast = new Intent(ACTION_WAKE).setPackage(getPackageName());
        broadcast.putExtra("transcript", text);
        sendBroadcast(broadcast);
        // Pause briefly so the app can take over the microphone, then resume.
        stopRecognizer();
        scheduleRestart(4000);
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle params) { lastStatus = "listening"; }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }

        @Override
        public void onError(int error) {
            listening = false;
            lastStatus = "listening (retrying)";
            // Restart after a short pause; transient errors are normal.
            scheduleRestart(1500);
        }

        @Override
        public void onResults(Bundle results) {
            listening = false;
            ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (matches != null) {
                for (String match : matches) {
                    if (matchesWakePhrase(match)) {
                        onHeard(match);
                        return;
                    }
                }
            }
            scheduleRestart(300);
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            ArrayList<String> matches = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (matches != null) {
                for (String match : matches) {
                    if (matchesWakePhrase(match)) {
                        onHeard(match);
                        return;
                    }
                }
            }
        }

        @Override public void onEvent(int eventType, Bundle params) { }
    };

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "RARE wake word", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Listens for \"Hey Rae\" while RARE is running.");
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
                .setContentTitle("RARE is listening for \"Hey Rae\"")
                .setContentText("Say \"Hey Rae\" to start a request. Tap to open RARE.")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setOngoing(true)
                .build();
    }
}
