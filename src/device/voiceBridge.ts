/**
 * On-device voice bridge (`window.RareVoice`), injected by the Android shell.
 *
 * The web layer already uses the Web Speech API when the browser exposes it.
 * Inside the RARE WebView that API is often missing, so this module prefers the
 * native recogniser and TTS, which run on the device and can work offline.
 *
 * It never claims offline capability it has not confirmed: `available()` returns
 * the platform's own `onDevice` flag.
 */

export interface VoiceAvailability {
  ok: boolean;
  recognition: boolean;
  onDevice: boolean;
  tts: boolean;
  detail: string;
}

export interface VoiceEvent {
  type: 'ready' | 'speech_start' | 'speech_end' | 'partial' | 'result' | 'error';
  text: string;
  error: boolean;
}

interface RareVoiceBridge {
  available(): string;
  startListening(languageTag: string): string;
  stopListening(): string;
  speak(text: string): string;
  stopSpeaking(): string;
}

interface RareVoiceHost {
  onResult?: (json: string) => void;
}

function bridge(): RareVoiceBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { RareVoice?: RareVoiceBridge }).RareVoice;
  return candidate && typeof candidate.available === 'function' ? candidate : null;
}

export function isNativeVoiceAvailable(): boolean {
  return bridge() !== null;
}

export function getVoiceAvailability(): VoiceAvailability | null {
  const api = bridge();
  if (!api) return null;
  try {
    return JSON.parse(api.available()) as VoiceAvailability;
  } catch {
    return null;
  }
}

/**
 * Starts native listening and resolves with the final transcript.
 * Rejects with the platform's own error message when recognition fails.
 */
export function listenOnce(languageTag?: string): Promise<string> {
  const api = bridge();
  if (!api) return Promise.reject(new Error('Native voice is only available in the RARE Android app.'));

  return new Promise<string>((resolve, reject) => {
    const host = window as unknown as { RareVoice: RareVoiceHost };
    const previous = host.RareVoice.onResult;
    let settled = false;

    const cleanup = () => {
      host.RareVoice.onResult = previous;
    };

    host.RareVoice.onResult = (json: string) => {
      let event: VoiceEvent;
      try {
        event = JSON.parse(json) as VoiceEvent;
      } catch {
        return;
      }
      if (event.type === 'result') {
        settled = true;
        cleanup();
        resolve(event.text);
      } else if (event.type === 'error') {
        settled = true;
        cleanup();
        reject(new Error(event.text || 'Speech recognition failed.'));
      }
    };

    const started = JSON.parse(api.startListening(languageTag || (navigator.language || 'en-US'))) as {
      ok: boolean;
      error?: string;
    };
    if (!started.ok) {
      cleanup();
      reject(new Error(started.error || 'Could not start speech recognition.'));
      return;
    }

    // Safety net: never leave the promise pending forever.
    window.setTimeout(() => {
      if (!settled) {
        cleanup();
        reject(new Error('Speech recognition timed out.'));
      }
    }, 30_000);
  });
}

export function speakNative(text: string): boolean {
  const api = bridge();
  if (!api) return false;
  try {
    const result = JSON.parse(api.speak(text)) as { ok: boolean };
    return result.ok;
  } catch {
    return false;
  }
}

export function stopNativeSpeech(): void {
  const api = bridge();
  if (!api) return;
  try {
    api.stopSpeaking();
  } catch {
    /* best effort */
  }
}
