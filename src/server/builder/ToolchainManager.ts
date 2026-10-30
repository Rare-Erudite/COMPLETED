/**
 * RARE — Managed toolchain manager
 *
 * The existing ToolchainRegistry probes a handful of executables with
 * `--version` and returns an install hint when one is missing. That is useful
 * for display, but it cannot answer the question a build actually asks:
 * "can this project be built here, and if not, what exactly is missing?"
 *
 * This module adds the missing half:
 *
 *   detectProject()   — what is this project? Derived from manifests, lockfiles
 *                       and metadata, not from a hardcoded list.
 *   assessProject()   — which of its requirements are satisfied, and for each
 *                       unmet one, *why*: absent / probe failed / version too
 *                       old / platform-restricted / dependency resolution.
 *   provision()       — install a missing toolchain through a per-ecosystem
 *                       adapter into an isolated, reusable cache directory, and
 *                       record what was installed, why, and for which project.
 *   buildPlan()       — the ordered steps that would build this project, with
 *                       the capability each step needs.
 *
 * Provisioning is real for the ecosystems that have a portable, checksum-
 * verifiable runtime (see RuntimeAdapters.ts): Node.js, CPython and the Dart
 * SDK. Each install downloads from the publisher, verifies SHA-256 against the
 * publisher's own manifest, unpacks into an isolated prefix and then *runs* the
 * binary before anything is reported as installed.
 *
 * Deliberate limits, stated rather than hidden:
 *   - A capability with no adapter is reported `unavailable` **with the real
 *     reason** (licence, root, multi-GB bundle, not-yet-written adapter) rather
 *     than silently succeeding or silently doing nothing.
 *   - The cache is never trusted on existence alone: a cached prefix is
 *     re-verified by executing the binary, so a corrupt or half-extracted
 *     toolchain triggers a reinstall instead of a confusing later failure.
 *   - Provisioning is opt-in. `new ToolchainManager({...})` without adapters
 *     assesses only and never touches the network; `ToolchainManager.create()`
 *     wires the real adapters for actual builds.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

import { detectToolchains, ToolchainCapability } from './ToolchainRegistry.js';

// -----------------------------------------------------------------------------
// Project detection
// -----------------------------------------------------------------------------

export type Ecosystem =
  | 'node'
  | 'python'
  | 'dart'
  | 'java'
  | 'rust'
  | 'go'
  | 'dotnet'
  | 'c'
  | 'unknown';

export interface ProjectProfile {
  root: string;
  ecosystems: Ecosystem[];
  /** Frameworks/languages identified from real files. */
  frameworks: string[];
  /** Manifests that were found, workspace-relative. */
  manifests: string[];
  packageManagers: string[];
  /** Scripts the project declares, for build planning. */
  scripts: Record<string, string>;
  /** Capabilities the project needs in order to build. */
  requiredCapabilities: string[];
}

const MANIFEST_SIGNALS: Array<{
  file: string;
  ecosystem: Ecosystem;
  label: string;
  capability: string;
}> = [
  { file: 'package.json', ecosystem: 'node', label: 'Node.js', capability: 'node_ts' },
  { file: 'tsconfig.json', ecosystem: 'node', label: 'TypeScript', capability: 'node_ts' },
  { file: 'vite.config.ts', ecosystem: 'node', label: 'Vite', capability: 'vite_bundler' },
  { file: 'vite.config.js', ecosystem: 'node', label: 'Vite', capability: 'vite_bundler' },
  { file: 'next.config.js', ecosystem: 'node', label: 'Next.js', capability: 'node_ts' },
  { file: 'pyproject.toml', ecosystem: 'python', label: 'Python (pyproject)', capability: 'python_runtime' },
  { file: 'requirements.txt', ecosystem: 'python', label: 'Python (requirements)', capability: 'python_runtime' },
  { file: 'Pipfile', ecosystem: 'python', label: 'Python (Pipfile)', capability: 'python_runtime' },
  { file: 'pubspec.yaml', ecosystem: 'dart', label: 'Dart/Flutter', capability: 'dart_sdk' },
  { file: 'pom.xml', ecosystem: 'java', label: 'Java (Maven)', capability: 'java_toolchain' },
  { file: 'build.gradle', ecosystem: 'java', label: 'Java (Gradle)', capability: 'java_toolchain' },
  { file: 'build.gradle.kts', ecosystem: 'java', label: 'Java (Gradle Kotlin)', capability: 'java_toolchain' },
  { file: 'Cargo.toml', ecosystem: 'rust', label: 'Rust', capability: 'rust_cargo' },
  { file: 'go.mod', ecosystem: 'go', label: 'Go', capability: 'go_toolchain' },
  { file: 'CMakeLists.txt', ecosystem: 'c', label: 'C/C++ (CMake)', capability: 'c_compiler' },
  { file: 'Makefile', ecosystem: 'c', label: 'C/C++ (Make)', capability: 'c_compiler' },
];

const DOTNET_SIGNALS = ['.csproj', '.fsproj', '.sln'];

const LOCKFILE_TO_PM: Array<{ file: string; pm: string }> = [
  { file: 'package-lock.json', pm: 'npm' },
  { file: 'pnpm-lock.yaml', pm: 'pnpm' },
  { file: 'yarn.lock', pm: 'yarn' },
  { file: 'bun.lockb', pm: 'bun' },
  { file: 'poetry.lock', pm: 'poetry' },
  { file: 'Pipfile.lock', pm: 'pipenv' },
  { file: 'Cargo.lock', pm: 'cargo' },
  { file: 'go.sum', pm: 'go modules' },
  { file: 'pubspec.lock', pm: 'pub' },
];

/** Read a project's real shape. Missing files are simply absent, not errors. */
export function detectProject(root: string): ProjectProfile {
  const ecosystems: Ecosystem[] = [];
  const frameworks: string[] = [];
  const manifests: string[] = [];
  const requiredCapabilities: string[] = [];
  let scripts: Record<string, string> = {};

  for (const signal of MANIFEST_SIGNALS) {
    const full = path.join(root, signal.file);
    if (!fs.existsSync(full)) continue;
    manifests.push(signal.file);
    if (!ecosystems.includes(signal.ecosystem)) ecosystems.push(signal.ecosystem);
    if (!frameworks.includes(signal.label)) frameworks.push(signal.label);
    if (!requiredCapabilities.includes(signal.capability)) requiredCapabilities.push(signal.capability);
  }

  // .NET is identified by extension, not a fixed filename.
  try {
    const entries = fs.readdirSync(root);
    const dotnet = entries.filter((entry) => DOTNET_SIGNALS.some((ext) => entry.endsWith(ext)));
    if (dotnet.length > 0) {
      if (!ecosystems.includes('dotnet')) ecosystems.push('dotnet');
      if (!frameworks.includes('.NET')) frameworks.push('.NET');
      manifests.push(...dotnet);
      if (!requiredCapabilities.includes('dotnet_sdk')) requiredCapabilities.push('dotnet_sdk');
    }
  } catch {
    // Unreadable root: nothing to detect.
  }

  // package.json decides the package manager from its lockfile, and tells us
  // which scripts exist — a build plan must not invent `npm run build` if the
  // project never declared it.
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const [name, label] of [
        ['react', 'React'],
        ['vue', 'Vue'],
        ['@angular/core', 'Angular'],
        ['svelte', 'Svelte'],
        ['express', 'Express'],
        ['fastify', 'Fastify'],
        ['typescript', 'TypeScript'],
        ['vite', 'Vite'],
      ] as const) {
        if (deps[name] && !frameworks.includes(label)) frameworks.push(label);
      }
    } catch {
      // A malformed manifest is reported by diagnostics, not here.
    }
  }

  const packageManagers: string[] = [];
  for (const { file, pm } of LOCKFILE_TO_PM) {
    if (fs.existsSync(path.join(root, file))) packageManagers.push(pm);
  }
  if (packageManagers.length === 0 && ecosystems.includes('node')) {
    packageManagers.push('npm (no lockfile — installs are not reproducible)');
  }

  return {
    root,
    ecosystems: ecosystems.length > 0 ? ecosystems : ['unknown'],
    frameworks,
    manifests,
    packageManagers,
    scripts,
    requiredCapabilities,
  };
}

// -----------------------------------------------------------------------------
// Requirement assessment
// -----------------------------------------------------------------------------

export type RequirementState =
  | 'satisfied'
  | 'missing'
  | 'version_mismatch'
  | 'probe_failed'
  | 'platform_restricted'
  | 'unknown';

export interface RequirementAssessment {
  capability: string;
  /** What the project needs this for. */
  purpose: string;
  state: RequirementState;
  /** Detected toolchain record, when the probe produced one. */
  toolchain?: ToolchainCapability;
  /** Plain-language reason, always populated when the state is not satisfied. */
  reason?: string;
  /** True when RARE can install this without a human decision. */
  provisionable: boolean;
}

const CAPABILITY_PURPOSE: Record<string, string> = {
  node_ts: 'Run and type-check JavaScript/TypeScript',
  node_runtime: "Build against the project's pinned Node.js version",
  vite_bundler: 'Bundle the frontend',
  python_runtime: 'Run Python services and scripts',
  dart_sdk: 'Build Dart/Flutter applications',
  java_toolchain: 'Build Android and JVM targets',
  rust_cargo: 'Compile Rust crates',
  go_toolchain: 'Build Go modules',
  dotnet_sdk: 'Build .NET projects',
  c_compiler: 'Compile native C/C++ sources',
  npm: 'Install JavaScript dependencies',
  git: 'Import and version projects',
};

/**
 * Capabilities the current probe set cannot report on at all. Naming them is
 * more honest than silently treating "not probed" as "not needed": a Dart
 * project on a machine with no Dart probe is unknown, not ready.
 */
const UNPROBED_CAPABILITIES = new Set(['dart_sdk', 'dotnet_sdk', 'c_compiler']);

export async function assessProject(
  profile: ProjectProfile,
  options: { platform?: NodeJS.Platform } = {},
): Promise<RequirementAssessment[]> {
  const platform = options.platform || process.platform;
  const toolchains = await detectToolchains();
  const byId = new Map(toolchains.map((toolchain) => [toolchain.id, toolchain]));

  const assessments: RequirementAssessment[] = profile.requiredCapabilities.map((capability) => {
    const purpose = CAPABILITY_PURPOSE[capability] || capability;

    if (UNPROBED_CAPABILITIES.has(capability)) {
      // No probe exists for this capability. If RARE can install it, that is the
      // honest answer: "we cannot confirm it is present, but we can make it so".
      // Only when it is neither probeable nor installable is it genuinely
      // `unknown`.
      const installable = REAL_PROVISIONABLE_CAPABILITIES.includes(capability);
      return {
        capability,
        purpose,
        state: (installable ? 'missing' : 'unknown') as RequirementState,
        reason: installable
          ? `RARE has no probe for ${capability}, but can provision a verified runtime for it.`
          : `RARE has no probe for ${capability}, so its presence is unknown rather than assumed.`,
        provisionable: installable,
      };
    }

    const toolchain = byId.get(capability);
    if (!toolchain) {
      return {
        capability,
        purpose,
        state: 'unknown' as RequirementState,
        reason: `No registered probe covers ${capability}.`,
        provisionable: false,
      };
    }

    if (toolchain.status === 'ready') {
      return { capability, purpose, state: 'satisfied' as RequirementState, toolchain, provisionable: false };
    }
    if (toolchain.status === 'missing') {
      return {
        capability,
        purpose,
        state: 'missing' as RequirementState,
        toolchain,
        reason: toolchain.evidence || `${toolchain.name} is not installed.`,
        provisionable: provisionability(capability, platform).ok,
      };
    }
    if (toolchain.status === 'version_mismatch') {
      return {
        capability,
        purpose,
        state: 'version_mismatch' as RequirementState,
        toolchain,
        reason: toolchain.installHint || `${toolchain.name} is below the required version.`,
        provisionable: false,
      };
    }
    return {
      capability,
      purpose,
      state: 'probe_failed' as RequirementState,
      toolchain,
      reason: toolchain.evidence || `${toolchain.name} is installed but did not report a version.`,
      provisionable: false,
    };
  });

  return assessments;
}

/** Can RARE install this itself? Only where an adapter exists and the OS allows it. */
export function provisionability(
  capability: string,
  platform: NodeJS.Platform = process.platform,
): { ok: boolean; reason: string } {
  if (platform === 'win32') {
    return { ok: false, reason: 'Automatic provisioning is not implemented for Windows.' };
  }
  if (capability === 'node_ts') {
    return { ok: false, reason: 'Node.js is the runtime hosting RARE; replacing it at runtime is unsafe.' };
  }
  if (capability === 'java_toolchain') {
    return {
      ok: false,
      reason: 'A JDK install requires accepting a licence and root privileges; RARE will not do that unattended.',
    };
  }
  if (capability === 'python_runtime') {
    return { ok: true, reason: 'python-build-standalone ships a self-contained CPython that unpacks into the RARE cache.' };
  }
  if (capability === 'node_runtime') {
    return { ok: true, reason: 'The official Node.js dist tarball unpacks into the RARE cache without touching the host runtime.' };
  }
  if (capability === 'dart_sdk') {
    return { ok: true, reason: 'The Dart SDK archive unpacks into the RARE cache.' };
  }
  if (capability === 'rust_cargo') {
    // rustup is deliberately NOT wired up: it has its own network trust root and
    // installs a mutable toolchain, which is a different security model from a
    // single checksum-verified archive.
    return { ok: false, reason: 'rustup provisioning is not implemented; the adapter is planned, not present.' };
  }
  if (capability === 'go_toolchain') {
    return { ok: false, reason: 'The Go adapter is planned but not implemented in this build.' };
  }
  return { ok: false, reason: `No provisioning adapter exists for ${capability}.` };
}

// -----------------------------------------------------------------------------
// Provisioning
// -----------------------------------------------------------------------------

export interface ProvisionRecord {
  capability: string;
  /** Directory the adapter was told to install into. */
  targetDir: string;
  status: 'installed' | 'already_present' | 'unavailable' | 'failed';
  detail: string;
  at: string;
  projectRoot: string;
  /** `real` for a genuine upstream install, `simulated` for a test double. */
  adapterKind?: 'real' | 'simulated';
  /** Upstream project the artifact came from, when known. */
  upstream?: string;
  /** Installed runtime version, read from the binary that was verified. */
  version?: string;
  /** Bytes written to the prefix, when the adapter could measure it. */
  bytes?: number;
}

export interface ToolchainAdapter {
  capability: string;
  /** Human label, e.g. "Portable Python 3". */
  label: string;
  /**
   * `real` when the adapter genuinely downloads and installs an upstream
   * artifact; `simulated` when it only exists for unit tests. Callers and the UI
   * must not present the two as equivalent.
   */
  kind?: 'real' | 'simulated';
  /** Upstream project the artifact comes from, for the provenance record. */
  upstream?: string;
  /** Probe the tool at `prefix` (not on PATH). */
  verify: (prefix: string) => Promise<{ ok: boolean; detail: string }>;
  /** Perform the install. Must resolve only when the binary verifies. */
  install: (prefix: string) => Promise<{ ok: boolean; detail: string }>;
}

/**
 * Capabilities RARE ships a real, checksum-verifying installer for. Kept here
 * (rather than importing RuntimeAdapters, which would be a cycle) so
 * `assessProject` can report a missing tool as *provisionable* instead of
 * unknown. RuntimeAdapters asserts its set matches this one.
 */
export const REAL_PROVISIONABLE_CAPABILITIES: readonly string[] = [
  'node_runtime',
  'python_runtime',
  'dart_sdk',
];

export class ToolchainManager {
  private readonly cacheRoot: string;
  private readonly manifestPath: string;
  private readonly adapters: Map<string, ToolchainAdapter>;
  /** Total bytes provisioning may occupy across all prefixes. */
  private readonly diskBudgetBytes: number;

  constructor(options: {
    cacheRoot?: string;
    adapters?: ToolchainAdapter[];
    diskBudgetBytes?: number;
  } = {}) {
    this.cacheRoot = options.cacheRoot
      || process.env.RARE_TOOLCHAIN_CACHE
      || path.join(os.tmpdir(), 'rare-toolchain-cache');
    this.manifestPath = path.join(this.cacheRoot, 'provisioned.json');
    this.adapters = new Map((options.adapters || []).map((adapter) => [adapter.capability, adapter]));
    // The base app must stay small, so provisioned runtimes are budgeted. The
    // default is generous for one or two runtimes but far below "bundle every
    // SDK": a Node tarball is ~50 MB unpacked, CPython ~60 MB, Dart ~200 MB.
    this.diskBudgetBytes = options.diskBudgetBytes
      ?? Number(process.env.RARE_TOOLCHAIN_BUDGET_BYTES || 900 * 1024 * 1024);
  }

  public getCacheRoot(): string {
    return this.cacheRoot;
  }

  /** The capabilities this manager can genuinely install. */
  public installedAdapterCapabilities(): string[] {
    return Array.from(this.adapters.keys());
  }

  /** Byte size of a prefix on disk, or 0 when absent. */
  public prefixBytes(capability: string): number {
    return directorySize(this.prefixFor(capability));
  }

  /** Total bytes currently held across every provisioned prefix. */
  public cacheBytes(): number {
    return directorySize(this.cacheRoot);
  }

  public getDiskBudgetBytes(): number {
    return this.diskBudgetBytes;
  }

  /** Every provisioning this environment knows about. */
  public readManifest(): ProvisionRecord[] {
    try {
      if (!fs.existsSync(this.manifestPath)) return [];
      const parsed = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeManifest(records: ProvisionRecord[]): void {
    fs.mkdirSync(this.cacheRoot, { recursive: true });
    fs.writeFileSync(this.manifestPath, JSON.stringify(records, null, 2), 'utf-8');
  }

  private prefixFor(capability: string): string {
    return path.join(this.cacheRoot, capability);
  }

  /**
   * Make `capability` usable, reusing a verified cached install when possible.
   *
   * The cache is only trusted after re-verification: a directory existing is not
   * evidence that the tool works.
   */
  public async provision(
    capability: string,
    context: { projectRoot: string; platform?: NodeJS.Platform; signal?: AbortSignal },
  ): Promise<ProvisionRecord> {
    const platform = context.platform || process.platform;
    const at = new Date().toISOString();
    const targetDir = this.prefixFor(capability);

    const adapter = this.adapters.get(capability);
    if (!adapter) {
      const verdict = provisionability(capability, platform);
      return {
        capability,
        targetDir,
        status: 'unavailable',
        detail: verdict.reason,
        at,
        projectRoot: context.projectRoot,
      };
    }

    // 1. Reuse only if the cached tool still verifies. A prefix that exists but
    //    whose binary will not run is a broken toolchain, not a cached one.
    if (fs.existsSync(targetDir)) {
      const verification = await adapter.verify(targetDir).catch((error: any) => ({
        ok: false,
        detail: error?.message || String(error),
      }));
      if (verification.ok) {
        return {
          capability,
          targetDir,
          status: 'already_present',
          detail: `Reused verified cache: ${verification.detail}`,
          at,
          projectRoot: context.projectRoot,
          adapterKind: adapter.kind,
          upstream: adapter.upstream,
          version: extractVersion(verification.detail),
          bytes: this.prefixBytes(capability),
        };
      }
    }

    // 2. Refuse before downloading if the cache budget is already exhausted.
    //    Checking after the download would waste the bandwidth and could fill
    //    the disk the app itself lives on.
    const budget = this.checkBudget(capability);
    if (!budget.ok) {
      const record: ProvisionRecord = {
        capability,
        targetDir,
        status: 'unavailable',
        detail: budget.reason,
        at,
        projectRoot: context.projectRoot,
        adapterKind: adapter.kind,
      };
      this.recordProvision(record);
      return record;
    }

    // 3. Install through the adapter, then verify before reporting success.
    let installed: { ok: boolean; detail: string };
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      installed = await adapter.install(targetDir);
    } catch (error: any) {
      installed = { ok: false, detail: error?.message || String(error) };
    }

    if (!installed.ok) {
      // A failed install must not leave a half-written prefix behind, or the
      // next run would "reuse" it. Remove only that capability's directory —
      // never the cache root, which may hold other working runtimes.
      this.removePrefix(capability);
      const record: ProvisionRecord = {
        capability,
        targetDir,
        status: 'unavailable',
        detail: installed.detail,
        at,
        projectRoot: context.projectRoot,
        adapterKind: adapter.kind,
        upstream: adapter.upstream,
      };
      this.recordProvision(record);
      return record;
    }

    const verification = await adapter.verify(targetDir).catch((error: any) => ({
      ok: false,
      detail: error?.message || String(error),
    }));

    if (!verification.ok) this.removePrefix(capability);

    const record: ProvisionRecord = {
      capability,
      targetDir,
      status: verification.ok ? 'installed' : 'failed',
      detail: verification.ok
        ? `${adapter.label} installed and verified: ${verification.detail}`
        : `Install reported success but verification failed: ${verification.detail}`,
      at,
      projectRoot: context.projectRoot,
      adapterKind: adapter.kind,
      upstream: adapter.upstream,
      version: verification.ok ? extractVersion(verification.detail) : undefined,
      bytes: verification.ok ? this.prefixBytes(capability) : undefined,
    };

    // 4. Record it. A failed verification is recorded as failed, never as
    //    installed — the manifest is what later runs trust.
    this.recordProvision(record);
    return record;
  }

  /** Append-or-replace this capability's record for this project. */
  private recordProvision(record: ProvisionRecord): void {
    const records = this.readManifest().filter(
      (entry) => !(entry.capability === record.capability && entry.projectRoot === record.projectRoot),
    );
    records.push(record);
    this.writeManifest(records);
  }

  private removePrefix(capability: string): void {
    try {
      fs.rmSync(this.prefixFor(capability), { recursive: true, force: true });
    } catch {
      // Best effort; the manifest still records the failure.
    }
  }

  /**
   * Would installing `capability` push the cache over its budget?
   *
   * An already-satisfied capability is exempt: we are not adding bytes by
   * reusing something already on disk.
   */
  public checkBudget(capability: string): { ok: boolean; reason: string } {
    if (fs.existsSync(this.prefixFor(capability))) return { ok: true, reason: 'already on disk' };
    const used = this.cacheBytes();
    if (this.diskBudgetBytes <= 0 || used >= this.diskBudgetBytes) {
      return {
        ok: false,
        reason: `The toolchain cache is at ${Math.round(used / 1024 / 1024)} MB of its ${Math.round(
          this.diskBudgetBytes / 1024 / 1024,
        )} MB budget. Remove unused environments before provisioning ${capability}.`,
      };
    }
    return { ok: true, reason: 'within budget' };
  }

  /** Remove a project's cached environments. Never touches project files. */
  public clean(projectRoot?: string): number {
    const records = this.readManifest();
    const keep = projectRoot ? records.filter((r) => r.projectRoot !== projectRoot) : [];
    const removed = records.length - keep.length;
    this.writeManifest(keep);
    if (!projectRoot) {
      try {
        fs.rmSync(this.cacheRoot, { recursive: true, force: true });
      } catch {
        // Best effort; the manifest is already cleared.
      }
    }
    return removed;
  }
}

/**
 * A manager wired with the real, checksum-verifying adapters.
 *
 * `new ToolchainManager()` deliberately has no adapters so tests and pure
 * assessment never touch the network. This factory is the way to get a manager
 * that can actually install a runtime, and it is what the build executor uses.
 */
export async function createToolchainManager(options: {
  cacheRoot?: string;
  diskBudgetBytes?: number;
  nodeVersion?: string;
  pythonVersion?: string;
  include?: string[];
} = {}): Promise<ToolchainManager> {
  // Imported lazily so importing ToolchainManager for pure assessment does not
  // pull the downloader (and its `fetch`) into every consumer.
  const { realAdapters } = await import('./RuntimeAdapters.js');
  return new ToolchainManager({
    cacheRoot: options.cacheRoot,
    diskBudgetBytes: options.diskBudgetBytes,
    adapters: realAdapters({
      nodeVersion: options.nodeVersion,
      pythonVersion: options.pythonVersion,
      include: options.include,
    }),
  });
}

/** Recursive on-disk size of `dir`, or 0 when it does not exist. */
export function directorySize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(full);
    } else if (entry.isFile()) {
      try {
        total += fs.statSync(full).size;
      } catch {
        // A file removed mid-walk contributes nothing.
      }
    }
  }
  return total;
}

/**
 * Pull a version out of a `--version` banner.
 *
 * `v20.20.2`, `Python 3.12.16` and `Dart SDK version: 3.5.4 (stable) …` all
 * reduce to their numeric core; an unrecognised banner yields `undefined` rather
 * than a guessed version.
 */
export function extractVersion(banner: string): string | undefined {
  const match = banner.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : undefined;
}

// -----------------------------------------------------------------------------
// Build planning
// -----------------------------------------------------------------------------

export interface BuildStep {
  id: string;
  label: string;
  /** Capability this step needs; undefined when it is pure inspection. */
  requires?: string;
  command?: { binary: string; args: string[] };
  /** True when the step can run without the capability being present. */
  inspectionOnly: boolean;
}

export interface BuildPlan {
  profile: ProjectProfile;
  steps: BuildStep[];
  /** Capabilities that are absent today and would block execution. */
  blockers: RequirementAssessment[];
  /** True when every step that needs a capability has it. */
  executable: boolean;
}

/**
 * Build a plan from the project's *declared* scripts. A step is only included
 * when the project actually declares the script, so the plan never invents a
 * `build` target that does not exist.
 */
export function buildPlan(profile: ProjectProfile, assessments: RequirementAssessment[]): BuildPlan {
  const steps: BuildStep[] = [];
  const hasNode = profile.ecosystems.includes('node');

  if (hasNode) {
    if (profile.packageManagers.some((pm) => pm.startsWith('npm'))) {
      steps.push({
        id: 'install',
        label: 'Install dependencies',
        requires: 'npm',
        command: { binary: 'npm', args: ['install', '--no-audit', '--no-fund'] },
        inspectionOnly: false,
      });
    }
    if (profile.scripts.typecheck || profile.frameworks.includes('TypeScript')) {
      steps.push({
        id: 'typecheck',
        label: 'Type-check',
        requires: 'node_ts',
        command: { binary: 'npx', args: ['tsc', '--noEmit'] },
        inspectionOnly: false,
      });
    }
    if (profile.scripts.build) {
      steps.push({
        id: 'build',
        label: 'Build',
        requires: 'node_ts',
        command: { binary: 'npm', args: ['run', 'build'] },
        inspectionOnly: false,
      });
    }
    if (profile.scripts.test) {
      steps.push({
        id: 'test',
        label: 'Run tests',
        requires: 'node_ts',
        command: { binary: 'npm', args: ['test'] },
        inspectionOnly: false,
      });
    }
  }

  if (profile.ecosystems.includes('python')) {
    steps.push({
      id: 'python_install',
      label: 'Install Python dependencies',
      requires: 'python_runtime',
      inspectionOnly: false,
    });
  }

  if (profile.ecosystems.includes('rust')) {
    steps.push({
      id: 'cargo_build',
      label: 'Compile Rust crates',
      requires: 'rust_cargo',
      command: { binary: 'cargo', args: ['build'] },
      inspectionOnly: false,
    });
  }

  if (profile.ecosystems.includes('go')) {
    steps.push({
      id: 'go_build',
      label: 'Build Go modules',
      requires: 'go_toolchain',
      command: { binary: 'go', args: ['build', './...'] },
      inspectionOnly: false,
    });
  }

  // Inspection is always possible — reading source needs no compiler. This step
  // is what makes the distinction between "RARE understood the project" and
  // "RARE can build the project" explicit.
  steps.unshift({
    id: 'inspect',
    label: `Inspect sources (${profile.frameworks.join(', ') || 'unrecognised stack'})`,
    inspectionOnly: true,
  });

  const blockers = assessments.filter((a) => a.state !== 'satisfied' && a.state !== 'unknown');
  const needed = new Set(steps.filter((s) => s.requires).map((s) => s.requires!));
  const blockingNeeded = blockers.filter((b) => needed.has(b.capability));

  return {
    profile,
    steps,
    blockers,
    executable: blockingNeeded.length === 0,
  };
}

/** Run `binary --version`-style probes with a bound, exported for adapters. */
export function probeExecutable(
  binary: string,
  args: string[],
  cwd?: string,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: 5000, cwd, windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`.trim().split('\n')[0] || '';
      if (error) {
        resolve({ ok: false, detail: error.message });
        return;
      }
      resolve({ ok: true, detail: output || 'ran without output' });
    });
  });
}
