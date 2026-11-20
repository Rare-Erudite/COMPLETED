/**
 * RARE — Offline wake-word (Vosk) bridge, web side.
 *
 * The optional offline engine is a native feature of the RARE Android app. This
 * module talks to `window.RareWake`'s offline methods and reports the real state
 * of the model on disk. In a browser tab there is no bridge, so it reports
 * unavailable rather than pretending a model is installed.
 *
 * The model is Apache-2.0 (vosk-model-small-en-us-0.15, published by Alpha
 * Cephei) and is downloaded only when the user asks for it. The download is
 * ~41 MB; the extracted model is ~40 MB on disk.
 */

interface NativeOfflineWake {
  offlineStatus?(): string;
  downloadOfflineModel?(): string;
  deleteOfflineModel?(): string;
}

function getNative(): NativeOfflineWake | null {
  const candidate = (window as unknown as { RareWake?: NativeOfflineWake }).RareWake;
  return candidate && typeof candidate.offlineStatus === 'function' ? candidate : null;
}

export interface OfflineWakeStatus {
  available: boolean;
  ready: boolean;
  downloading: boolean;
  progress: number;
  downloadBytes: number;
  unpackedBytes: number;
  modelName: string;
  licence: string;
  state: string;
}

const UNAVAILABLE: OfflineWakeStatus = {
  available: false,
  ready: false,
  downloading: false,
  progress: 0,
  downloadBytes: 0,
  unpackedBytes: 0,
  modelName: 'vosk-model-small-en-us-0.15',
  licence: 'Apache-2.0',
  state: 'Offline wake word is only available in the RARE Android app.',
};

export function isOfflineWakeAvailable(): boolean {
  return getNative() !== null;
}

export function getOfflineWakeStatus(): OfflineWakeStatus {
  const native = getNative();
  if (!native) return UNAVAILABLE;
  try {
    const parsed = JSON.parse(native.offlineStatus!()) as Partial<OfflineWakeStatus> & { ok?: boolean };
    return {
      available: true,
      ready: parsed.ready === true,
      downloading: parsed.downloading === true,
      progress: typeof parsed.progress === 'number' ? parsed.progress : 0,
      downloadBytes: typeof parsed.downloadBytes === 'number' ? parsed.downloadBytes : 0,
      unpackedBytes: typeof parsed.unpackedBytes === 'number' ? parsed.unpackedBytes : 0,
      modelName: parsed.modelName || 'vosk-model-small-en-us-0.15',
      licence: parsed.licence || 'Apache-2.0',
      state: parsed.state || 'unknown',
    };
  } catch {
    return { ...UNAVAILABLE, available: true, state: 'Could not read the offline model state.' };
  }
}

export function downloadOfflineModel(): { ok: boolean; message?: string; error?: string } {
  const native = getNative();
  if (!native || typeof native.downloadOfflineModel !== 'function') {
    return { ok: false, error: 'Offline wake word is only available in the RARE Android app.' };
  }
  try {
    const parsed = JSON.parse(native.downloadOfflineModel()) as { ok?: boolean; message?: string; error?: string };
    return { ok: parsed.ok === true, message: parsed.message, error: parsed.error };
  } catch {
    return { ok: false, error: 'Could not start the model download.' };
  }
}

export function deleteOfflineModel(): { ok: boolean; message?: string; error?: string } {
  const native = getNative();
  if (!native || typeof native.deleteOfflineModel !== 'function') {
    return { ok: false, error: 'Offline wake word is only available in the RARE Android app.' };
  }
  try {
    const parsed = JSON.parse(native.deleteOfflineModel()) as { ok?: boolean; message?: string; error?: string };
    return { ok: parsed.ok === true, message: parsed.message, error: parsed.error };
  } catch {
    return { ok: false, error: 'Could not remove the offline model.' };
  }
}

/** Formats a byte count for the UI, e.g. 41205931 -> "39.3 MB". */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return 'unknown size';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}
