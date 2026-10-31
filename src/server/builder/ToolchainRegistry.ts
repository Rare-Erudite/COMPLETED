/**
 * RARE — Toolchain capability discovery
 *
 * Reports ONLY what was actually found on this machine. Each entry is produced
 * by probing a real executable with `--version` (or an equivalent) and reading
 * its output. Nothing is hardcoded as `detected: true`: when a tool is absent
 * the entry says so and names what a caller would need to install.
 *
 * Detection is cached per process because probing spawns subprocesses and the
 * result does not change while the server is running.
 */

import { execFile } from 'child_process';

export type ToolchainStatus = 'ready' | 'version_mismatch' | 'missing' | 'probe_failed';

export interface ToolchainProbe {
  /** Command to execute. */
  command: string;
  args: string[];
  /** The runtime/ecosystem this probe establishes. */
  id: string;
  name: string;
  domains: string[];
  /** Extracts a short version string from stdout, or null. */
  parse: (output: string) => string | null;
  /** Optional minimum major version; below it, status becomes version_mismatch. */
  minMajor?: number;
  /** What the operator must install when this probe fails. */
  installHint: string;
  /**
   * Per-probe timeout override, in ms.
   *
   * JVM-based probes (`gradle --version`) start a JVM before printing anything,
   * which routinely takes longer than a native binary's `--version`. With one
   * shared 4 s budget the probe timed out on a loaded CI runner and reported
   * `probe_failed` while a second probe of the same host reported `ready` — the
   * two disagreed and the route test caught it. Slow probes get their own budget.
   */
  timeoutMs?: number;
}

export interface ToolchainCapability {
  id: string;
  name: string;
  detected: boolean;
  version: string | null;
  status: ToolchainStatus;
  domains: string[];
  /** Populated only when the tool is not usable, so callers know the fix. */
  installHint?: string;
  /** Raw probe output (first line only) for provenance. */
  evidence?: string;
}

const PROBES: ToolchainProbe[] = [
  {
    id: 'node_ts',
    name: 'Node.js & TypeScript',
    command: 'node',
    args: ['--version'],
    domains: ['Web', 'Backend', 'CLI'],
    minMajor: 18,
    parse: (out) => {
      const match = out.match(/v(\d+\.\d+\.\d+)/);
      return match ? `Node ${match[1]}` : null;
    },
    installHint: 'Install Node.js 18 or newer from https://nodejs.org.',
  },
  {
    id: 'npm',
    name: 'npm package manager',
    command: 'npm',
    args: ['--version'],
    domains: ['Dependencies', 'Scripts'],
    parse: (out) => {
      const match = out.match(/(\d+\.\d+\.\d+)/);
      return match ? `npm ${match[1]}` : null;
    },
    installHint: 'npm ships with Node.js; reinstall Node.js if it is missing.',
  },
  {
    id: 'vite_bundler',
    name: 'Vite bundler (project dependency)',
    command: 'node',
    args: ['-e', "process.stdout.write(require('vite/package.json').version)"],
    domains: ['Web SPA', 'Static build'],
    parse: (out) => {
      const match = out.match(/(\d+\.\d+\.\d+[\w.-]*)/);
      return match ? `Vite ${match[1]}` : null;
    },
    installHint: 'Run `npm ci` in the project so the pinned Vite version is present.',
  },
  {
    id: 'python_runtime',
    name: 'Python 3 runtime',
    command: 'python3',
    args: ['--version'],
    domains: ['AI engine', 'Automation', 'CLI'],
    minMajor: 3,
    parse: (out) => {
      const match = out.match(/Python (\d+\.\d+\.\d+)/);
      return match ? `Python ${match[1]}` : null;
    },
    installHint: 'Install Python 3.10 or newer and ensure `python3` is on PATH.',
  },
  {
    id: 'git',
    name: 'Git',
    command: 'git',
    args: ['--version'],
    domains: ['Version control', 'Import existing projects'],
    parse: (out) => {
      const match = out.match(/git version (\S+)/);
      return match ? `Git ${match[1]}` : null;
    },
    installHint: 'Install Git so existing repositories can be imported and versioned.',
  },
  {
    id: 'rust_cargo',
    name: 'Rust toolchain',
    command: 'cargo',
    args: ['--version'],
    domains: ['Native libs', 'High performance'],
    parse: (out) => {
      const match = out.match(/cargo (\d+\.\d+\.\d+)/);
      return match ? `Cargo ${match[1]}` : null;
    },
    installHint: 'Install Rust via https://rustup.rs to build Cargo projects.',
  },
  {
    id: 'go_toolchain',
    name: 'Go toolchain',
    command: 'go',
    args: ['version'],
    domains: ['Services', 'CLI'],
    parse: (out) => {
      const match = out.match(/go(\d+\.\d+(?:\.\d+)?)/);
      return match ? `Go ${match[1]}` : null;
    },
    installHint: 'Install Go from https://go.dev/dl/ to build Go modules.',
  },
  {
    id: 'java_toolchain',
    name: 'Java / JVM',
    command: 'java',
    args: ['-version'],
    domains: ['Android', 'Enterprise services'],
    minMajor: 17,
    parse: (out) => {
      const match = out.match(/version "?(\d+(?:\.\d+)*)/);
      return match ? `Java ${match[1]}` : null;
    },
    installHint: 'Install a JDK (17 or newer) — required for Android and JVM builds.',
  },
  {
    id: 'android_gradle',
    name: 'Android Gradle build',
    command: 'gradle',
    args: ['--version'],
    domains: ['Android APK'],
    parse: (out) => {
      const match = out.match(/Gradle (\d+\.\d+(?:\.\d+)?)/);
      return match ? `Gradle ${match[1]}` : null;
    },
    installHint:
      'Android packaging needs a JDK plus the Android SDK (sdkmanager, build-tools, platform) and Gradle. None are required for web builds.',
    // Gradle boots a JVM before printing its version.
    timeoutMs: 20_000,
  },
  {
    id: 'docker',
    name: 'Container runtime',
    command: 'docker',
    args: ['--version'],
    domains: ['Isolated builds', 'Packaging'],
    parse: (out) => {
      const match = out.match(/Docker version (\S+?),/);
      return match ? `Docker ${match[1]}` : null;
    },
    installHint: 'Install Docker to run builds in an isolated container.',
  },
];

const PROBE_TIMEOUT_MS = 4000;

function probe(toolchain: ToolchainProbe): Promise<ToolchainCapability> {
  return new Promise((resolve) => {
    execFile(
      toolchain.command,
      toolchain.args,
      { timeout: toolchain.timeoutMs ?? PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        // `java -version` and some tools write version info to stderr.
        const output = `${stdout || ''}\n${stderr || ''}`.trim();
        const firstLine = output.split('\n').map((line) => line.trim()).filter(Boolean)[0] || '';

        if (error && !output) {
          const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
          resolve({
            id: toolchain.id,
            name: toolchain.name,
            detected: false,
            version: null,
            status: missing ? 'missing' : 'probe_failed',
            domains: toolchain.domains,
            installHint: toolchain.installHint,
            evidence: missing ? `${toolchain.command} not found on PATH` : error.message,
          });
          return;
        }

        const version = toolchain.parse(output);
        if (!version) {
          resolve({
            id: toolchain.id,
            name: toolchain.name,
            detected: false,
            version: null,
            status: 'probe_failed',
            domains: toolchain.domains,
            installHint: toolchain.installHint,
            evidence: firstLine || 'No version string in probe output',
          });
          return;
        }

        if (toolchain.minMajor !== undefined) {
          const majorMatch = version.match(/(\d+)/);
          const major = majorMatch ? Number(majorMatch[1]) : NaN;
          if (Number.isFinite(major) && major < toolchain.minMajor) {
            resolve({
              id: toolchain.id,
              name: toolchain.name,
              detected: true,
              version,
              status: 'version_mismatch',
              domains: toolchain.domains,
              installHint: `Requires major version ${toolchain.minMajor} or newer. ${toolchain.installHint}`,
              evidence: firstLine,
            });
            return;
          }
        }

        resolve({
          id: toolchain.id,
          name: toolchain.name,
          detected: true,
          version,
          status: 'ready',
          domains: toolchain.domains,
          evidence: firstLine,
        });
      }
    );
  });
}

let cachedCapabilities: ToolchainCapability[] | null = null;
let inFlight: Promise<ToolchainCapability[]> | null = null;

/** Detect every toolchain once per process. Concurrent callers share one run. */
export async function detectToolchains(force = false): Promise<ToolchainCapability[]> {
  if (!force && cachedCapabilities) return cachedCapabilities;
  if (!force && inFlight) return inFlight;

  inFlight = Promise.all(PROBES.map(probe)).then((capabilities) => {
    cachedCapabilities = capabilities;
    inFlight = null;
    return capabilities;
  });

  return inFlight;
}

/** Synchronous view for callers that already warmed the cache. */
export function getCachedToolchains(): ToolchainCapability[] | null {
  return cachedCapabilities;
}
