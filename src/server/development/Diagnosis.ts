/**
 * RARE — Failure diagnosis
 *
 * The previous engine "diagnosed" every failure the same way — it restored the
 * checkpoint and called that a repair. Restoring a snapshot is a *recovery*, not
 * a diagnosis: it tells you nothing about why the check failed and it silently
 * discards the change the developer asked for.
 *
 * This module classifies real command output into a cause, points at the file and
 * line when the output says so, and proposes a concrete, bounded remediation the
 * caller can either apply or report as requiring developer intervention.
 */

export type FailureClass =
  | 'type_error'
  | 'syntax_error'
  | 'missing_module'
  | 'missing_file'
  | 'test_assertion'
  | 'build_failure'
  | 'permission_denied'
  | 'timeout'
  | 'unknown';

export interface Diagnosis {
  classification: FailureClass;
  /** One-line cause suitable for a progress event. */
  summary: string;
  /** File the failure points at, workspace-relative, when detected. */
  file?: string;
  line?: number;
  /** The offending source line, when the compiler printed it. */
  excerpt?: string;
  /** What the engine can do about it without a human. */
  remediation:
    | { type: 'retry'; reason: string }
    | { type: 'restore'; reason: string }
    | { type: 'developer'; reason: string };
  /** Raw first meaningful line, for provenance. */
  evidence: string;
}

const TS_ERROR = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/m;
const GENERIC_FILE_LINE = /([A-Za-z0-9_@./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|css)):(\d+):(\d+)?:?\s*(.*)$/m;

function firstMeaningfulLine(output: string): string {
  return (
    output
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('>') && !line.startsWith('npm ERR!')) || ''
  );
}

export function diagnoseFailure(output: string, exitCode: number, phase: string): Diagnosis {
  const text = output || '';
  const evidence = firstMeaningfulLine(text).slice(0, 300) || `${phase} exited ${exitCode}`;

  // 1. TypeScript compiler diagnostics carry file + line + code.
  const ts = text.match(TS_ERROR);
  if (ts) {
    const [, file, line, , code, message] = ts;
    const remediation =
      code === 'TS2307' || /Cannot find module/.test(message)
        ? { type: 'developer' as const, reason: `Missing module — installing a dependency changes the lockfile and needs a human decision.` }
        : { type: 'retry' as const, reason: `A single type error in ${file} is usually fixable by adjusting the named import or signature.` };
    return {
      classification: code === 'TS2307' ? 'missing_module' : 'type_error',
      summary: `${code}: ${message}`.slice(0, 240),
      file,
      line: Number(line),
      remediation,
      evidence,
    };
  }

  // 2. Missing module at runtime/bundle time.
  const cannotFind = text.match(/Cannot find module '([^']+)'/);
  if (cannotFind) {
    return {
      classification: 'missing_module',
      summary: `Module '${cannotFind[1]}' is not installed or not resolvable.`,
      remediation: { type: 'developer', reason: `Installing '${cannotFind[1]}' modifies package.json and the lockfile; that is a dependency decision, not a repair.` },
      evidence,
    };
  }

  if (/ENOENT/.test(text) && /no such file/i.test(text)) {
    return {
      classification: 'missing_file',
      summary: 'A required file or directory does not exist.',
      remediation: { type: 'restore', reason: 'The change referenced a path that is absent; the checkpoint is the known-good state.' },
      evidence,
    };
  }

  if (/EACCES|permission denied|EPERM/i.test(text)) {
    return {
      classification: 'permission_denied',
      summary: 'The sandbox denied a filesystem or process operation.',
      remediation: { type: 'developer', reason: 'Permission boundaries are enforced deliberately and must not be bypassed by an automated repair.' },
      evidence,
    };
  }

  if (/timeout|ETIMEDOUT|exceeded \d+ ?ms/i.test(text)) {
    return {
      classification: 'timeout',
      summary: `${phase} exceeded its time budget.`,
      remediation: { type: 'retry', reason: 'Transient resource contention; one bounded retry is appropriate.' },
      evidence,
    };
  }

  if (/SyntaxError|Unexpected token|Unexpected end of input|Expected correspond/i.test(text)) {
    const g = text.match(GENERIC_FILE_LINE);
    return {
      classification: 'syntax_error',
      summary: g ? `Syntax error near ${g[1]}:${g[2]}` : 'The output contains a syntax error.',
      file: g?.[1],
      line: g ? Number(g[2]) : undefined,
      remediation: { type: 'retry', reason: 'A syntax error is deterministic and located; a targeted fix is safe to attempt.' },
      evidence,
    };
  }

  if (/AssertionError|expected .* to (be|equal)|✗|FAIL\s/.test(text)) {
    const g = text.match(GENERIC_FILE_LINE);
    return {
      classification: 'test_assertion',
      summary: 'A test assertion failed.',
      file: g?.[1],
      line: g ? Number(g[2]) : undefined,
      remediation: { type: 'developer', reason: 'A failing assertion means the requested behaviour is not implemented; rewriting the test to pass would hide the defect.' },
      evidence,
    };
  }

  if (exitCode !== 0) {
    return {
      classification: 'build_failure',
      summary: `${phase} failed with exit code ${exitCode}.`,
      remediation: { type: 'restore', reason: 'No specific cause could be extracted; the verified checkpoint is the safe end state.' },
      evidence,
    };
  }

  return {
    classification: 'unknown',
    summary: `${phase} produced no actionable diagnostic.`,
    remediation: { type: 'developer', reason: 'Without a cause the engine will not guess at the source.' },
    evidence,
  };
}
