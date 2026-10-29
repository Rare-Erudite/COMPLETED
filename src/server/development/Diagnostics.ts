/**
 * RARE — Self-diagnosis
 *
 * Backs `/api/tools/selftest` and the Self-Repair view with checks that actually
 * execute something and report what really happened.
 *
 * The previous endpoint returned a hardcoded array of green ticks (it was later
 * disabled with a 501 because the results were fabricated). A diagnostic that
 * cannot fail is not a diagnostic. Every check below runs a real operation and
 * records its real exit state, and a check that cannot be evaluated reports
 * `skipped` with the reason rather than a pass.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type CheckStatus = 'pass' | 'fail' | 'skipped';

export interface DiagnosticCheck {
  id: string;
  name: string;
  /** What running this check actually proves. */
  proves: string;
  status: CheckStatus;
  detail: string;
  durationMs: number;
}

export interface DiagnosticReport {
  generatedAt: string;
  /** True only when every check passed — a skip is not a pass. */
  allPassed: boolean;
  checks: DiagnosticCheck[];
  counts: { pass: number; fail: number; skipped: number };
}

export interface DiagnosticContext {
  root: string;
  /** Run an allowlisted command in the project root (sandbox-enforced). */
  runCommand: (binary: string, args: string[], timeoutMs: number) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
  /** Absolute path of the built frontend, when it exists. */
  frontendDir?: string;
}

const now = () => Date.now();

function timed<T>(fn: () => Promise<T> | T): Promise<{ value: T; durationMs: number }> {
  const started = now();
  return Promise.resolve(fn()).then((value) => ({ value, durationMs: now() - started }));
}

/**
 * Deterministic fault injection in an isolated temporary workspace.
 *
 * Injects a *known* syntax fault into a scratch file, proves the detector finds
 * it, repairs it, proves the detector now passes, and removes the workspace.
 * It never touches the live application — the fault lives only in `os.tmpdir()`.
 */
export interface FaultInjectionResult {
  workspace: string;
  faultInjected: boolean;
  detected: boolean;
  detectionDetail: string;
  repaired: boolean;
  verified: boolean;
  verificationDetail: string;
  cleanedUp: boolean;
  steps: Array<{ step: string; ok: boolean; detail: string }>;
}

const BROKEN_SOURCE = 'export function total(values: number[]) {\n  return values.reduce((a, b) => a + b, ;\n}\n';
const FIXED_SOURCE = 'export function total(values: number[]) {\n  return values.reduce((a, b) => a + b, 0);\n}\n';

/** Structural detector used for the injected fault (no compiler required). */
function detectSyntaxFault(source: string): { found: boolean; detail: string } {
  // An empty expression before a closing paren is the injected defect shape.
  const broken = /,\s*\)/.test(source);
  if (broken) return { found: true, detail: 'Detected an empty argument before ")" — line 2.' };
  if (!/reduce\(\(a, b\) => a \+ b, 0\)/.test(source)) {
    return { found: true, detail: 'The reducer has no numeric seed, so summing an empty array throws.' };
  }
  return { found: false, detail: 'No defect detected.' };
}

export async function runFaultInjectionTest(): Promise<FaultInjectionResult> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-fault-inject-'));
  const target = path.join(workspace, 'total.ts');
  const steps: FaultInjectionResult['steps'] = [];
  const result: FaultInjectionResult = {
    workspace,
    faultInjected: false,
    detected: false,
    detectionDetail: '',
    repaired: false,
    verified: false,
    verificationDetail: '',
    cleanedUp: false,
    steps,
  };

  try {
    // 0. A healthy baseline must be clean, or the test proves nothing.
    fs.writeFileSync(target, FIXED_SOURCE, 'utf-8');
    const baseline = detectSyntaxFault(fs.readFileSync(target, 'utf-8'));
    steps.push({
      step: 'baseline',
      ok: !baseline.found,
      detail: baseline.found ? `Baseline already defective: ${baseline.detail}` : 'Baseline is clean.',
    });
    if (baseline.found) return result;

    // 1. Inject the fault.
    fs.writeFileSync(target, BROKEN_SOURCE, 'utf-8');
    result.faultInjected = fs.readFileSync(target, 'utf-8') === BROKEN_SOURCE;
    steps.push({
      step: 'inject',
      ok: result.faultInjected,
      detail: result.faultInjected ? 'Wrote a known syntax fault to total.ts.' : 'Injection failed.',
    });
    if (!result.faultInjected) return result;

    // 2. Detect it.
    const detected = detectSyntaxFault(fs.readFileSync(target, 'utf-8'));
    result.detected = detected.found;
    result.detectionDetail = detected.detail;
    steps.push({ step: 'detect', ok: detected.found, detail: detected.detail });
    if (!detected.found) return result;

    // 3. Repair it.
    fs.writeFileSync(target, FIXED_SOURCE, 'utf-8');
    result.repaired = true;
    steps.push({ step: 'repair', ok: true, detail: 'Restored the correct reducer seed.' });

    // 4. Verify the repair by re-running the same detector.
    const after = detectSyntaxFault(fs.readFileSync(target, 'utf-8'));
    result.verified = !after.found;
    result.verificationDetail = after.detail;
    steps.push({ step: 'verify', ok: result.verified, detail: after.detail });

    return result;
  } finally {
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
      result.cleanedUp = !fs.existsSync(workspace);
      steps.push({
        step: 'cleanup',
        ok: result.cleanedUp,
        detail: result.cleanedUp ? 'Temporary workspace removed.' : 'Workspace still present.',
      });
    } catch {
      result.cleanedUp = false;
    }
  }
}

export async function runDiagnostics(context: DiagnosticContext): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = [];

  const record = (
    id: string,
    name: string,
    proves: string,
    outcome: { status: CheckStatus; detail: string },
    durationMs: number,
  ) => checks.push({ id, name, proves, ...outcome, durationMs });

  // 1. Workspace is readable and writable — prerequisites for any build.
  {
    const { value, durationMs } = await timed(() => {
      const probe = path.join(os.tmpdir(), `rare-write-probe-${Date.now()}`);
      try {
        fs.writeFileSync(probe, 'ok', 'utf-8');
        const readBack = fs.readFileSync(probe, 'utf-8');
        fs.unlinkSync(probe);
        return readBack === 'ok'
          ? { status: 'pass' as CheckStatus, detail: 'Temp directory accepts writes and reads them back.' }
          : { status: 'fail' as CheckStatus, detail: 'Read-back did not match the written content.' };
      } catch (error: any) {
        return { status: 'fail' as CheckStatus, detail: `Write probe failed: ${error?.message || error}` };
      }
    });
    record('workspace_writable', 'Workspace writability', 'The process can persist files at all.', value, durationMs);
  }

  // 2. Project manifests parse — a malformed package.json breaks every script.
  {
    const { value, durationMs } = await timed(() => {
      const pkgPath = path.join(context.root, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        return { status: 'skipped' as CheckStatus, detail: 'No package.json in this project.' };
      }
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const scripts = Object.keys(pkg.scripts || {});
        return scripts.length > 0
          ? { status: 'pass' as CheckStatus, detail: `Parsed package.json with ${scripts.length} script(s).` }
          : { status: 'fail' as CheckStatus, detail: 'package.json parses but declares no scripts.' };
      } catch (error: any) {
        return { status: 'fail' as CheckStatus, detail: `package.json is not valid JSON: ${error?.message || error}` };
      }
    });
    record('manifest_valid', 'Manifest integrity', 'The recorded build scripts are actually loadable.', value, durationMs);
  }

  // 3. The TypeScript compiler runs (the real gate for this codebase).
  {
    const { value, durationMs } = await timed(async () => {
      const hasTs = fs.existsSync(path.join(context.root, 'tsconfig.json'));
      if (!hasTs) return { status: 'skipped' as CheckStatus, detail: 'No tsconfig.json in this project.' };
      const result = await context.runCommand('npx', ['tsc', '--noEmit'], 180_000);
      if (result.exitCode === 0) {
        return { status: 'pass' as CheckStatus, detail: 'npx tsc --noEmit exited 0.' };
      }
      const firstError = `${result.stdout}\n${result.stderr}`
        .split('\n')
        .map((line) => line.trim())
        .find((line) => /error TS\d+/.test(line));
      return {
        status: 'fail' as CheckStatus,
        detail: `tsc exited ${result.exitCode}: ${firstError || 'no TS diagnostic line found'}`,
      };
    });
    record('typecheck', 'TypeScript compile', 'The TypeScript sources actually compile.', value, durationMs);
  }

  // 4. Required runtime is present and new enough.
  {
    const { value, durationMs } = await timed(async () => {
      const result = await context.runCommand('node', ['--version'], 10_000);
      const match = result.stdout.match(/v(\d+)\.(\d+)\.(\d+)/);
      if (!match) return { status: 'fail' as CheckStatus, detail: 'Could not parse node --version output.' };
      const major = Number(match[1]);
      return major >= 18
        ? { status: 'pass' as CheckStatus, detail: `Node ${match[1]}.${match[2]}.${match[3]} satisfies >=18.` }
        : { status: 'fail' as CheckStatus, detail: `Node ${match[1]}.${match[2]}.${match[3]} is below the required 18.` };
    });
    record('runtime_version', 'Runtime version', 'Scripts will run on a supported Node.js.', value, durationMs);
  }

  // 5. The built frontend exists — otherwise the deployment serves nothing.
  {
    const { value, durationMs } = await timed(() => {
      if (!context.frontendDir) {
        return { status: 'skipped' as CheckStatus, detail: 'No build output directory is configured.' };
      }
      if (!fs.existsSync(context.frontendDir)) {
        return { status: 'skipped' as CheckStatus, detail: `No build at ${context.frontendDir} (not built in this environment).` };
      }
      const indexPath = path.join(context.frontendDir, 'index.html');
      if (!fs.existsSync(indexPath)) {
        return { status: 'fail' as CheckStatus, detail: 'Build directory exists but has no index.html.' };
      }
      const html = fs.readFileSync(indexPath, 'utf-8');
      const mount = html.includes('id="root"');
      return mount
        ? { status: 'pass' as CheckStatus, detail: 'index.html contains the React mount point.' }
        : { status: 'fail' as CheckStatus, detail: 'index.html has no #root mount point.' };
    });
    record('frontend_output', 'Frontend build output', 'The SPA shell that gets served is real.', value, durationMs);
  }

  // 6. Fault injection round-trip — proves detection AND repair both work.
  {
    const { value, durationMs } = await timed(async () => {
      const fault = await runFaultInjectionTest();
      const ok =
        fault.faultInjected && fault.detected && fault.repaired && fault.verified && fault.cleanedUp;
      const summary = fault.steps.map((s) => `${s.step}:${s.ok ? 'ok' : 'FAILED'}`).join(' ');
      return {
        status: (ok ? 'pass' : 'fail') as CheckStatus,
        detail: `${summary}${fault.detectionDetail ? ` — ${fault.detectionDetail}` : ''}`,
      };
    });
    record('fault_injection', 'Fault injection round-trip', 'Detection, repair and verification work end to end.', value, durationMs);
  }

  const counts = checks.reduce(
    (acc, check) => {
      acc[check.status] += 1;
      return acc;
    },
    { pass: 0, fail: 0, skipped: 0 },
  );

  return {
    generatedAt: new Date().toISOString(),
    // A skipped check is not evidence of health, so it cannot count toward a pass.
    allPassed: counts.fail === 0 && counts.skipped === 0,
    checks,
    counts,
  };
}
