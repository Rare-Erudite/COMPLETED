package com.rare.ai.intelligence;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;

import org.vosk.Model;
import org.vosk.Recognizer;

import java.util.Locale;

/**
 * RARE — Vosk offline hotword engine.
 *
 * Runs the Apache-2.0 Vosk recogniser entirely on the device: it opens the
 * microphone, streams 16 kHz mono PCM into a Vosk Recognizer, and looks for the
 * wake phrase in each partial result. No network is used at any point.
 *
 * This class is only constructed when the model has been downloaded and passes
 * VoskModelManager.isModelReady(). If the model is absent, or the native library
 * cannot load, construction throws and the caller keeps using Android's
 * SpeechRecognizer — the engine is optional, never required.
 *
 * Honest limits (also stated in the UI):
 *  - It is a foreground service with a persistent notification, not a low-power
 *    always-on DSP. It costs battery and Android may throttle it.
 *  - It does not run when the phone is locked or the app is force-stopped.
 *  - The small model is accurate for the wake phrase but is not a dictation
 *    model; it is used only to detect "hey rae".
 */
public final class VoskWakeEngine {
    private static final String TAG = "RARE_VOSK";
    private static final int SAMPLE_RATE = 16000;

    private final Model model;
    private final Recognizer recognizer;
    private AudioRecord recorder;
    private Thread thread;
    private volatile boolean running = false;

    public interface Listener {
        /** Called with the recognised text when the wake phrase is heard. */
        void onWakePhrase(String transcript);
        /** Called when the engine stops because of an error. */
        void onError(String message);
    }

    public VoskWakeEngine(Context context) throws Exception {
        if (!VoskModelManager.isModelReady(context)) {
            throw new IllegalStateException("The Vosk model is not installed.");
        }
        // Model(String) loads the native library and the acoustic model.
        this.model = new Model(VoskModelManager.modelDir(context).getAbsolutePath());
        this.recognizer = new Recognizer(model, SAMPLE_RATE);
        // Only the wake phrase matters; a grammar keeps it fast and accurate.
        this.recognizer.setGrammar("[\"hey rae\", \"hey ray\", \"hi rae\", \"ok rae\", \"[unk]\"]");
    }

    /** True when the wake phrase appears in a transcript. Mirrors the online matcher. */
    public static boolean matchesWakePhrase(String text) {
        if (text == null) return false;
        String normalized = text.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z ]", " ")
                .replaceAll("\\s+", " ")
                .trim();
        return normalized.contains("hey rae")
                || normalized.contains("hey ray")
                || normalized.contains("hey rare")
                || normalized.contains("hi rae")
                || normalized.contains("ok rae");
    }

    public synchronized void start(final Listener listener) {
        if (running) return;
        running = true;
        thread = new Thread(new Runnable() {
            @Override
            public void run() {
                loop(listener);
            }
        }, "rare-vosk-wake");
        thread.start();
    }

    private void loop(Listener listener) {
        int minBuffer = AudioRecord.getMinBufferSize(
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        int bufferSize = Math.max(minBuffer, SAMPLE_RATE); // at least ~0.5s
        try {
            recorder = new AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize * 2);
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                throw new IllegalStateException("The microphone could not be opened.");
            }
            recorder.startRecording();
            byte[] buffer = new byte[bufferSize];
            while (running) {
                int read = recorder.read(buffer, 0, buffer.length);
                if (read <= 0) continue;
                if (recognizer.acceptWaveForm(buffer, read)) {
                    String result = recognizer.getResult();
                    if (matchesWakePhrase(result)) {
                        listener.onWakePhrase(result);
                        // Reset so the same phrase is not reported twice.
                        recognizer.reset();
                    }
                } else {
                    String partial = recognizer.getPartialResult();
                    if (matchesWakePhrase(partial)) {
                        listener.onWakePhrase(partial);
                        recognizer.reset();
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Vosk engine stopped: " + e.getMessage());
            if (running) listener.onError(e.getMessage() == null ? "Vosk engine error" : e.getMessage());
        } finally {
            releaseRecorder();
        }
    }

    public synchronized void stop() {
        running = false;
        releaseRecorder();
        if (thread != null) {
            try {
                thread.join(1500);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            thread = null;
        }
    }

    private void releaseRecorder() {
        if (recorder != null) {
            try {
                if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    recorder.stop();
                }
            } catch (Exception ignored) {
            }
            try {
                recorder.release();
            } catch (Exception ignored) {
            }
            recorder = null;
        }
    }

    public synchronized void close() {
        stop();
        try {
            recognizer.close();
        } catch (Exception ignored) {
        }
        try {
            model.close();
        } catch (Exception ignored) {
        }
    }
}
