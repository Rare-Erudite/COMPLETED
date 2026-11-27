/**
 * Resilience — retries with backoff, and a bounded failure log.
 *
 * Two problems this solves:
 *
 *  1. Transient failures. A provider or MCP server that returns a 429, a 503
 *     or a dropped socket is usually fine a second later. Retrying blindly is
 *     wrong (a non-idempotent call would run twice), so retries are opt-in and
 *     only applied to calls the caller declares safe to repeat.
 *
 *  2. Invisible failures. When something failed at 03:00 there was no way to
 *     see it afterwards — the error went to stdout and was gone. This keeps a
 *     bounded ring of recent failures that an operator can inspect.
 *
 * Everything here is in-process and free. No external service, no cost.
 */

export interface RetryOptions {
  /** Total attempts, including the first. Default 3. */
  attempts?: number;
  /** Base delay in ms; doubles each attempt. Default 400. */
  baseDelayMs?: number;
  /** Cap on a single delay. Default 5000. */
  maxDelayMs?: number;
  /** Label used in the failure log. */
  label?: string;
  /** Return false to stop retrying (e.g. a 400 that will never succeed). */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export interface FailureRecord {
  at: string;
  label: string;
  attempts: number;
  message: string;
  /** HTTP status when the failure carried one. */
  status?: number;
}

const MAX_FAILURES = 200;
const failures: FailureRecord[] = [];

/** Record a failure for later inspection. */
export function recordFailure(record: Omit<FailureRecord, 'at'>): void {
  failures.push({ ...record, at: new Date().toISOString() });
  if (failures.length > MAX_FAILURES) failures.splice(0, failures.length - MAX_FAILURES);
}

/** Recent failures, newest first. */
export function recentFailures(limit = 50): FailureRecord[] {
  return failures.slice(-limit).reverse();
}

/** Clear the failure log (used by tests). */
export function clearFailures(): void {
  failures.length = 0;
}

/** Extract an HTTP status from an error, when it carries one. */
function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as Record<string, unknown>;
  for (const key of ['status', 'statusCode', 'code']) {
    const value = candidate[key];
    if (typeof value === 'number' && value >= 100 && value < 600) return value;
  }
  return undefined;
}

/**
 * A status that will never succeed on retry. Retrying a 400 or a 401 just
 * wastes the user's time and, for a metered provider, their quota.
 */
function isPermanent(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Run an operation with bounded exponential backoff.
 *
 * The delay is jittered so several workers retrying at once do not synchronise
 * into a thundering herd.
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 400;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const label = options.label ?? 'operation';

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = statusOf(error);

      const retryable = options.shouldRetry
        ? options.shouldRetry(error, attempt)
        : !isPermanent(status);

      if (!retryable || attempt === attempts) {
        recordFailure({
          label,
          attempts: attempt,
          message: error instanceof Error ? error.message : String(error),
          status,
        });
        throw error;
      }

      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * (exponential / 2));
      await new Promise((resolve) => setTimeout(resolve, exponential + jitter));
    }
  }
  throw lastError;
}

/**
 * A cheap self-critique pass over a generated answer.
 *
 * This is deliberately NOT another model call: a second inference would cost
 * money and latency, and the zero-cost constraint rules out paying for it. What
 * it does instead is catch the failure modes that are mechanically detectable
 * and that matter most — an empty answer, a refusal dressed up as an answer, a
 * citation claim with no sources, and a truncated response.
 *
 * Returns the issues found; an empty array means the answer passed.
 */
export function critiqueAnswer(
  answer: string,
  context: { expectsSources?: boolean; sourceCount?: number } = {},
): string[] {
  const issues: string[] = [];
  const trimmed = (answer || '').trim();

  if (!trimmed) {
    issues.push('The answer is empty.');
    return issues;
  }

  // A refusal is a legitimate answer, but it must not be presented as a result.
  if (/^(i can't|i cannot|i'm unable|i am unable|sorry,? i)/i.test(trimmed) && trimmed.length < 200) {
    issues.push('The answer is a refusal rather than a result.');
  }

  if (context.expectsSources && (context.sourceCount ?? 0) === 0) {
    issues.push('The answer was expected to cite sources but none were retrieved.');
  }

  // A response that stops mid-sentence is usually a truncated stream.
  if (trimmed.length > 200 && !/[.!?)\]}"'`]$/.test(trimmed)) {
    issues.push('The answer appears truncated.');
  }

  return issues;
}
