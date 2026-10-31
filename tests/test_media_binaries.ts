/**
 * Media binary resolution tests.
 *
 * Regression guard for the deployment defect where the bundled ffprobe ships
 * non-executable (0644) and the `postinstall` chmod is skipped by Vercel's
 * `--ignore-scripts` install, so every transcription request failed with a
 * false FFMPEG_UNAVAILABLE. The resolver must return a genuinely executable
 * path even when the source binary is not executable, and probing real audio
 * must return real metadata.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  resolveMediaBinaries,
  probeMedia,
  __resetMediaBinaryCache,
} from '../src/server/content/MediaProcessor.js';

const require = createRequire(import.meta.url);

export async function runMediaBinaryTests() {
  console.log('--- Testing media binary resolution ---');

  const ffmpegSrc = require('@ffmpeg-installer/ffmpeg').path as string;
  const ffprobeSrc = require('@ffprobe-installer/ffprobe').path as string;
  assert.ok(fs.existsSync(ffmpegSrc), 'bundled ffmpeg is present');
  assert.ok(fs.existsSync(ffprobeSrc), 'bundled ffprobe is present');

  // Stage non-executable copies, exactly as an --ignore-scripts install leaves
  // them, and point the resolver at those.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-media-test-'));
  const ffmpeg = path.join(dir, 'ffmpeg');
  const ffprobe = path.join(dir, 'ffprobe');
  fs.copyFileSync(ffmpegSrc, ffmpeg);
  fs.copyFileSync(ffprobeSrc, ffprobe);
  fs.chmodSync(ffmpeg, 0o644);
  fs.chmodSync(ffprobe, 0o644);

  const prevFfmpeg = process.env.RARE_FFMPEG_PATH;
  const prevFfprobe = process.env.RARE_FFPROBE_PATH;
  process.env.RARE_FFMPEG_PATH = ffmpeg;
  process.env.RARE_FFPROBE_PATH = ffprobe;
  __resetMediaBinaryCache();

  try {
    const resolved = await resolveMediaBinaries();
    assert.ok(resolved, 'the resolver finds a usable ffmpeg/ffprobe pair');
    for (const bin of [resolved!.ffmpeg, resolved!.ffprobe]) {
      const mode = fs.statSync(bin).mode;
      assert.ok((mode & 0o111) !== 0, `resolved binary is executable: ${bin}`);
    }

    // Real audio must probe to real metadata, not a fabricated result.
    const fixture = path.resolve(process.cwd(), 'tests/fixtures/speech_short.mp3');
    const probe = await probeMedia(fs.readFileSync(fixture), 'speech_short.mp3');
    assert.ok(probe.durationSeconds > 19 && probe.durationSeconds < 22, 'real duration is measured');
    assert.equal(probe.hasAudio, true, 'the fixture is detected as audio');
    assert.ok(probe.audioCodec, 'a real audio codec is reported');
    console.log(`  \u2713 non-executable binaries resolve to an executable path; probe = ${probe.durationSeconds}s ${probe.audioCodec}`);
  } finally {
    if (prevFfmpeg === undefined) delete process.env.RARE_FFMPEG_PATH;
    else process.env.RARE_FFMPEG_PATH = prevFfmpeg;
    if (prevFfprobe === undefined) delete process.env.RARE_FFPROBE_PATH;
    else process.env.RARE_FFPROBE_PATH = prevFfprobe;
    __resetMediaBinaryCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
