/**
 * ContentDiagnosis — bounded, self-correcting recovery for content operations.
 *
 * RARE's rule is that a failed extraction should be diagnosed and retried by a
 * different method before the user is told anything. This module implements
 * exactly that, with three hard constraints so it stays safe:
 *
 *  1. Bounded. Each strategy runs at most once per operation, and the whole
 *     recovery attempt has a wall-clock and step budget. No retry loops.
 *  2. Learning. A strategy that failed is recorded and is never retried for the
 *     same operation with the same inputs — the next attempt must be a
 *     genuinely different method.
 *  3. Honest. Every attempt and its outcome is returned, including the ones
 *     that failed. The caller reports the full diagnosis, never just "failed".
 *
 * It does not modify RARE's own source. Self-modification stays behind the
 * developer gate; this is content-level repair (different extractor, OCR
 * instead of a text layer, a repaired buffer).
 */

export interface DiagnosisAttempt {
  /** Strategy identifier, e.g. `pdf-text-layer`, `pdf-ocr`, `repair-pdf-header`. */
  strategy: string;
  description: string;
  ok: boolean;
  /** Characters produced, when it succeeded. */
  chars?: number;
  /** Why it failed, in words the user can act on. */
  error?: string;
  durationMs: number;
}

export interface DiagnosisReport {
  /** Whether the operation eventually produced usable output. */
  recovered: boolean;
  /** The strategy that worked, when one did. */
  winningStrategy?: string;
  /** Every strategy tried, in order, including failures. */
  attempts: DiagnosisAttempt[];
  /** What the failure actually was, as opposed to what was reported. */
  rootCause?: string;
  /** What the user can do if no strategy worked. */
  nextStep?: string;
  totalMs: number;
}

export interface RecoveryStrategy<T> {
  id: string;
  description: string;
  /** Only run this strategy when the diagnosis suggests it applies. */
  appliesTo?: (context: DiagnosisContext) => boolean;
  run: () => Promise<T>;
}

export interface DiagnosisContext {
  /** The error from the previous attempt, if any. */
  lastError?: string;
  /** Strategy ids already tried. */
  tried: string[];
  /** Anything the caller knows about the payload. */
  hints?: Record<string, unknown>;
}

export interface RecoveryOptions {
  /** Give up after this many strategies. Default 4. */
  maxStrategies?: number;
  /** Give up after this much wall clock. Default 90 s. */
  maxTotalMs?: number;
  /** Called after each attempt, for progress reporting. */
  onAttempt?: (attempt: DiagnosisAttempt) => void;
}

/**
 * Run recovery strategies in order until one produces a usable result.
 *
 * A strategy that returns `null`/`undefined`, or throws, counts as a failure and
 * its reason is recorded. The loop stops at the first genuine success, so a
 * later strategy is never used when an earlier one already worked.
 */
export async function recoverWithStrategies<T>(
  strategies: Array<RecoveryStrategy<T>>,
  isUsable: (value: T) => boolean,
  options: RecoveryOptions = {},
): Promise<{ value: T | null; report: DiagnosisReport }> {
  const maxStrategies = Math.max(1, options.maxStrategies ?? 4);
  const maxTotalMs = Math.max(1000, options.maxTotalMs ?? 90_000);
  const startedAt = Date.now();

  const attempts: DiagnosisAttempt[] = [];
  const tried: string[] = [];
  let lastError: string | undefined;

  for (const strategy of strategies.slice(0, maxStrategies)) {
    if (tried.includes(strategy.id)) continue;
    if (Date.now() - startedAt > maxTotalMs) {
      attempts.push({
        strategy: '(stopped)',
        description: 'Recovery budget exhausted before every strategy could run.',
        ok: false,
        error: `Stopped after ${Math.round((Date.now() - startedAt) / 1000)}s.`,
        durationMs: 0,
      });
      break;
    }

    const context: DiagnosisContext = { lastError, tried: [...tried] };
    if (strategy.appliesTo && !strategy.appliesTo(context)) {
      attempts.push({
        strategy: strategy.id,
        description: strategy.description,
        ok: false,
        error: 'Skipped: this strategy does not apply to the diagnosed fault.',
        durationMs: 0,
      });
      tried.push(strategy.id);
      continue;
    }

    const attemptStarted = Date.now();
    tried.push(strategy.id);
    try {
      const value = await strategy.run();
      const durationMs = Date.now() - attemptStarted;
      if (value !== null && value !== undefined && isUsable(value)) {
        const attempt: DiagnosisAttempt = {
          strategy: strategy.id,
          description: strategy.description,
          ok: true,
          durationMs,
        };
        attempts.push(attempt);
        options.onAttempt?.(attempt);
        return {
          value,
          report: {
            recovered: true,
            winningStrategy: strategy.id,
            attempts,
            totalMs: Date.now() - startedAt,
          },
        };
      }
      lastError = 'The method completed but produced no usable output.';
      const attempt: DiagnosisAttempt = {
        strategy: strategy.id,
        description: strategy.description,
        ok: false,
        error: lastError,
        durationMs,
      };
      attempts.push(attempt);
      options.onAttempt?.(attempt);
    } catch (error) {
      const durationMs = Date.now() - attemptStarted;
      lastError = error instanceof Error ? error.message : 'Unknown failure.';
      const attempt: DiagnosisAttempt = {
        strategy: strategy.id,
        description: strategy.description,
        ok: false,
        error: lastError,
        durationMs,
      };
      attempts.push(attempt);
      options.onAttempt?.(attempt);
    }
  }

  return {
    value: null,
    report: {
      recovered: false,
      attempts,
      rootCause: inferRootCause(attempts),
      nextStep: suggestNextStep(attempts),
      totalMs: Date.now() - startedAt,
    },
  };
}

/**
 * Read the attempt log backwards and name the most likely cause.
 * Deliberately conservative: it names a cause only when the evidence supports
 * it, otherwise it says the cause is undetermined rather than guessing.
 */
export function inferRootCause(attempts: DiagnosisAttempt[]): string | undefined {
  const failures = attempts.filter((attempt) => !attempt.ok);
  if (failures.length === 0) return undefined;

  const joined = failures.map((attempt) => attempt.error || '').join(' | ').toLowerCase();

  if (/ffmpeg|ffprobe/.test(joined)) {
    return 'The media decoder (ffmpeg) is unavailable in this runtime, so audio and video cannot be processed here.';
  }
  if (/tesseract|pdftoppm/.test(joined)) {
    return 'OCR tooling (tesseract/pdftoppm) is unavailable, so scanned documents cannot be read in this runtime.';
  }
  if (/enotfound|econnrefused|getaddrinfo|dns/.test(joined)) {
    return 'The source host could not be resolved, which usually means a typo in the link or a network restriction.';
  }
  if (/401|403|sign in|login|unauthori[sz]ed|forbidden/.test(joined)) {
    return 'The source requires authentication. The link is not publicly accessible, so its contents could not be retrieved.';
  }
  if (/404|not found/.test(joined)) {
    return 'The source no longer exists at that address.';
  }
  if (/timeout|timed out|etimedout/.test(joined)) {
    return 'The source did not respond in time.';
  }
  if (/encrypted|password|drmed/.test(joined)) {
    return 'The file is encrypted or password-protected.';
  }
  if (/unsupported|no extractor is registered/.test(joined)) {
    return 'No available extractor handles this file type.';
  }
  if (/no readable text|no text extracted|empty/.test(joined)) {
    return 'The file was readable but contained no extractable text — it may be image-only, or genuinely empty.';
  }
  return undefined;
}

function suggestNextStep(attempts: DiagnosisAttempt[]): string | undefined {
  const joined = attempts.map((attempt) => attempt.error || '').join(' | ').toLowerCase();
  if (/ffmpeg|tesseract|pdftoppm/.test(joined)) {
    return 'Install the missing media or OCR tooling on the server, or process this file on a machine that has it.';
  }
  if (/401|403|sign in|login|unauthori[sz]ed|forbidden/.test(joined)) {
    return 'Change the sharing setting to "anyone with the link", or download the file yourself and upload it directly.';
  }
  if (/encrypted|password/.test(joined)) {
    return 'Remove the password from the file, then upload it again.';
  }
  if (/timeout|timed out/.test(joined)) {
    return 'Try again, or retrieve the file yourself and upload it directly.';
  }
  return 'Try a different file, or convert it to PDF and upload that instead.';
}

/**
 * Strip a corrupt PDF header's junk prefix.
 *
 * A common real-world failure: a PDF served with a few bytes of HTML or a BOM
 * prepended, which makes every parser reject the file even though the PDF body
 * is intact. Recovering the `%PDF-` offset frequently turns an unreadable file
 * into a readable one — a genuine repair, not a retry.
 */
export function repairPdfBuffer(buffer: Buffer): Buffer | null {
  const headerIndex = buffer.indexOf('%PDF-');
  if (headerIndex <= 0) return null;
  // Only trim a small prefix; a large offset means the file is not really a PDF.
  if (headerIndex > 4096) return null;
  const trimmed = buffer.subarray(headerIndex);
  return trimmed.length > 1024 ? Buffer.from(trimmed) : null;
}

/** Normalise a spreadsheet that is really a text file with the wrong extension. */
export function looksLikeDelimitedText(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 4096).toString('utf8');
  if (head.includes('\u0000')) return false;
  const lines = head.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 10);
  if (lines.length < 2) return false;
  const commaCounts = lines.map((line) => (line.match(/,/g) || []).length);
  const tabCounts = lines.map((line) => (line.match(/\t/g) || []).length);
  const consistent = (counts: number[]) => counts[0] > 0 && counts.every((count) => count === counts[0]);
  return consistent(commaCounts) || consistent(tabCounts);
}
