package com.rare.ai.intelligence;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.webkit.JavascriptInterface;

import java.util.ArrayList;
import java.util.Locale;

/**
 * On-device speech bridge.
 *
 * The web layer already has the Web Speech API, but inside a WebView that API
 * is frequently absent or routes audio through the network. This bridge uses
 * Android's own SpeechRecognizer and TextToSpeech, which run on the device and
 * work offline when the device has an offline language pack installed.
 *
 * It reports exactly what the platform reports:
 *  - `available()` is false when SpeechRecognizer.isRecognitionAvailable() is
 *    false, with the reason.
 *  - `isOnDevice()` reflects SpeechRecognizer.isOnDeviceRecognitionAvailable()
 *    on API 31+, so the UI can say "offline" only when it really is.
 *
 * Results are delivered asynchronously through a callback the web layer
 * registers: `window.RareVoice.onResult(json)`.
 */
public class VoiceBridge {
    private static final String TAG = "RARE_VOICE";

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean ttsReady = false;

    public VoiceBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    @JavascriptInterface
    public String available() {
        boolean recognition = SpeechRecognizer.isRecognitionAvailable(context);
        boolean onDevice = false;
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            try {
                onDevice = SpeechRecognizer.isOnDeviceRecognitionAvailable(context);
            } catch (Throwable ignored) { }
        }
        RareJson json = new RareJson();
        json.beginObject();
        json.put("ok", true);
        json.put("recognition", recognition);
        json.put("onDevice", onDevice);
        json.put("tts", true);
        json.put("detail", recognition
                ? (onDevice ? "On-device speech recognition is available." : "Speech recognition is available (may use the network).")
                : "No speech recognition service is installed on this device.");
        json.endObject();
        return json.toString();
    }

    /** Starts listening. The transcript arrives via window.RareVoice.onResult. */
    @JavascriptInterface
    public String startListening(final String languageTag) {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            return fail("No speech recognition service is installed on this device.");
        }
        main.post(new Runnable() {
            @Override public void run() {
                try {
                    if (recognizer != null) {
                        recognizer.destroy();
                        recognizer = null;
                    }
                    recognizer = SpeechRecognizer.createSpeechRecognizer(context);
                    recognizer.setRecognitionListener(new RecognitionListener() {
                        @Override public void onReadyForSpeech(Bundle params) { emit("ready", "", false); }
                        @Override public void onBeginningOfSpeech() { emit("speech_start", "", false); }
                        @Override public void onRmsChanged(float rmsdB) { }
                        @Override public void onBufferReceived(byte[] buffer) { }
                        @Override public void onEndOfSpeech() { emit("speech_end", "", false); }
                        @Override public void onError(int error) { emit("error", errorMessage(error), true); }
                        @Override public void onResults(Bundle results) {
                            ArrayList<String> matches = results == null ? null
                                    : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                            String text = matches != null && !matches.isEmpty() ? matches.get(0) : "";
                            emit("result", text, false);
                        }
                        @Override public void onPartialResults(Bundle partialResults) {
                            ArrayList<String> matches = partialResults == null ? null
                                    : partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                            if (matches != null && !matches.isEmpty()) emit("partial", matches.get(0), false);
                        }
                        @Override public void onEvent(int eventType, Bundle params) { }
                    });
                    Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag == null ? Locale.getDefault().toLanguageTag() : languageTag);
                    intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                    intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                    recognizer.startListening(intent);
                } catch (Throwable error) {
                    Log.w(TAG, "startListening failed: " + error.getMessage());
                    emit("error", "Could not start speech recognition: " + error.getMessage(), true);
                }
            }
        });
        return ok("Listening");
    }

    @JavascriptInterface
    public String stopListening() {
        main.post(new Runnable() {
            @Override public void run() {
                try {
                    if (recognizer != null) recognizer.stopListening();
                } catch (Throwable ignored) { }
            }
        });
        return ok("Stopped");
    }

    /** Speaks text with the device's own TTS engine. */
    @JavascriptInterface
    public String speak(final String text) {
        if (text == null || text.trim().isEmpty()) return fail("Nothing to speak.");
        main.post(new Runnable() {
            @Override public void run() {
                try {
                    if (tts == null) {
                        tts = new TextToSpeech(context, new TextToSpeech.OnInitListener() {
                            @Override public void onInit(int status) {
                                ttsReady = status == TextToSpeech.SUCCESS;
                                if (ttsReady) {
                                    tts.setLanguage(Locale.getDefault());
                                    tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "rare");
                                }
                            }
                        });
                    } else if (ttsReady) {
                        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "rare");
                    }
                } catch (Throwable error) {
                    Log.w(TAG, "speak failed: " + error.getMessage());
                }
            }
        });
        return ok("Speaking");
    }

    @JavascriptInterface
    public String stopSpeaking() {
        main.post(new Runnable() {
            @Override public void run() {
                try {
                    if (tts != null) tts.stop();
                } catch (Throwable ignored) { }
            }
        });
        return ok("Stopped");
    }

    private void emit(String type, String text, boolean isError) {
        final String payload;
        RareJson json = new RareJson();
        json.beginObject();
        json.put("type", type);
        json.put("text", text == null ? "" : text);
        json.put("error", isError);
        json.endObject();
        payload = json.toString();
        main.post(new Runnable() {
            @Override public void run() {
                try {
                    if (MainActivity.currentWebView != null) {
                        MainActivity.currentWebView.evaluateJavascript(
                                "window.RareVoice && window.RareVoice.onResult && window.RareVoice.onResult(" + quote(payload) + ");",
                                null);
                    }
                } catch (Throwable error) {
                    Log.w(TAG, "emit failed: " + error.getMessage());
                }
            }
        });
    }

    private static String quote(String value) {
        return "\"" + RareJson.escape(value) + "\"";
    }

    private static String errorMessage(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO: return "Audio recording error.";
            case SpeechRecognizer.ERROR_CLIENT: return "Client side error.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Microphone permission is not granted.";
            case SpeechRecognizer.ERROR_NETWORK: return "Network error.";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "Network timeout.";
            case SpeechRecognizer.ERROR_NO_MATCH: return "No speech was recognised.";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "The recogniser is busy.";
            case SpeechRecognizer.ERROR_SERVER: return "Recognition server error.";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "No speech was detected.";
            default: return "Speech recognition error " + error + ".";
        }
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
