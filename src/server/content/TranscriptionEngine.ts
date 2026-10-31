/**
 * TranscriptionEngine — turn a recording into a timestamped, speaker-attributed
 * transcript, however long it is.
 *
 * The unit of work is a bounded audio segment (see MediaProcessor). Segments are
 * transcribed in order, each one given the tail of the previous transcript as
 * context so a sentence split across a boundary is continued rather than
 * restarted, and so the provider can keep speaker labels consistent.
 *
 * What this module refuses to do:
 *  - invent words. If a segment produces nothing, the transcript records that
 *    segment as having no detectable speech rather than filling it in.
 *  - invent speakers. Speaker labels are only emitted when the provider
 *    actually distinguished them (`detectSpeakerLabels`); otherwise the turn is
 *    attributed to `Speaker 1` and the transcript says so.
 *  - claim completeness it does not have. `coverage` and `warnings` state
 *    exactly which parts of the recording were transcribed.
 */

import { probeMedia, segmentMedia, extractVideoFrames, MediaProbe } from './MediaProcessor.js';

/** One transcribed turn. `start`/`end` are absolute offsets in the source. */
export interface TranscriptTurn {
  index: number;
  speaker: string;
  startSeconds: number;
  endSeconds: number;
  /** Human-readable clock, e.g. "01:14:32" or "14:32". */
  startClock: string;
  endClock: string;
  text: string;
}

export interface TranscriptResult {
  turns: TranscriptTurn[];
  /** Flat, readable transcript with inline timestamps. */
  text: string;
  durationSeconds: number;
  /** True when the provider distinguished speakers. */
  speakerLabelsDetected: boolean;
  speakers: string[];
  segments: Array<{
    index: number;
    startSeconds: number;
    durationSeconds: number;
    ok: boolean;
    chars: number;
    error?: string;
  }>;
  segmentsCompleted: number;
  segmentsFailed: number;
  /** Fraction of the recording's duration actually transcribed (0–1). */
  coverage: number;
  model: string;
  warnings: string[];
  probe: MediaProbe | null;
  /** Base64 JPEG frames, when the source had video and frames were requested. */
  frames?: Array<{ index: number; timestampSeconds: number; base64: string }>;
}

/** The narrow contract this engine needs from a speech provider. */
export interface SpeechProvider {
  transcribeAudio(
    audioBase64: string,
    mimeType: string,
    options?: { prompt?: string; detectSpeakers?: boolean },
  ): Promise<{
    text: string;
    model: string;
    /**
     * Provider-native utterance timings, relative to the audio it was given.
     *
     * When a provider can time individual utterances (faster-whisper does, from
     * its own VAD), those timings are the truth and must be used. Falling back
     * to one turn per segment would stretch a two-minute stretch of speech into
     * a single block and make every timestamp in it wrong.
     */
    segments?: Array<{ start: number; end: number; text: string }>;
  }>;
}

export interface TranscriptionOptions {
  /** Length of each audio segment sent to the provider. Default 600 s. */
  segmentSeconds?: number;
  /** Include video frames in the result (video sources only). */
  includeFrames?: boolean;
  /** Called after each segment so a long job can report real progress. */
  onSegment?: (progress: { completed: number; total: number; startSeconds: number }) => void;
  /** Fixed speaker name for a single-speaker recording. */
  knownSpeaker?: string;
}

export class TranscriptionError extends Error {
  constructor(message: string, readonly code: string, readonly nextStep?: string) {
    super(message);
  }
}

/** Format seconds as mm:ss, or hh:mm:ss past an hour. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(remainder)}` : `${pad(minutes)}:${pad(remainder)}`;
}

/**
 * Parse a provider's free-text transcript into turns.
 *
 * Providers do not have a reliable structured format, so this reads the two
 * conventions that actually appear in practice:
 *   `[00:14:32] Speaker 1: text`   — timestamps + speakers
 *   `Speaker 1: text`              — speakers only
 * A line with neither becomes a continuation of the previous turn, which is
 * how a paragraph wrapped across lines is normally emitted.
 *
 * `offsetSeconds` shifts every parsed timestamp onto the source's clock.
 */
export function parseTranscriptText(
  raw: string,
  offsetSeconds: number,
  defaultSpeaker: string,
): { turns: Array<{ speaker: string; startSeconds: number | null; text: string }>; sawSpeakerLabel: boolean } {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const turns: Array<{ speaker: string; startSeconds: number | null; text: string }> = [];
  let sawSpeakerLabel = false;

  // [hh:mm:ss] or [mm:ss], optionally followed by a speaker label.
  const timestampPattern = /^\s*\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*(?:[-–—]\s*)?/;
  const speakerPattern = /^\s*(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*)?(Speaker\s*\d+|S\d+|SPEAKER\s*\d+|Person\s*\d+)\s*:\s*/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const timeMatch = line.match(timestampPattern);
    let secondsIntoRaw: number | null = null;
    if (timeMatch) {
      const hoursPart = timeMatch[3] !== undefined ? Number(timeMatch[1]) : 0;
      const minutesPart = timeMatch[3] !== undefined ? Number(timeMatch[2]) : Number(timeMatch[1]);
      const secondsPart = timeMatch[3] !== undefined ? Number(timeMatch[3]) : Number(timeMatch[2]);
      secondsIntoRaw = hoursPart * 3600 + minutesPart * 60 + secondsPart;
    }

    const speakerMatch = line.match(speakerPattern);
    let speaker = defaultSpeaker;
    let text = line;
    if (speakerMatch) {
      sawSpeakerLabel = true;
      // Normalise "S1"/"SPEAKER 1"/"Person 1" to "Speaker N" so labels stay
      // consistent across segments that phrase them differently.
      const number = speakerMatch[1].match(/(\d+)/)?.[1];
      speaker = number ? `Speaker ${number}` : speakerMatch[1];
      text = line.slice(speakerMatch[0].length).trim();
    } else if (timeMatch) {
      text = line.slice(timeMatch[0].length).trim();
      text = text.replace(/^(Speaker\s*\d+|S\d+)\s*:\s*/i, (match) => {
        const number = match.match(/(\d+)/)?.[1];
        speaker = number ? `Speaker ${number}` : match;
        sawSpeakerLabel = true;
        return '';
      }).trim();
    }

    if (!text) continue;

    // A line with no timestamp and no speaker label continues the previous turn
    // — that is a wrapped paragraph, not a new speaker.
    if (secondsIntoRaw === null && !speakerMatch && turns.length > 0) {
      turns[turns.length - 1].text = `${turns[turns.length - 1].text} ${text}`.trim();
      continue;
    }

    turns.push({
      speaker,
      startSeconds: secondsIntoRaw === null ? null : offsetSeconds + secondsIntoRaw,
      text,
    });
  }

  return { turns, sawSpeakerLabel };
}

/** Detect speech that the provider explicitly marked as unclear. */
function countUncertain(text: string): number {
  return (text.match(/\[(?:inaudible|unclear|unintelligible|music|applause|crosstalk)\]/gi) || []).length;
}

export async function transcribeBuffer(
  buffer: Buffer,
  filenameHint: string,
  provider: SpeechProvider,
  options: TranscriptionOptions = {},
): Promise<TranscriptResult> {
  const warnings: string[] = [];
  const probe = await probeMedia(buffer, filenameHint);

  const { segments, warnings: segmentWarnings } = await segmentMedia(buffer, filenameHint, {
    segmentSeconds: options.segmentSeconds,
  });
  warnings.push(...segmentWarnings);

  if (segments.length === 0) {
    throw new TranscriptionError(
      'No audio could be extracted from this file.',
      'NO_AUDIO',
      'Check the file plays in a normal audio player, then try again.',
    );
  }

  const turns: TranscriptTurn[] = [];
  const segmentReports: TranscriptResult['segments'] = [];
  let model = '';
  let sawSpeakerLabel = false;
  let segmentsFailed = 0;
  let cursorSeconds = 0;
  let previousTail = '';

  for (const [position, segment] of segments.entries()) {
    const defaultSpeaker = options.knownSpeaker || 'Speaker 1';
    // Give the provider the previous turns so a sentence straddling the
    // boundary is continued, and so speaker numbering stays consistent.
    const context = previousTail
      ? `This is segment ${position + 1} of ${segments.length} of one continuous recording. The previous segment ended with:\n"${previousTail.slice(-600)}"\nContinue the transcript from where that left off. Do not repeat it. Keep the same speaker labels.`
      : `This is segment ${position + 1} of ${segments.length} of a recording. Label distinct speakers as "Speaker 1", "Speaker 2" and so on.`;

    try {
      const response = await provider.transcribeAudio(segment.base64, segment.mimeType, {
        prompt: context,
        detectSpeakers: true,
      });
      const text = (response.text || '').trim();
      model = response.model || model;

      if (text.length === 0) {
        segmentReports.push({
          index: segment.index,
          startSeconds: segment.startSeconds,
          durationSeconds: segment.durationSeconds,
          ok: true,
          chars: 0,
        });
        warnings.push(
          `No speech was detected between ${formatClock(segment.startSeconds)} and ${formatClock(segment.startSeconds + segment.durationSeconds)}.`,
        );
      } else {
        // Prefer the provider's own utterance timings. They are measured from
        // the audio's VAD, so they place each sentence on the clock exactly;
        // parsing the flat text can only guess. Text parsing remains the
        // fallback for providers that return prose without timings.
        const nativeSegments = (response.segments || []).filter(
          (segment) => segment && typeof segment.start === 'number' && String(segment.text || '').trim().length > 0,
        );

        if (nativeSegments.length > 0) {
          for (const native of nativeSegments) {
            const start = segment.startSeconds + Math.max(0, native.start);
            const end = segment.startSeconds + Math.max(native.start, native.end);
            const nativeText = String(native.text).trim();
            const parsed = parseTranscriptText(nativeText, start, defaultSpeaker);
            sawSpeakerLabel = sawSpeakerLabel || parsed.sawSpeakerLabel;

            // A provider segment may itself carry a speaker label; when it does
            // not, the whole segment is one turn.
            const turnsFromSegment = parsed.turns.length > 0
              ? parsed.turns
              : [{ speaker: defaultSpeaker, startSeconds: start, text: nativeText }];

            for (const parsedTurn of turnsFromSegment) {
              const turnStart = parsedTurn.startSeconds ?? start;
              turns.push({
                index: turns.length,
                speaker: parsedTurn.speaker,
                startSeconds: Number(turnStart.toFixed(3)),
                endSeconds: Number(Math.max(turnStart, end).toFixed(3)),
                startClock: formatClock(turnStart),
                endClock: formatClock(end),
                text: parsedTurn.text,
              });
            }
          }
        } else {
          const parsed = parseTranscriptText(text, segment.startSeconds, defaultSpeaker);
          sawSpeakerLabel = sawSpeakerLabel || parsed.sawSpeakerLabel;

          for (const parsedTurn of parsed.turns) {
            const start = parsedTurn.startSeconds ?? cursorSeconds;
            turns.push({
              index: turns.length,
              speaker: parsedTurn.speaker,
              startSeconds: Number(start.toFixed(3)),
              // An exact end is unknown per turn; the next turn's start (or the
              // segment end) closes it after the loop below.
              endSeconds: Number(Math.max(start, cursorSeconds + segment.durationSeconds).toFixed(3)),
              startClock: formatClock(start),
              endClock: formatClock(start + segment.durationSeconds),
              text: parsedTurn.text,
            });
          }
        }

        previousTail = text;

        const uncertain = countUncertain(text);
        if (uncertain > 0) {
          warnings.push(`${uncertain} passage(s) in segment ${position + 1} were marked unclear by the provider.`);
        }

        segmentReports.push({
          index: segment.index,
          startSeconds: segment.startSeconds,
          durationSeconds: segment.durationSeconds,
          ok: true,
          chars: text.length,
        });
      }
      cursorSeconds = segment.startSeconds + segment.durationSeconds;
    } catch (error) {
      segmentsFailed += 1;
      const message = error instanceof Error ? error.message : 'Transcription failed.';
      segmentReports.push({
        index: segment.index,
        startSeconds: segment.startSeconds,
        durationSeconds: segment.durationSeconds,
        ok: false,
        chars: 0,
        error: message,
      });
      warnings.push(
        `Segment ${position + 1} (${formatClock(segment.startSeconds)}–${formatClock(segment.startSeconds + segment.durationSeconds)}) could not be transcribed: ${message}`,
      );
      cursorSeconds = segment.startSeconds + segment.durationSeconds;
      // Keep the previous tail: the next segment should still be joined to the
      // last thing we actually heard, not to the failure.
    }

    options.onSegment?.({
      completed: position + 1,
      total: segments.length,
      startSeconds: segment.startSeconds,
    });
  }

  if (turns.length === 0) {
    throw new TranscriptionError(
      segmentsFailed === segments.length
        ? 'Every segment failed to transcribe.'
        : 'No speech could be detected anywhere in this recording.',
      'NO_SPEECH',
      'The recording may be silent, music-only, or in a language the configured provider does not support.',
    );
  }

  // Close each turn at the next turn's start so timestamps are contiguous.
  // A measured end is kept when it is already sane: only an end that runs past
  // the following turn (or a placeholder end from the text-parsing fallback)
  // is trimmed, so provider timings are not overwritten with guesses.
  for (let index = 0; index < turns.length; index += 1) {
    const next = turns[index + 1];
    if (!next) {
      turns[index].endClock = formatClock(turns[index].endSeconds);
      continue;
    }
    if (turns[index].endSeconds > next.startSeconds || turns[index].endSeconds <= turns[index].startSeconds) {
      turns[index].endSeconds = Number(Math.max(turns[index].startSeconds, next.startSeconds).toFixed(3));
    }
    turns[index].endClock = formatClock(turns[index].endSeconds);
  }

  const durationSeconds = probe?.durationSeconds || cursorSeconds;
  const transcribedSeconds = segmentReports
    .filter((report) => report.ok && report.chars > 0)
    .reduce((sum, report) => sum + report.durationSeconds, 0);

  const speakers = [...new Set(turns.map((turn) => turn.speaker))].sort();
  const text = turns
    .map((turn) => `[${turn.startClock} – ${turn.endClock}] ${turn.speaker}: ${turn.text}`)
    .join('\n');

  if (!sawSpeakerLabel && turns.length > 1) {
    warnings.push(
      'The provider did not distinguish individual speakers; every turn is attributed to one speaker.',
    );
  }
  if (segmentsFailed > 0) {
    warnings.push(
      `${segmentsFailed} of ${segments.length} segments could not be transcribed, so the transcript is incomplete.`,
    );
  }

  let frames: TranscriptResult['frames'];
  if (options.includeFrames && probe?.hasVideo) {
    const extracted = await extractVideoFrames(buffer, filenameHint);
    frames = extracted.frames;
    warnings.push(...extracted.warnings);
  }

  return {
    turns,
    text,
    durationSeconds,
    speakerLabelsDetected: sawSpeakerLabel,
    speakers,
    segments: segmentReports,
    segmentsCompleted: segmentReports.filter((report) => report.ok).length,
    segmentsFailed,
    // Encoder padding can push measured segment durations a hair past the
    // container's stated duration, so coverage is clamped to 1 rather than
    // reporting an impossible 101%.
    coverage: durationSeconds > 0 ? Math.min(1, Number((transcribedSeconds / durationSeconds).toFixed(3))) : 0,
    model,
    warnings,
    probe,
    ...(frames ? { frames } : {}),
  };
}

/**
 * Derive meeting structure from a finished transcript.
 *
 * This is deliberately rule-based: decisions and action items are extracted
 * from the text the recording actually contains, with the source turn attached
 * so every claim can be traced back to a timestamp and checked.
 */
export interface TranscriptInsight {
  summary: string;
  decisions: Array<{ text: string; clock: string }>;
  actionItems: Array<{ text: string; clock: string; owner?: string; due?: string }>;
  questions: Array<{ text: string; clock: string }>;
  dates: Array<{ text: string; clock: string }>;
  speakers: Array<{ speaker: string; turns: number; words: number }>;
}

const DECISION_CUES = /\b(we('| a)re going with|we decided|decision is|we agreed|we('| ha)ve agreed|let('| u)s go with|final(ised|ized)? (on|as)|we('| ha)ve decided|approved)\b/i;
/**
 * Action cues cover first/second person AND a named third-party actor, because
 * in a real meeting most commitments are stated as "Ada will prepare…" rather
 * than "I will prepare…". The named-actor branch requires a capitalised name
 * immediately before the modal so a bare future tense is not enough.
 */
const ACTION_CUES = /\b(i('| wi)ll|we('| wi)ll|you('| wi)ll|he('| wi)ll|she('| wi)ll|needs? to|has to|have to|action item|to-?do|follow up|is going to|are going to)\b|\b[A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?\s+(?:will|is going to|needs? to|has to|owns?)\b/;
/** A cue alone is not enough; the sentence must also describe an assignable act. */
const TASK_VERB = /\b(send|prepare|schedule|review|deliver|submit|complete|finish|write|draft|share|update|confirm|book|contact|email|call|organis(e|ize)|create|build|test|deploy|approve|sign|pay|invoice|budget|plan|hire|onboard|fix|investigate)\b/i;
const DATE_CUES = /\b(\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}|\d{4}-\d{2}-\d{2}|next (week|month|quarter|monday|tuesday|wednesday|thursday|friday|weekend)|by (monday|tuesday|wednesday|thursday|friday|end of (day|week|month))|tomorrow|today)\b/i;
const OWNER_PATTERN = /\b([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?)\s+(?:will|is going to|needs? to|has to|owns?)\b/;

/**
 * Detect a re-statement of something already recorded.
 *
 * Speech recognition transcribes a repeated sentence slightly differently each
 * time ("Lagos" → "Legos", "2027" → "2021"), so exact matching is not enough.
 * Two entries count as the same statement when they share most of their content
 * words. This keeps one decision rather than five near-identical ones.
 */
function isNearDuplicate(candidate: string, existing: string[]): boolean {
  const wordsOf = (value: string): string[] =>
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3);
  const candidateWords = new Set(wordsOf(candidate));
  if (candidateWords.size === 0) return false;

  for (const entry of existing) {
    const entryWords = new Set(wordsOf(entry));
    if (entryWords.size === 0) continue;
    let shared = 0;
    for (const word of candidateWords) if (entryWords.has(word)) shared += 1;
    const overlap = shared / Math.min(candidateWords.size, entryWords.size);
    // 0.7 catches transcription drift while still separating genuinely
    // different statements about the same subject.
    if (overlap >= 0.7) return true;
  }
  return false;
}

export function deriveInsights(result: TranscriptResult): TranscriptInsight {
  const decisions: TranscriptInsight['decisions'] = [];
  const actionItems: TranscriptInsight['actionItems'] = [];
  const questions: TranscriptInsight['questions'] = [];
  const dates: TranscriptInsight['dates'] = [];

  /** Sentence-level dedupe, keyed on normalised text. */
  const seen = new Set<string>();
  const isRepeat = (text: string): boolean => {
    const key = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!key || seen.has(key)) return true;
    seen.add(key);
    return false;
  };

  for (const turn of result.turns) {
    // Sentences, not whole turns: a turn can contain both a decision and a
    // question, and quoting the whole turn would blur which is which.
    const sentences = turn.text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim().length > 0);
    for (const sentence of sentences) {
      const text = sentence.trim();
      if (text.length < 8) continue;

      // Repetition is normal in speech — a presenter says the same sentence
      // three times. Reporting it three times as three separate decisions would
      // misrepresent the meeting, so repeats are collapsed to the first mention.
      const repeat = isRepeat(text);

      if (!repeat && DECISION_CUES.test(text) && !isNearDuplicate(text, decisions.map((entry) => entry.text))) {
        decisions.push({ text, clock: turn.startClock });
      }
      // An action item needs BOTH a commitment cue and an assignable task verb;
      // "the meeting will begin" has the first but not the second.
      if (!repeat && ACTION_CUES.test(text) && TASK_VERB.test(text) && !isNearDuplicate(text, actionItems.map((entry) => entry.text))) {
        const ownerMatch = text.match(OWNER_PATTERN);
        const dueMatch = text.match(DATE_CUES);
        actionItems.push({
          text,
          clock: turn.startClock,
          ...(ownerMatch ? { owner: ownerMatch[1] } : {}),
          ...(dueMatch ? { due: dueMatch[0] } : {}),
        });
      }
      if (!repeat && text.endsWith('?')) questions.push({ text, clock: turn.startClock });
      if (!repeat) {
        const dateMatch = text.match(DATE_CUES);
        if (dateMatch) dates.push({ text, clock: turn.startClock });
      }
    }
  }

  const speakerStats = new Map<string, { turns: number; words: number }>();
  for (const turn of result.turns) {
    const current = speakerStats.get(turn.speaker) || { turns: 0, words: 0 };
    current.turns += 1;
    current.words += turn.text.split(/\s+/).filter(Boolean).length;
    speakerStats.set(turn.speaker, current);
  }

  // The summary is built from the transcript's own opening and total shape,
  // never from a model's reconstruction, so it cannot contain invented facts.
  const opening = result.turns[0]?.text.slice(0, 240) ?? '';
  const summary = [
    `${result.turns.length} turns across ${formatClock(result.durationSeconds)}`,
    result.speakers.length > 1 ? `${result.speakers.length} speakers` : 'single speaker',
    decisions.length ? `${decisions.length} decision(s)` : null,
    actionItems.length ? `${actionItems.length} action item(s)` : null,
    questions.length ? `${questions.length} question(s)` : null,
  ].filter(Boolean).join(' · ') + (opening ? `. Opens with: "${opening}${opening.length >= 240 ? '…' : ''}"` : '');

  return {
    summary,
    decisions: decisions.slice(0, 50),
    actionItems: actionItems.slice(0, 50),
    questions: questions.slice(0, 50),
    dates: [...new Map(dates.map((item) => [item.text, item])).values()].slice(0, 50),
    speakers: [...speakerStats.entries()]
      .map(([speaker, stats]) => ({ speaker, ...stats }))
      .sort((left, right) => right.words - left.words),
  };
}
