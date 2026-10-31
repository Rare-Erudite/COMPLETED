/**
 * MediaProcessor — decode, segment and prepare audio/video for transcription.
 *
 * Transcription itself is delegated to a `SpeechProvider` (Gemini today). This
 * module owns everything before that: probing duration, extracting the audio
 * track from a video, and splitting a long recording into segments that fit a
 * provider's per-request limit.
 *
 * Why segmentation matters: a 20-hour recording is ~1.2 GB of audio at 32 kbps.
 * Uploading that in one request is impossible, and holding it in memory is
 * wasteful. We transcode each segment to a bounded, speech-optimised format
 * (mono, 16 kHz, low bitrate) and transcribe it in sequence, carrying the
 * speaker context forward so a sentence cut across a boundary is still joined.
 *
 * Every step reports what it actually did. If ffmpeg is missing, `available()`
 * is false and callers must say so rather than silently returning junk.
 */

import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// The server is bundled as ESM, where `require` does not exist. createRequire
// gives us a real CommonJS resolver so the optional installer packages can be
// located at runtime without a static import that would break a build where
// they are absent.
const requireFromHere = createRequire(import.meta.url);

export interface MediaProbe {
  durationSeconds: number;
  hasAudio: boolean;
  hasVideo: boolean;
  audioCodec?: string;
  videoCodec?: string;
  container?: string;
  bitrateKbps?: number;
  sampleRate?: number;
  channels?: number;
}

export interface MediaSegment {
  index: number;
  /** 0-based start offset in seconds. */
  startSeconds: number;
  durationSeconds: number;
  /** Base64 of the transcoded segment, ready for a speech provider. */
  base64: string;
  mimeType: string;
  bytes: number;
}

export interface SegmentationOptions {
  /** Target length of each segment. Defaults to 600 s (10 min). */
  segmentSeconds?: number;
  /** Hard cap on a single segment's encoded size in bytes. */
  maxSegmentBytes?: number;
}

export class MediaProcessorError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

let cachedFfmpeg: boolean | undefined;
let cachedBinaries: { ffmpeg: string; ffprobe: string } | null | undefined;

/**
 * Resolve the ffmpeg/ffprobe executables.
 *
 * A serverless host (Vercel) has no system ffmpeg and no writable PATH, so
 * relying on `ffmpeg` being on PATH made transcription impossible there. The
 * npm packages `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe`
 * ship prebuilt binaries as optional dependencies, which survive an
 * `--ignore-scripts` install. Resolution order:
 *
 *   1. RARE_FFMPEG_PATH / RARE_FFPROBE_PATH, for an operator override.
 *   2. The bundled installer packages, when present.
 *   3. Bare `ffmpeg` / `ffprobe` on PATH, for a normal self-hosted box.
 *
 * Returns null when neither is usable, so callers can report the real reason.
 */
export async function resolveMediaBinaries(): Promise<{ ffmpeg: string; ffprobe: string } | null> {
  if (cachedBinaries !== undefined) return cachedBinaries;

  const candidates: Array<{ ffmpeg: string; ffprobe: string }> = [];

  const overrideFfmpeg = process.env.RARE_FFMPEG_PATH?.trim();
  const overrideFfprobe = process.env.RARE_FFPROBE_PATH?.trim();
  if (overrideFfmpeg && overrideFfprobe) {
    candidates.push({ ffmpeg: overrideFfmpeg, ffprobe: overrideFfprobe });
  }

  // Bundled binaries. Resolved through createRequire so a build without the
  // optional packages still loads this module and falls through to PATH.
  try {
    const ffmpegInstaller = requireFromHere('@ffmpeg-installer/ffmpeg');
    const ffprobeInstaller = requireFromHere('@ffprobe-installer/ffprobe');
    if (ffmpegInstaller?.path && ffprobeInstaller?.path) {
      candidates.push({ ffmpeg: ffmpegInstaller.path, ffprobe: ffprobeInstaller.path });
    }
  } catch {
    /* not installed; fall through to PATH */
  }

  candidates.push({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' });

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate.ffmpeg, ['-version'], { timeout: 15_000 });
      await execFileAsync(candidate.ffprobe, ['-version'], { timeout: 15_000 });
      cachedBinaries = candidate;
      return candidate;
    } catch {
      continue;
    }
  }

  cachedBinaries = null;
  return null;
}

/** True when ffmpeg/ffprobe can actually be executed here. */
export async function ffmpegAvailable(): Promise<boolean> {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;
  cachedFfmpeg = (await resolveMediaBinaries()) !== null;
  return cachedFfmpeg;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rare-media-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Probe a media buffer. Returns null when ffprobe cannot read it. */
export async function probeMedia(buffer: Buffer, filenameHint = 'input'): Promise<MediaProbe | null> {
  const binaries = await resolveMediaBinaries();
  if (!binaries) return null;
  const extension = path.extname(filenameHint) || '.bin';
  return withTempDir(async (dir) => {
    const input = path.join(dir, `input${extension}`);
    await fs.writeFile(input, buffer);
    try {
      const { stdout } = await execFileAsync(
        binaries.ffprobe,
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input],
        { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout) as any;
      const streams: any[] = Array.isArray(parsed.streams) ? parsed.streams : [];
      const audio = streams.find((stream) => stream.codec_type === 'audio');
      const video = streams.find((stream) => stream.codec_type === 'video');
      const duration = Number(parsed.format?.duration ?? audio?.duration ?? video?.duration ?? 0);
      return {
        durationSeconds: Number.isFinite(duration) ? duration : 0,
        hasAudio: Boolean(audio),
        hasVideo: Boolean(video),
        audioCodec: audio?.codec_name,
        videoCodec: video?.codec_name,
        container: parsed.format?.format_name,
        bitrateKbps: parsed.format?.bit_rate ? Math.round(Number(parsed.format.bit_rate) / 1000) : undefined,
        sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
        channels: audio?.channels ? Number(audio.channels) : undefined,
      };
    } catch {
      return null;
    }
  });
}

/**
 * Split media into transcription-sized segments.
 *
 * Segments are mono 16 kHz MP3 at 32 kbps — roughly 240 KB per minute, which
 * keeps a 10-minute segment around 2.4 MB, comfortably inside a provider's
 * inline payload limit while remaining intelligible for speech.
 */
export async function segmentMedia(
  buffer: Buffer,
  filenameHint: string,
  options: SegmentationOptions = {},
): Promise<{ segments: MediaSegment[]; probe: MediaProbe | null; warnings: string[] }> {
  const binaries = await resolveMediaBinaries();
  if (!binaries) {
    throw new MediaProcessorError(
      'ffmpeg is not installed in this runtime, so audio cannot be decoded or split.',
      'FFMPEG_UNAVAILABLE',
    );
  }

  const segmentSeconds = Math.max(30, Math.min(1800, options.segmentSeconds ?? 600));
  const maxSegmentBytes = options.maxSegmentBytes ?? 9 * 1024 * 1024;
  const extension = path.extname(filenameHint) || '.bin';
  const warnings: string[] = [];

  return withTempDir(async (dir) => {
    const input = path.join(dir, `input${extension}`);
    await fs.writeFile(input, buffer);
    const probe = await probeMediaBuffer(input);

    if (probe && !probe.hasAudio) {
      throw new MediaProcessorError(
        'This file has no audio track, so there is nothing to transcribe.',
        'NO_AUDIO_TRACK',
      );
    }

    const segments: MediaSegment[] = [];
    const pattern = path.join(dir, 'segment%04d.mp3');
    let cursorSeconds = 0;

    try {
      await execFileAsync(
        binaries.ffmpeg,
        [
          '-hide_banner', '-loglevel', 'error',
          '-i', input,
          '-vn',
          '-ac', '1',
          '-ar', '16000',
          '-b:a', '32k',
          '-f', 'segment',
          '-segment_time', String(segmentSeconds),
          '-reset_timestamps', '1',
          pattern,
        ],
        { timeout: 30 * 60_000, maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (error) {
      throw new MediaProcessorError(
        `Audio could not be decoded: ${error instanceof Error ? error.message : 'ffmpeg failed'}.`,
        'DECODE_FAILED',
      );
    }

    const files = (await fs.readdir(dir)).filter((name) => /^segment\d+\.mp3$/.test(name)).sort();
    if (files.length === 0) {
      throw new MediaProcessorError('No audio segments were produced from this file.', 'NO_SEGMENTS');
    }

    for (const [index, name] of files.entries()) {
      const filePath = path.join(dir, name);
      const stat = await fs.stat(filePath);
      if (stat.size === 0) {
        warnings.push(`Segment ${index + 1} was empty and was skipped.`);
        continue;
      }
      if (stat.size > maxSegmentBytes) {
        warnings.push(
          `Segment ${index + 1} is ${(stat.size / 1024 / 1024).toFixed(1)} MB, above the ${(maxSegmentBytes / 1024 / 1024).toFixed(0)} MB budget; it may be rejected by the provider.`,
        );
      }
      const data = await fs.readFile(filePath);
      // Measure each segment instead of assuming an exact split: the mp3
      // encoder adds a frame of padding, so `index * segmentSeconds` drifts by
      // a fraction of a second per segment. For a 20-hour recording that drift
      // would misplace timestamps by minutes. Real durations keep the
      // cumulative offset honest.
      const segmentProbe = await probeMediaBuffer(filePath);
      const measured = segmentProbe?.durationSeconds ?? 0;
      const fallback = probe?.durationSeconds
        ? Math.min(segmentSeconds, Math.max(0, probe.durationSeconds - cursorSeconds))
        : segmentSeconds;
      const duration = measured > 0 ? measured : fallback;
      segments.push({
        index,
        startSeconds: Number(cursorSeconds.toFixed(3)),
        durationSeconds: Number(duration.toFixed(3)),
        base64: data.toString('base64'),
        mimeType: 'audio/mpeg',
        bytes: data.length,
      });
      cursorSeconds += duration;
    }

    if (probe && probe.durationSeconds > 0) {
      const covered = cursorSeconds;
      // Allow one segment of slack for encoder padding; anything more means
      // audio was actually lost and the caller must be told.
      if (covered < probe.durationSeconds - segmentSeconds) {
        warnings.push(
          `Only ${Math.round(covered)}s of the ${Math.round(probe.durationSeconds)}s recording was segmented.`,
        );
      }
    }

    return { segments, probe, warnings };
  });
}

/** Probe an already-written file path (avoids double-writing the buffer). */
async function probeMediaBuffer(inputPath: string): Promise<MediaProbe | null> {
  const binaries = await resolveMediaBinaries();
  if (!binaries) return null;
  try {
    const { stdout } = await execFileAsync(
      binaries.ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as any;
    const streams: any[] = Array.isArray(parsed.streams) ? parsed.streams : [];
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    const video = streams.find((stream) => stream.codec_type === 'video');
    const duration = Number(parsed.format?.duration ?? audio?.duration ?? 0);
    return {
      durationSeconds: Number.isFinite(duration) ? duration : 0,
      hasAudio: Boolean(audio),
      hasVideo: Boolean(video),
      audioCodec: audio?.codec_name,
      videoCodec: video?.codec_name,
      container: parsed.format?.format_name,
      bitrateKbps: parsed.format?.bit_rate ? Math.round(Number(parsed.format.bit_rate) / 1000) : undefined,
      sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
      channels: audio?.channels ? Number(audio.channels) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Extract representative video frames so visual content can be analysed
 * alongside the audio transcript. Returns JPEG base64 frames at fixed
 * intervals, capped so a long video does not produce hundreds of images.
 */
export async function extractVideoFrames(
  buffer: Buffer,
  filenameHint: string,
  options: { maxFrames?: number; intervalSeconds?: number } = {},
): Promise<{ frames: Array<{ index: number; timestampSeconds: number; base64: string }>; warnings: string[] }> {
  if (!(await ffmpegAvailable())) {
    return { frames: [], warnings: ['ffmpeg is not installed, so video frames cannot be extracted.'] };
  }
  const maxFrames = Math.max(1, Math.min(24, options.maxFrames ?? 8));
  const extension = path.extname(filenameHint) || '.mp4';
  const warnings: string[] = [];

  return withTempDir(async (dir) => {
    const input = path.join(dir, `input${extension}`);
    await fs.writeFile(input, buffer);
    const probe = await probeMediaBuffer(input);
    if (!probe || !probe.hasVideo) {
      return { frames: [], warnings: ['The file contains no video track.'] };
    }
    const interval = options.intervalSeconds
      ?? (probe.durationSeconds > 0 ? Math.max(1, probe.durationSeconds / (maxFrames + 1)) : 10);

    const binaries = await resolveMediaBinaries();
    if (!binaries) {
      return { frames: [], warnings: ['ffmpeg is not installed, so video frames cannot be extracted.'] };
    }

    try {
      await execFileAsync(
        binaries.ffmpeg,
        [
          '-hide_banner', '-loglevel', 'error',
          '-i', input,
          '-vf', `fps=1/${interval.toFixed(3)},scale=960:-1`,
          '-frames:v', String(maxFrames),
          '-q:v', '4',
          path.join(dir, 'frame%03d.jpg'),
        ],
        { timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (error) {
      warnings.push(`Frame extraction failed: ${error instanceof Error ? error.message : 'ffmpeg failed'}.`);
      return { frames: [], warnings };
    }

    const files = (await fs.readdir(dir)).filter((name) => /^frame\d+\.jpg$/.test(name)).sort();
    const frames: Array<{ index: number; timestampSeconds: number; base64: string }> = [];
    for (const [index, name] of files.entries()) {
      const data = await fs.readFile(path.join(dir, name));
      if (data.length === 0) continue;
      frames.push({
        index,
        timestampSeconds: Math.round((index + 1) * interval),
        base64: data.toString('base64'),
      });
    }
    if (frames.length === 0) warnings.push('No frames could be extracted from the video.');
    return { frames, warnings };
  });
}
