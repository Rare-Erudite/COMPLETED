/**
 * RARE — Wake-word bridge (web side).
 *
 * Talks to the native `window.RareWake` bridge, which controls the "Hey Rae"
 * foreground service. In a browser tab there is no bridge, so this reports
 * unavailable rather than pretending to listen.
 *
 * The service is honest about its limits: it uses Android's own SpeechRecognizer
 * (usually network-backed), it is a foreground service with a persistent
 * notification, and it does not run when the app is force-stopped or the phone
 * is locked.
 */

interface NativeWake {
  status(): string;
  start(): string;
  stop(): string;
}

function getNative(): NativeWake | null {
  const candidate = (window as unknown as { RareWake?: NativeWake }).RareWake;
  return candidate && typeof candidate.status === 'function' ? candidate : null;
}

export function isWakeWordAvailable(): boolean {
  return getNative() !== null;
}

export interface WakeStatus {
  available: boolean;
  running: boolean;
  detail: string;
}

export function getWakeStatus(): WakeStatus {
  const native = getNative();
  if (!native) {
    return {
      available: false,
      running: false,
      detail: 'Wake word is only available in the RARE Android app.',
    };
  }
  try {
    const parsed = JSON.parse(native.status()) as { ok?: boolean; running?: boolean; detail?: string };
    return {
      available: true,
      running: parsed.running === true,
      detail: parsed.detail || (parsed.running ? 'Listening for "Hey Rae".' : 'Not listening.'),
    };
  } catch {
    return { available: true, running: false, detail: 'Could not read the wake-word state.' };
  }
}

export function startWakeWord(): { ok: boolean; message?: string; error?: string } {
  const native = getNative();
  if (!native) return { ok: false, error: 'Wake word is only available in the RARE Android app.' };
  try {
    const parsed = JSON.parse(native.start()) as { ok?: boolean; message?: string; error?: string };
    return { ok: parsed.ok === true, message: parsed.message, error: parsed.error };
  } catch {
    return { ok: false, error: 'Could not start the wake-word service.' };
  }
}

export function stopWakeWord(): { ok: boolean; message?: string; error?: string } {
  const native = getNative();
  if (!native) return { ok: false, error: 'Wake word is only available in the RARE Android app.' };
  try {
    const parsed = JSON.parse(native.stop()) as { ok?: boolean; message?: string; error?: string };
    return { ok: parsed.ok === true, message: parsed.message, error: parsed.error };
  } catch {
    return { ok: false, error: 'Could not stop the wake-word service.' };
  }
}
