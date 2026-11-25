/**
 * EnvironmentProvisioner — make a missing toolchain actually exist.
 *
 * The ToolchainRegistry only *reports* what is installed. That is not enough:
 * the assignment is explicit that RARE must not hand the user a "compiler
 * missing" message and stop. This module closes that gap for the toolchains
 * that can be provisioned from the Debian archive on this host.
 *
 * Design rules, all of them deliberate:
 *
 *   1. Nothing is claimed as installed until a fresh probe says `ready`. The
 *      install command's exit code alone is not evidence — apt can exit 0 while
 *      the binary is still absent (a virtual package, a renamed binary).
 *   2. Only a fixed, audited allowlist of packages can be installed. A caller
 *      cannot pass an arbitrary package name through to apt.
 *   3. Every attempt is recorded with the real command, exit code and the
 *      tail of its output, so the report can show what happened rather than
 *      assert success.
 *   4. A package that is not in the Debian archive (dotnet, kotlinc, swift,
 *      dart) is reported as `unavailable_from_archive` with the reason and the
 *      manual route. It is never silently skipped and never faked.
 *   5. No paid service, no network install script piped to a shell, no
 *      `curl | bash`. Only `apt-get install` of named packages.
 */

import { execFile } from 'child_process';
import { detectToolchains, type ToolchainCapability } from './ToolchainRegistry.js';

export type ProvisionOutcome =
  | 'already_ready'
  | 'installed'
  | 'install_failed'
  | 'unavailable_from_archive'
  | 'not_permitted';

export interface ProvisionStep {
  toolchainId: string;
  name: string;
  outcome: ProvisionOutcome;
  /** The exact command run, or null when nothing was run. */
  command: string | null;
  exitCode: number | null;
  /** Last lines of combined stdout/stderr, trimmed for the report. */
  output: string;
  /** Version string from the post-install probe, when it became ready. */
  version: string | null;
  /** Why this outcome, in plain language. */
  reason: string;
}

export interface ProvisionReport {
  requested: string[];
  steps: ProvisionStep[];
  /** Toolchains that are `ready` after this run. */
  ready: string[];
  /** Toolchains still not usable, with the reason. */
  stillMissing: Array<{ id: string; reason: string }>;
  durationMs: number;
}

/**
 * Audited map: toolchain id -> Debian package(s) that provide it.
 *
 * A toolchain absent from this map is treated as `not_permitted` — the
 * provisioner will not guess a package name for it.
 */
const PACKAGE_MAP: Record<string, string[]> = {
  gcc: ['gcc'],
  gpp: ['g++'],
  make: ['make'],
  php: ['php-cli'],
  maven: ['maven'],
  ruby: ['ruby-full'],
  ffmpeg: ['ffmpeg'],
  psql: ['postgresql-client'],
  git: ['git'],
  python_runtime: ['python3'],
  node_ts: ['nodejs'],
  npm: ['npm'],
  // These three are genuinely in the Debian archive, so they can be installed
  // rather than reported as missing. Leaving them out of this map made the
  // provisioner refuse to install a toolchain it could have provided.
  go_toolchain: ['golang-go'],
  rust_cargo: ['rustc', 'cargo'],
  java_toolchain: ['default-jdk-headless'],
  sqlite3: ['sqlite3'],
};

/**
 * Toolchains that exist but are NOT in the Debian archive. Recorded so the
 * report can say precisely why they cannot be auto-provisioned here.
 */
const NOT_IN_ARCHIVE: Record<string, string> = {
  dotnet: 'The .NET SDK is distributed by Microsoft, not Debian. Install from https://dotnet.microsoft.com/download or add the Microsoft package feed.',
  kotlinc: 'The Kotlin compiler is distributed as a GitHub release zip, not a Debian package. Install from https://github.com/JetBrains/kotlin/releases.',
  swift: 'Swift for Linux is a platform-specific toolchain from https://swift.org/download; it is not in the Debian archive.',
  dart: 'The Dart/Flutter SDK is distributed by Google, not Debian. Install from https://docs.flutter.dev/get-started/install.',
  android_gradle: 'Android packaging needs the Android SDK (sdkmanager, build-tools, platform) plus Gradle. The SDK is licensed and downloaded from Google, not Debian.',
  docker: 'A container runtime needs a daemon and kernel privileges that this sandbox does not grant. Install on a host you control.',
};

const APT_TIMEOUT_MS = 180_000;

function run(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const combined = `${stdout || ''}\n${stderr || ''}`.trim();
      if (error) {
        const code = typeof (error as any).code === 'number' ? (error as any).code : null;
        resolve({ code, output: combined || error.message });
        return;
      }
      resolve({ code: 0, output: combined });
    });
  });
}

function tail(text: string, lines = 12): string {
  return text.split('\n').filter(Boolean).slice(-lines).join('\n');
}

/**
 * Provision the named toolchains, or every known toolchain when `ids` is
 * omitted. Returns a report of what actually happened; it never throws for a
 * failed install, because a partial environment is a normal outcome that the
 * caller must be able to report honestly.
 */
export async function provisionToolchains(ids?: string[]): Promise<ProvisionReport> {
  const started = Date.now();
  const before = await detectToolchains(true);
  const byId = new Map(before.map((cap) => [cap.id, cap]));

  const requested = ids && ids.length > 0 ? ids : before.map((cap) => cap.id);
  const steps: ProvisionStep[] = [];

  for (const id of requested) {
    const capability = byId.get(id);
    if (!capability) {
      steps.push({
        toolchainId: id,
        name: id,
        outcome: 'not_permitted',
        command: null,
        exitCode: null,
        output: '',
        version: null,
        reason: `"${id}" is not a toolchain this registry knows about, so no package was guessed for it.`,
      });
      continue;
    }

    if (capability.status === 'ready') {
      steps.push({
        toolchainId: id,
        name: capability.name,
        outcome: 'already_ready',
        command: null,
        exitCode: null,
        output: capability.evidence || '',
        version: capability.version,
        reason: 'The probe already reported this toolchain as ready; nothing was installed.',
      });
      continue;
    }

    if (NOT_IN_ARCHIVE[id]) {
      steps.push({
        toolchainId: id,
        name: capability.name,
        outcome: 'unavailable_from_archive',
        command: null,
        exitCode: null,
        output: capability.evidence || '',
        version: null,
        reason: NOT_IN_ARCHIVE[id],
      });
      continue;
    }

    const packages = PACKAGE_MAP[id];
    if (!packages) {
      steps.push({
        toolchainId: id,
        name: capability.name,
        outcome: 'not_permitted',
        command: null,
        exitCode: null,
        output: capability.evidence || '',
        version: null,
        reason: 'No audited package mapping exists for this toolchain, so the provisioner refused to install anything.',
      });
      continue;
    }

    const command = `apt-get install -y ${packages.join(' ')}`;
    let result = await run('apt-get', ['install', '-y', ...packages], APT_TIMEOUT_MS);

    // A stale package index is the single most common reason an install fails
    // with "404 Not Found" for a package that plainly exists: the index still
    // points at a version the mirror has since replaced. Refresh the index and
    // retry once before declaring the toolchain uninstallable. Without this the
    // provisioner reported a real, installable toolchain as permanently missing.
    if (result.code !== 0 && /404\s+Not Found|Failed to fetch|Unable to fetch some archives/i.test(result.output)) {
      const refresh = await run('apt-get', ['update'], APT_TIMEOUT_MS);
      if (refresh.code === 0) {
        result = await run('apt-get', ['install', '-y', ...packages], APT_TIMEOUT_MS);
      }
    }

    // Re-probe: the exit code is not evidence, the probe is.
    const after = await detectToolchains(true);
    const refreshed = after.find((cap) => cap.id === id);

    if (refreshed?.status === 'ready') {
      steps.push({
        toolchainId: id,
        name: capability.name,
        outcome: 'installed',
        command,
        exitCode: result.code,
        output: tail(result.output),
        version: refreshed.version,
        reason: 'Installed and confirmed by a fresh probe.',
      });
    } else {
      steps.push({
        toolchainId: id,
        name: capability.name,
        outcome: 'install_failed',
        command,
        exitCode: result.code,
        output: tail(result.output),
        version: null,
        reason: `The install command exited ${result.code ?? 'without a code'} but the probe still reports "${refreshed?.status ?? 'unknown'}".`,
      });
    }
  }

  const final = await detectToolchains(true);
  const ready = final.filter((cap) => cap.status === 'ready').map((cap) => cap.id);
  const stillMissing = final
    .filter((cap) => cap.status !== 'ready')
    .map((cap) => ({
      id: cap.id,
      reason:
        steps.find((step) => step.toolchainId === cap.id)?.reason ||
        cap.installHint ||
        'Not ready after provisioning.',
    }));

  return { requested, steps, ready, stillMissing, durationMs: Date.now() - started };
}

/**
 * Which toolchains a project of a given kind actually needs. Used by the
 * orchestrator to provision only what a task requires instead of installing
 * everything on every run.
 */
export const PROJECT_REQUIREMENTS: Record<string, string[]> = {
  'node-cli': ['node_ts', 'npm'],
  'node-api': ['node_ts', 'npm'],
  'static-web': ['node_ts', 'npm'],
  'python-cli': ['python_runtime'],
  'react-vite': ['node_ts', 'npm'],
  'c-cli': ['gcc', 'make'],
  'cpp-cli': ['gpp', 'make'],
  'php-web': ['php'],
  'java-cli': ['java_toolchain'],
  'go-cli': ['go_toolchain'],
  'rust-cli': ['rust_cargo'],
  'android-app': ['java_toolchain', 'android_gradle'],
};

export function requirementsFor(kind: string): string[] {
  return PROJECT_REQUIREMENTS[kind] || [];
}

/** A compact, human-readable summary for a chat reply. */
export function summariseProvisioning(report: ProvisionReport): string {
  const installed = report.steps.filter((step) => step.outcome === 'installed');
  const failed = report.steps.filter((step) => step.outcome === 'install_failed');
  const blocked = report.steps.filter(
    (step) => step.outcome === 'unavailable_from_archive' || step.outcome === 'not_permitted',
  );
  const parts: string[] = [];
  if (installed.length) {
    parts.push(`Installed: ${installed.map((step) => `${step.name} (${step.version})`).join(', ')}.`);
  }
  if (failed.length) {
    parts.push(`Install failed: ${failed.map((step) => step.name).join(', ')}.`);
  }
  if (blocked.length) {
    parts.push(`Cannot auto-install here: ${blocked.map((step) => step.name).join(', ')}.`);
  }
  if (!parts.length) parts.push('Every requested toolchain was already ready.');
  return parts.join(' ');
}
