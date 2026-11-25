/**
 * BuildRunner — execute a project's real build and test stages, capture the
 * evidence, and repair a failure when the repair is mechanical and safe.
 *
 * This is the piece that turns "RARE generated some source files" into "RARE
 * built and tested a project". Every stage returns the actual command, exit
 * code, duration and output tail. Nothing is inferred: a stage is `passed`
 * only when the process exited 0.
 *
 * Repair is deliberately narrow. It handles the class of failure that is
 * genuinely mechanical — a missing dependency directory, a stale build cache,
 * a missing output folder — and re-runs the stage. It does NOT rewrite the
 * user's source code to make a test pass, because that would be fabricating a
 * result. When a failure is not mechanical the runner reports it as `failed`
 * with the real output and stops.
 */

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { readProjectManifest, PROJECT_MANIFEST, type ProjectManifest } from './ProjectScaffolder.js';

export type StageName = 'install' | 'build' | 'test' | 'run';

export interface StageResult {
  stage: StageName;
  command: string;
  exitCode: number | null;
  passed: boolean;
  durationMs: number;
  /** Last lines of combined stdout/stderr. */
  output: string;
  /** True when this stage was skipped and why. */
  skippedReason?: string;
  /** Repair attempts made before this result. */
  repairs: RepairAttempt[];
}

export interface RepairAttempt {
  diagnosis: string;
  action: string;
  command: string | null;
  exitCode: number | null;
  resolved: boolean;
}

export interface BuildReport {
  project: string;
  relativeRoot: string;
  template: string;
  stages: StageResult[];
  /** Overall: every non-skipped stage passed. */
  passed: boolean;
  durationMs: number;
  /** Honest list of what could not be run. */
  limitations: string[];
}

const STAGE_TIMEOUT_MS = 180_000;

function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = STAGE_TIMEOUT_MS,
): Promise<{ code: number | null; output: string; durationMs: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, CI: '1' } },
      (error, stdout, stderr) => {
        const combined = `${stdout || ''}\n${stderr || ''}`.trim();
        const code = error
          ? typeof (error as any).code === 'number'
            ? (error as any).code
            : null
          : 0;
        resolve({ code, output: combined || (error ? error.message : ''), durationMs: Date.now() - started });
      },
    );
  });
}

function tail(text: string, lines = 25): string {
  return text.split('\n').filter(Boolean).slice(-lines).join('\n');
}

/**
 * Split a manifest command string into argv without a shell.
 *
 * The manifest is written by RARE itself, but it is still parsed rather than
 * handed to a shell: `execFile` with an argv array means a stray `;` in a
 * command cannot become a second command.
 */
function parseCommand(command: string): { bin: string; args: string[] } | null {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return { bin: parts[0], args: parts.slice(1) };
}

/**
 * Diagnose a failed stage and, when the cause is mechanical, fix it.
 *
 * Returns the attempts made. An empty array means the failure was not
 * something this runner is willing to "fix" — the caller must report it.
 */
async function attemptRepair(
  stage: StageName,
  result: { output: string },
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<RepairAttempt[]> {
  const attempts: RepairAttempt[] = [];
  const output = result.output;

  // 1. Missing node_modules: a dependency install was never run.
  const needsModules =
    /Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|npm ERR! missing/i.test(output);
  if (needsModules && fs.existsSync(path.join(projectRoot, 'package.json'))) {
    const install = await run('npm', ['install', '--no-audit', '--no-fund'], projectRoot);
    attempts.push({
      diagnosis: 'A required Node module was not present, so the dependency tree had never been installed.',
      action: 'Ran `npm install` in the project root.',
      command: 'npm install --no-audit --no-fund',
      exitCode: install.code,
      resolved: install.code === 0,
    });
    return attempts;
  }

  // 2. Stale build output: the build directory exists but is inconsistent.
  const staleBuild = /ENOENT.*dist|Cannot find.*dist\/|no such file.*dist/i.test(output);
  if (staleBuild) {
    const dist = path.join(projectRoot, 'dist');
    if (fs.existsSync(dist)) {
      fs.rmSync(dist, { recursive: true, force: true });
      attempts.push({
        diagnosis: 'The build output directory was present but incomplete, so the build read a half-written tree.',
        action: 'Removed the stale `dist/` directory so the build starts clean.',
        command: null,
        exitCode: null,
        resolved: true,
      });
    }
  }

  // 3. Python bytecode cache from a different interpreter version.
  const pyCache = /bad magic number|ModuleNotFoundError: No module named/i.test(output);
  if (pyCache) {
    const pycache = path.join(projectRoot, '__pycache__');
    if (fs.existsSync(pycache)) {
      fs.rmSync(pycache, { recursive: true, force: true });
      attempts.push({
        diagnosis: 'A `__pycache__` directory held bytecode from an incompatible interpreter.',
        action: 'Removed `__pycache__` so Python recompiles from source.',
        command: null,
        exitCode: null,
        resolved: true,
      });
    }
  }

  // 4. A test that asserts on a value the scaffold itself defines: re-running
  //    after a clean build is the only safe action. No source rewriting.
  if (stage === 'test' && /EACCES|permission denied/i.test(output)) {
    attempts.push({
      diagnosis: 'A file the test needs was not executable.',
      action: 'No automatic fix: changing file modes could mask a real packaging fault.',
      command: null,
      exitCode: null,
      resolved: false,
    });
  }

  return attempts;
}

async function runStage(
  stage: StageName,
  command: string | null,
  projectRoot: string,
  manifest: ProjectManifest,
  allowRepair: boolean,
): Promise<StageResult> {
  if (!command) {
    return {
      stage,
      command: '',
      exitCode: null,
      passed: true,
      durationMs: 0,
      output: '',
      skippedReason: `This project type has no ${stage} stage.`,
      repairs: [],
    };
  }

  const parsed = parseCommand(command);
  if (!parsed) {
    return {
      stage,
      command,
      exitCode: null,
      passed: false,
      durationMs: 0,
      output: '',
      skippedReason: 'The manifest command was empty.',
      repairs: [],
    };
  }

  let result = await run(parsed.bin, parsed.args, projectRoot);
  const repairs: RepairAttempt[] = [];

  if (result.code !== 0 && allowRepair) {
    const attempts = await attemptRepair(stage, result, projectRoot, manifest);
    repairs.push(...attempts);
    if (attempts.some((attempt) => attempt.resolved)) {
      result = await run(parsed.bin, parsed.args, projectRoot);
    }
  }

  return {
    stage,
    command,
    exitCode: result.code,
    passed: result.code === 0,
    durationMs: result.durationMs,
    output: tail(result.output),
    repairs,
  };
}

/**
 * Build and test a scaffolded project.
 *
 * `allowRepair` defaults to true: the assignment requires RARE to inspect a
 * failure, repair it where authorised and repeat the test. Pass false to
 * observe the raw failure (used by the failure-injection evidence run).
 */
export async function buildProject(
  workspaceRoot: string,
  relativeRoot: string,
  options: { allowRepair?: boolean; includeRun?: boolean } = {},
): Promise<BuildReport> {
  const started = Date.now();
  const projectRoot = path.resolve(workspaceRoot, relativeRoot);
  const manifest = readProjectManifest(projectRoot);
  const limitations: string[] = [];

  if (!manifest) {
    return {
      project: path.basename(relativeRoot),
      relativeRoot,
      template: 'unknown',
      stages: [],
      passed: false,
      durationMs: Date.now() - started,
      limitations: [`No ${PROJECT_MANIFEST} was found in ${relativeRoot}, so no stage command is known.`],
    };
  }

  const allowRepair = options.allowRepair !== false;
  const stages: StageResult[] = [];

  // Install first when the stack needs a registry. A failure here is reported,
  // not hidden: the build stage will then fail for a real reason.
  if (manifest.template === 'react-vite') {
    const install = await runStage('install', 'npm install --no-audit --no-fund', projectRoot, manifest, allowRepair);
    stages.push(install);
  }

  stages.push(await runStage('build', manifest.buildCommand, projectRoot, manifest, allowRepair));
  stages.push(await runStage('test', manifest.testCommand, projectRoot, manifest, allowRepair));

  if (options.includeRun && manifest.runCommand) {
    // A `run` stage for a server would block forever, so it is only executed
    // for templates whose run command terminates (CLI programs).
    if (manifest.template === 'node-cli' || manifest.template === 'python-cli') {
      stages.push(await runStage('run', manifest.runCommand, projectRoot, manifest, allowRepair));
    } else {
      limitations.push(
        `The ${manifest.template} run command starts a long-lived process, so it was not executed as a terminating stage.`,
      );
    }
  }

  const passed = stages.every((stage) => stage.passed);
  return {
    project: manifest.name,
    relativeRoot,
    template: manifest.template,
    stages,
    passed,
    durationMs: Date.now() - started,
    limitations,
  };
}

/** A compact summary suitable for a chat reply. */
export function summariseBuild(report: BuildReport): string {
  const lines = report.stages.map((stage) => {
    const status = stage.skippedReason ? 'skipped' : stage.passed ? 'passed' : 'FAILED';
    const repair = stage.repairs.length
      ? ` (${stage.repairs.filter((r) => r.resolved).length}/${stage.repairs.length} repairs applied)`
      : '';
    return `- ${stage.stage}: ${status}${repair} — \`${stage.command || 'n/a'}\` exit ${stage.exitCode ?? 'n/a'}`;
  });
  const header = report.passed
    ? `Build and tests passed for ${report.project} (${report.template}).`
    : `Build or tests FAILED for ${report.project} (${report.template}).`;
  return [header, ...lines, ...report.limitations.map((item) => `- limitation: ${item}`)].join('\n');
}
