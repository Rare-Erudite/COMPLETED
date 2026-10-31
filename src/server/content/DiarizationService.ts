/**
 * DiarizationService — real speaker diarisation, as a separate concern from
 * transcription.
 *
 * Why this is a separate service and not a flag on the speech provider:
 * speech-to-text tells you *what* was said and roughly *when*. It does not tell
 * you *who* said it. Asking a transcription model to "label speakers" produces
 * plausible-looking labels that are not grounded in the audio — which is
 * exactly the failure mode the assignment forbids. Diarisation is a different
 * model doing a different job: it segments the audio by voice and clusters
 * those segments into speakers.
 *
 * The worker (`scripts/diarize_offline.py`) runs out of process because
 * pyannote holds a large model in memory and would otherwise block the Node
 * event loop for the whole server.
 *
 * Honesty rules enforced here:
 *  - Availability is *probed*, never assumed. `info()` reports the real reason
 *    when diarisation cannot run.
 *  - When the worker fails, the caller gets a typed error with a code. We never
 *    fall back to inventing speaker labels.
 *  - `applyToTranscript` only assigns a speaker when a diarisation turn
 *    actually overlaps the transcript turn. No overlap means the original
 *    label is kept and the turn is reported as unattributed.
 */

import { execFile, spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type { TranscriptResult, TranscriptTurn } from './TranscriptionEngine.js';

const execFileAsync = promisify(execFile);

export interface DiarizationTurn {
  start: number;
  end: number;
  speaker: string;
}

export interface DiarizationResult {
  speakers: string[];
  speakerCount: number;
  turns: DiarizationTurn[];
  turnCount: number;
  duration: number;
  model: string;
  method: string;
}

export interface DiarizationInfo {
  available: boolean;
  /** Why it is unavailable, when it is. */
  reason?: string;
  /** Where the audio is processed. */
  runsOn: 'local';
  requiresNetwork: boolean;
  /** True when a Hugging Face token is needed to fetch the model. */
  requiresToken: boolean;
  model?: string;
}

export class DiarizationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly nextStep?: string,
  ) {
    super(message);
    this.name = 'DiarizationError';
  }
}

export interface DiarizationOptions {
  /** Exact number of speakers, when known. */
  numSpeakers?: number;
  minSpeakers?: number;
  maxSpeakers?: number;
  /** Overrides HF_TOKEN from the environment. */
  hfToken?: string;
  /** Hard timeout for the worker, in ms. Default 15 minutes. */
  timeoutMs?: number;
}

/** Locate the worker script from both src/ (tsx) and dist/ (compiled) layouts. */
function workerScriptPath(): string {
  return path.resolve(process.cwd(), 'scripts', 'diarize_offline.py');
}

let probeCache: { at: number; info: DiarizationInfo } | null = null;
const PROBE_TTL_MS = 60_000;

/**
 * Probe whether diarisation can actually run right now.
 *
 * This shells out to Python and imports pyannote. It is deliberately a real
 * check rather than a config lookup: a configured token with no package
 * installed must report unavailable, not "ready".
 */
export async function probeDiarization(force = false): Promise<DiarizationInfo> {
  if (!force && probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) {
    return probeCache.info;
  }

  const script = workerScriptPath();
  const hasToken = Boolean(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN);

  let info: DiarizationInfo;

  try {
    await fs.access(script);
  } catch {
    info = {
      available: false,
      reason: `The diarisation worker is missing at ${script}.`,
      runsOn: 'local',
      requiresNetwork: false,
      requiresToken: hasToken,
    };
    probeCache = { at: Date.now(), info };
    return info;
  }

  try {
    const { stdout } = await execFileAsync(
      'python3',
      ['-c', 'import pyannote.audio, sys; sys.stdout.write(pyannote.audio.__version__)'],
      { timeout: 30_000 },
    );
    info = {
      available: true,
      runsOn: 'local',
      requiresNetwork: true,
      requiresToken: hasToken,
      model: 'pyannote/speaker-diarization-3.1',
    };
    void stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingPackage = /No module named|ModuleNotFoundError/i.test(message);
    info = {
      available: false,
      reason: missingPackage
        ? 'pyannote.audio is not installed, so speaker diarisation is unavailable. Install it with: pip install "pyannote.audio>=3.1"'
        : `The diarisation runtime could not be probed: ${message}`,
      runsOn: 'local',
      requiresNetwork: true,
      requiresToken: hasToken,
    };
  }

  probeCache = { at: Date.now(), info };
  return info;
}

/**
 * Run the worker, writing the request to its stdin and collecting stdout.
 *
 * `execFile` has no `input` option — passing one silently does nothing, and the
 * worker then blocks forever waiting on stdin. That is a hang, not an error, so
 * it has to be `spawn` with an explicit stdin write and a hard timeout.
 */
function runWorker(payload: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [workerScriptPath()], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(
        Object.assign(new Error(`The diarisation worker timed out after ${Math.round(timeoutMs / 1000)}s.`), {
          stdout,
        }),
      );
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      // Guard against a runaway worker filling memory.
      if (stdout.length > 32 * 1024 * 1024) {
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(error, { stdout }));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      // Non-zero exit: the worker's structured failure is on stdout.
      reject(
        Object.assign(new Error(stderr.trim() || `The diarisation worker exited with code ${code}.`), {
          stdout,
        }),
      );
    });

    // EPIPE here means the worker died before reading; the close handler
    // reports the real reason, so this must not throw.
    child.stdin.on('error', () => undefined);
    child.stdin.end(payload);
  });
}

/**
 * Diarise an audio buffer.
 *
 * The whole recording is sent to the worker in one pass. Diarisation needs
 * global context to cluster voices consistently — running it per 10-minute
 * segment would give each segment its own speaker numbering, so "SPEAKER_00"
 * in segment 1 and segment 2 would not reliably be the same person.
 */
export async function diarizeBuffer(
  buffer: Buffer,
  filenameHint: string,
  options: DiarizationOptions = {},
): Promise<DiarizationResult> {
  const info = await probeDiarization();
  if (!info.available) {
    throw new DiarizationError(
      info.reason || 'Speaker diarisation is unavailable on this host.',
      'PROVIDER_MISSING',
      'Install pyannote.audio and set HF_TOKEN, or use a host that has them.',
    );
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rare-diar-'));
  const extension = path.extname(filenameHint) || '.wav';
  const audioPath = path.join(dir, `input${extension}`);

  try {
    await fs.writeFile(audioPath, buffer);

    const request = {
      audioPath,
      numSpeakers: options.numSpeakers ?? null,
      minSpeakers: options.minSpeakers ?? 1,
      maxSpeakers: options.maxSpeakers ?? 8,
      hfToken: options.hfToken ?? process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN ?? null,
    };

    let stdout: string;
    try {
      stdout = await runWorker(JSON.stringify(request), options.timeoutMs ?? 15 * 60_000);
    } catch (error) {
      // The worker writes a structured failure to stdout and exits 1, so the
      // useful detail is on the error object's stdout, not its message.
      const raw = (error as { stdout?: string }).stdout;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          throw new DiarizationError(
            parsed.error || 'Diarisation failed.',
            parsed.code || 'DIARIZE_FAILED',
          );
        } catch (parseError) {
          if (parseError instanceof DiarizationError) throw parseError;
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new DiarizationError(`The diarisation worker failed: ${message}`, 'DIARIZE_FAILED');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new DiarizationError(
        'The diarisation worker returned output that was not valid JSON.',
        'DIARIZE_FAILED',
      );
    }

    if (!parsed.ok) {
      throw new DiarizationError(
        String(parsed.error || 'Diarisation failed.'),
        String(parsed.code || 'DIARIZE_FAILED'),
      );
    }

    return {
      speakers: (parsed.speakers as string[]) || [],
      speakerCount: Number(parsed.speakerCount) || 0,
      turns: (parsed.turns as DiarizationTurn[]) || [],
      turnCount: Number(parsed.turnCount) || 0,
      duration: Number(parsed.duration) || 0,
      model: String(parsed.model || 'pyannote'),
      method: String(parsed.method || 'pyannote-pipeline'),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Overlap in seconds between two intervals. */
function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Assign diarised speakers onto transcript turns.
 *
 * Each transcript turn takes the speaker whose diarisation turn overlaps it
 * most. A turn with no overlap at all keeps its original label and is counted
 * as unattributed — we do not guess.
 */
export function applyToTranscript(
  transcript: TranscriptResult,
  diarization: DiarizationResult,
): TranscriptResult & { diarization: { model: string; method: string; unattributedTurns: number } } {
  let unattributed = 0;

  const turns: TranscriptTurn[] = transcript.turns.map((turn) => {
    let bestSpeaker: string | null = null;
    let bestOverlap = 0;

    for (const dTurn of diarization.turns) {
      const shared = overlap(turn.startSeconds, turn.endSeconds, dTurn.start, dTurn.end);
      if (shared > bestOverlap) {
        bestOverlap = shared;
        bestSpeaker = dTurn.speaker;
      }
    }

    if (!bestSpeaker) {
      unattributed += 1;
      return turn;
    }

    return { ...turn, speaker: bestSpeaker };
  });

  const speakers = Array.from(new Set(turns.map((t) => t.speaker))).sort();

  return {
    ...transcript,
    turns,
    speakers,
    speakerLabelsDetected: diarization.speakerCount > 0,
    diarization: {
      model: diarization.model,
      method: diarization.method,
      unattributedTurns: unattributed,
    },
  };
}
