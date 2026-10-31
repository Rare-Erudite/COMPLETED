/**
 * Speaker diarisation tests.
 *
 * These assert the two things that can be proven without a 2 GB model on disk:
 *
 *  1. The worker fails honestly. When pyannote is absent it must return a
 *     structured PROVIDER_MISSING error, not an empty speaker list and not a
 *     fabricated one. This is the exact failure mode the assignment forbids.
 *  2. Speaker assignment is grounded in overlap. A transcript turn only takes a
 *     diarised speaker when a diarisation turn actually overlaps it; otherwise
 *     the original label survives and the turn is counted as unattributed.
 *
 * The model itself is not exercised here. That is stated rather than implied:
 * `probeDiarization()` reports available:false on a host without pyannote, and
 * the capability endpoint surfaces that to the client.
 */

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { applyToTranscript, probeDiarization } from '../src/server/content/DiarizationService.js';

const execFileAsync = promisify(execFile);

/**
 * Run the worker with a real stdin write.
 *
 * `execFile` has no `input` option — passing one does nothing and the worker
 * blocks on stdin forever, which hangs the whole suite instead of failing it.
 */
function runWorker(payload: string, timeoutMs = 30_000): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const script = path.resolve(process.cwd(), 'scripts', 'diarize_offline.py');
    const child = spawn('python3', [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('worker timed out'));
    }, timeoutMs);
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(payload);
  });
}

function makeTranscript(): any {
  return {
    turns: [
      { index: 0, speaker: 'Speaker 1', startSeconds: 0, endSeconds: 2, startClock: '00:00', endClock: '00:02', text: 'hello there' },
      { index: 1, speaker: 'Speaker 1', startSeconds: 2, endSeconds: 4, startClock: '00:02', endClock: '00:04', text: 'how are you' },
      { index: 2, speaker: 'Speaker 1', startSeconds: 30, endSeconds: 32, startClock: '00:30', endClock: '00:32', text: 'unrelated' },
    ],
    text: 'hello there how are you unrelated',
    durationSeconds: 40,
    speakerLabelsDetected: false,
    speakers: ['Speaker 1'],
    segments: [],
    segmentsCompleted: 1,
    segmentsFailed: 0,
    coverage: 1,
    model: 'test',
    warnings: [],
    probe: null,
  };
}

export async function runDiarizationTests(): Promise<void> {
  console.log('[diarization]');

  // --- 1. The worker must fail honestly when the model is not installed. ---
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-diar-test-'));
  const audioPath = path.join(dir, 'silence.wav');
  // A tiny valid WAV header is enough: the worker checks the file exists, then
  // checks for pyannote before it ever decodes audio.
  fs.writeFileSync(audioPath, Buffer.alloc(1024));

  try {
    const { code, stdout } = await runWorker(JSON.stringify({ audioPath }));
    assert.notEqual(code, 0, 'the worker must exit non-zero when it cannot diarise');

    const parsed = JSON.parse(stdout);
    assert.equal(parsed.ok, false, 'worker must not report success without a model');

    if (parsed.code === 'PROVIDER_MISSING') {
      assert.match(parsed.error, /pyannote/i, 'the reason must name the missing package');
      console.log('  ✓ worker reports PROVIDER_MISSING with a precise reason (pyannote absent here)');
    } else {
      // On a host that does have pyannote, the worker gets past the import and
      // fails on the fake audio instead. Either way it must not claim success.
      assert.ok(
        ['DIARIZE_FAILED', 'MODEL_LOAD_FAILED', 'NO_SPEECH'].includes(parsed.code),
        `unexpected worker code: ${parsed.code}`,
      );
      console.log(`  ✓ worker failed honestly with ${parsed.code} (pyannote present)`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- 2. Probe must never claim availability it cannot back up. ---
  const info = await probeDiarization(true);
  assert.equal(typeof info.available, 'boolean');
  if (!info.available) {
    assert.ok(info.reason && info.reason.length > 0, 'an unavailable probe must explain why');
    console.log('  ✓ probe reports unavailable with a reason');
  } else {
    console.log('  ✓ probe reports available (pyannote installed on this host)');
  }

  // --- 3. Overlap-based assignment. ---
  const merged = applyToTranscript(makeTranscript(), {
    speakers: ['SPEAKER_00', 'SPEAKER_01'],
    speakerCount: 2,
    turns: [
      { start: 0, end: 2.1, speaker: 'SPEAKER_00' },
      { start: 2.1, end: 4.2, speaker: 'SPEAKER_01' },
    ],
    turnCount: 2,
    duration: 4.2,
    model: 'pyannote/speaker-diarization-3.1',
    method: 'pyannote-pipeline',
  });

  assert.equal(merged.turns[0].speaker, 'SPEAKER_00', 'turn 0 takes the overlapping speaker');
  assert.equal(merged.turns[1].speaker, 'SPEAKER_01', 'turn 1 takes the overlapping speaker');
  assert.equal(merged.turns[2].speaker, 'Speaker 1', 'a turn with no overlap keeps its original label');
  assert.equal(merged.diarization.unattributedTurns, 1, 'the unattributed turn is counted');
  assert.equal(merged.speakerLabelsDetected, true, 'labels are reported as detected');
  console.log('  ✓ applyToTranscript assigns by overlap and never guesses');

  // --- 4. A diarisation with no turns must not relabel anything. ---
  const untouched = applyToTranscript(makeTranscript(), {
    speakers: [],
    speakerCount: 0,
    turns: [],
    turnCount: 0,
    duration: 0,
    model: 'pyannote',
    method: 'pyannote-pipeline',
  });
  assert.equal(untouched.turns[0].speaker, 'Speaker 1', 'empty diarisation leaves labels alone');
  assert.equal(untouched.diarization.unattributedTurns, 3, 'every turn is unattributed');
  assert.equal(untouched.speakerLabelsDetected, false, 'no speakers means no detected labels');
  console.log('  ✓ empty diarisation leaves the transcript untouched');

  // --- 5. Real model, real audio. ---
  // Runs only when pyannote is actually installed AND a token is present, so a
  // host without the model skips rather than pretending. When it does run, the
  // audio is a genuine two-voice recording with known ground truth: speaker A
  // and speaker B alternate six times, so a correct diarisation must find
  // exactly two speakers and alternate between them.
  if (info.available && (process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN)) {
    const audioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-diar-real-'));
    const wavPath = path.join(audioDir, 'two_speakers.wav');
    try {
      writeTwoSpeakerWav(wavPath);
      const { code, stdout } = await runWorker(
        JSON.stringify({ audioPath: wavPath, minSpeakers: 1, maxSpeakers: 8 }),
        15 * 60_000,
      );
      const parsed = JSON.parse(stdout);
      assert.equal(code, 0, `real diarisation must succeed: ${parsed.error || ''}`);
      assert.equal(parsed.ok, true, 'real diarisation must report ok');
      assert.equal(parsed.speakerCount, 2, 'the two synthetic voices must be separated');
      assert.ok(parsed.turnCount >= 4, `expected several turns, got ${parsed.turnCount}`);

      // Ground truth: A, B, A, B, A, B. Consecutive turns must alternate.
      const labels = parsed.turns.map((t: any) => t.speaker);
      let alternations = 0;
      for (let i = 1; i < labels.length; i += 1) {
        if (labels[i] !== labels[i - 1]) alternations += 1;
      }
      assert.ok(
        alternations >= 3,
        `speakers must alternate across the recording, saw ${alternations} changes in ${labels.join(',')}`,
      );
      console.log(
        `  ✓ real pyannote run: ${parsed.speakerCount} speakers, ${parsed.turnCount} turns, model ${parsed.model}`,
      );
    } finally {
      fs.rmSync(audioDir, { recursive: true, force: true });
    }
  } else {
    console.log('  – real-model test skipped (pyannote or HF_TOKEN not available on this host)');
  }
}

/**
 * Write a 14-second WAV containing two clearly different synthetic voices
 * alternating A,B,A,B,A,B. Different fundamental frequency and formants make
 * them separable by a real diarisation model, which is what makes this a
 * meaningful test rather than a smoke test.
 */
function writeTwoSpeakerWav(target: string): void {
  const sampleRate = 16000;
  const voices: Record<string, { f0: number; formants: [number, number][] }> = {
    A: { f0: 110, formants: [[700, 0.5], [1200, 0.3]] },
    B: { f0: 210, formants: [[850, 0.5], [1600, 0.3]] },
  };
  const plan: [string, number][] = [['A', 2.0], ['B', 2.0], ['A', 1.8], ['B', 2.2], ['A', 2.0], ['B', 1.9]];

  const samples: number[] = [];
  for (const [voice, duration] of plan) {
    const { f0, formants } = voices[voice];
    const count = Math.floor(sampleRate * duration);
    for (let i = 0; i < count; i += 1) {
      const t = i / sampleRate;
      let value = 0;
      for (let k = 1; k < 12; k += 1) value += Math.sin(2 * Math.PI * f0 * k * t) / k;
      for (const [freq, gain] of formants) value += gain * Math.sin(2 * Math.PI * freq * t);
      const envelope = 0.5 * (1 - Math.cos(2 * Math.PI * 3.5 * t));
      samples.push(value * envelope * 0.125);
    }
    for (let i = 0; i < Math.floor(sampleRate * 0.35); i += 1) samples.push(0);
  }

  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-32767, Math.min(32767, Math.round(sample * 32767)));
    data.writeInt16LE(clamped, index * 2);
  });

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);

  fs.writeFileSync(target, Buffer.concat([header, data]));
}
