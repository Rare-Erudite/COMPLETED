/**
 * SpeechProviders — real transcription backends, selected by what is actually
 * available rather than by a configured preference.
 *
 * Two providers, in priority order:
 *
 *  1. Gemini — cloud, needs GEMINI_API_KEY. Best quality, sends audio off-device.
 *  2. faster-whisper — fully local, no key, no network. Slower, but it means
 *     transcription works on a bare install, which is RARE's stated floor.
 *
 * Selection is by probe, not by guesswork: each provider reports whether it can
 * really run right now, and the registry picks the first that can. When neither
 * can, the caller gets a precise reason instead of an empty transcript.
 *
 * The faster-whisper provider runs in a subprocess because the model holds
 * hundreds of megabytes and the GIL; running it in-process would stall the
 * Node event loop for every other request.
 */

import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type { SpeechProvider } from './TranscriptionEngine.js';

const execFileAsync = promisify(execFile);

export interface SpeechProviderInfo {
  id: string;
  label: string;
  available: boolean;
  /** Why it is unavailable, when it is. */
  reason?: string;
  /** Where the audio goes, so the user can make an informed choice. */
  runsOn: 'cloud' | 'local';
  /** True when it needs the network. */
  requiresNetwork: boolean;
}

/** What a provider returns: the flat text plus its own timed segments. */
export interface SpeechResponse {
  text: string;
  model: string;
  language?: string;
  /** Provider-native segments, already on the audio's own clock. */
  segments?: Array<{ start: number; end: number; text: string }>;
}

export interface RichSpeechProvider extends SpeechProvider {
  transcribeAudio(audioBase64: string, mimeType: string, options?: any): Promise<SpeechResponse>;
  info(): Promise<SpeechProviderInfo>;
}

// ---------------------------------------------------------------------------
// Local faster-whisper
// ---------------------------------------------------------------------------

let localProbeCache: { at: number; info: SpeechProviderInfo } | null = null;

/** Locate the transcription script relative to the running module. */
function offlineScriptPath(): string {
  // Works from both src/ (tsx) and dist/ (compiled) layouts.
  const candidates = [
    path.resolve(process.cwd(), 'scripts', 'transcribe_offline.py'),
    path.resolve(process.cwd(), '..', 'scripts', 'transcribe_offline.py'),
  ];
  return candidates[0];
}

async function pythonAvailable(): Promise<{ ok: boolean; binary?: string; reason?: string }> {
  for (const binary of ['python3', 'python']) {
    try {
      await execFileAsync(binary, ['--version'], { timeout: 8000 });
      return { ok: true, binary };
    } catch {
      continue;
    }
  }
  return { ok: false, reason: 'No Python interpreter is available, so the local speech engine cannot run.' };
}

export class LocalWhisperProvider implements RichSpeechProvider {
  async info(): Promise<SpeechProviderInfo> {
    // Probing imports the package, which costs ~1 s, so cache the verdict.
    if (localProbeCache && Date.now() - localProbeCache.at < 60_000) return localProbeCache.info;

    const python = await pythonAvailable();
    if (!python.ok) {
      const info: SpeechProviderInfo = {
        id: 'faster-whisper',
        label: 'Local speech engine (faster-whisper)',
        available: false,
        reason: python.reason,
        runsOn: 'local',
        requiresNetwork: false,
      };
      localProbeCache = { at: Date.now(), info };
      return info;
    }

    try {
      const script = offlineScriptPath();
      await fs.access(script);
      await execFileAsync(
        python.binary!,
        ['-c', 'import faster_whisper; print(faster_whisper.__version__)'],
        { timeout: 120_000 },
      );
      const info: SpeechProviderInfo = {
        id: 'faster-whisper',
        label: 'Local speech engine (faster-whisper)',
        available: true,
        runsOn: 'local',
        requiresNetwork: false,
      };
      localProbeCache = { at: Date.now(), info };
      return info;
    } catch (error) {
      const missingPackage = /ModuleNotFoundError|No module named/i.test(String(error));
      const info: SpeechProviderInfo = {
        id: 'faster-whisper',
        label: 'Local speech engine (faster-whisper)',
        available: false,
        reason: missingPackage
          ? 'faster-whisper is not installed (pip install faster-whisper).'
          : 'The local speech engine could not be loaded.',
        runsOn: 'local',
        requiresNetwork: false,
      };
      localProbeCache = { at: Date.now(), info };
      return info;
    }
  }

  async transcribeAudio(
    audioBase64: string,
    _mimeType: string,
    options: { prompt?: string; detectSpeakers?: boolean; language?: string } = {},
  ): Promise<SpeechResponse> {
    const python = await pythonAvailable();
    if (!python.ok || !python.binary) {
      throw new Error(python.reason || 'No Python interpreter is available.');
    }

    // The subprocess reads a real file: base64 over stdin for a 10-minute
    // segment would add ~33% overhead for no benefit.
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rare-whisper-'));
    const audioPath = path.join(directory, 'segment.mp3');
    try {
      await fs.writeFile(audioPath, Buffer.from(audioBase64, 'base64'));
      const request = JSON.stringify({
        audioPath,
        language: options.language ?? (process.env.RARE_WHISPER_LANGUAGE || null),
        detectSpeakers: Boolean(options.detectSpeakers),
      });

      const script = offlineScriptPath();
      const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
        const child = execFile(
          python.binary!,
          [script],
          { timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024, env: process.env },
          (error, stdout) => {
            if (error && !stdout) {
              reject(error);
              return;
            }
            resolve({ stdout: String(stdout) });
          },
        );
        child.stdin?.write(request);
        child.stdin?.end();
      });

      const parsed = JSON.parse(stdout);
      if (!parsed.ok) {
        throw Object.assign(new Error(parsed.error || 'Local transcription failed.'), { code: parsed.code });
      }
      return {
        text: parsed.text || '',
        model: parsed.model || 'faster-whisper',
        language: parsed.language,
        segments: parsed.segments,
      };
    } finally {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

export class GeminiSpeechProvider implements RichSpeechProvider {
  constructor(private readonly gemini: { transcribeAudio: (b: string, m: string, o?: any) => Promise<{ text: string; model: string }> }) {}

  async info(): Promise<SpeechProviderInfo> {
    const configured = Boolean(process.env.GEMINI_API_KEY?.trim());
    return {
      id: 'gemini',
      label: 'Gemini (cloud speech)',
      available: configured,
      ...(configured ? {} : { reason: 'GEMINI_API_KEY is not set on this server.' }),
      runsOn: 'cloud',
      requiresNetwork: true,
    };
  }

  async transcribeAudio(audioBase64: string, mimeType: string, options?: any): Promise<SpeechResponse> {
    const result = await this.gemini.transcribeAudio(audioBase64, mimeType, options);
    return { text: result.text || '', model: result.model || 'gemini' };
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface SpeechProviderSummary {
  available: boolean;
  selected: string | null;
  providers: SpeechProviderInfo[];
  /** Plain-language statement of what will happen when a user uploads audio. */
  statement: string;
}

/**
 * Resolve the provider that will actually be used.
 *
 * Order is deliberate: cloud first when configured (better quality, and the
 * user opted in by setting a key), local second as the always-works floor.
 */
export async function resolveSpeechProvider(geminiFactory?: () => any): Promise<{
  provider: RichSpeechProvider | null;
  summary: SpeechProviderSummary;
}> {
  const candidates: RichSpeechProvider[] = [];

  if (geminiFactory) {
    try {
      candidates.push(new GeminiSpeechProvider(geminiFactory()));
    } catch {
      /* registry not ready; local can still work */
    }
  }
  candidates.push(new LocalWhisperProvider());

  const infos: SpeechProviderInfo[] = [];
  for (const candidate of candidates) {
    try {
      infos.push(await candidate.info());
    } catch {
      infos.push({
        id: (candidate as any).constructor?.name || 'unknown',
        label: 'Unknown provider',
        available: false,
        reason: 'The provider could not be probed.',
        runsOn: 'local',
        requiresNetwork: false,
      });
    }
  }

  const chosen = await (async () => {
    for (const [index, info] of infos.entries()) {
      if (info.available) return candidates[index];
    }
    return null;
  })();

  const selectedInfo = chosen ? infos[candidates.indexOf(chosen)] : null;
  const statement = selectedInfo
    ? `Audio will be transcribed by ${selectedInfo.label}${selectedInfo.runsOn === 'local' ? ' on this server, with no audio leaving the machine' : ''}.`
    : `No speech engine is available: ${infos.map((info) => `${info.label} — ${info.reason}`).join('; ')}.`;

  return {
    provider: chosen,
    summary: {
      available: Boolean(chosen),
      selected: selectedInfo?.id ?? null,
      providers: infos,
      statement,
    },
  };
}
