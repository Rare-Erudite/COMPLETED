/**
 * RARE — Real runtime provisioning adapters
 *
 * `ToolchainManager` was written so that provisioning is delegated to
 * per-ecosystem adapters — but nothing ever supplied one, so every install
 * reported `unavailable` and the manager could only *assess* an environment.
 * These adapters close that gap for the three ecosystems where a portable,
 * self-contained runtime exists and can be verified end to end:
 *
 *   node_runtime     nodejs.org dist tarball            — SHASUMS256.txt
 *   python_runtime   python-build-standalone tarball    — SHA256SUMS asset
 *   dart_sdk         storage.googleapis.com dart-archive — .sha256sum sidecar
 *
 * Each one, in order:
 *   1. resolves a concrete version + architecture for this OS/CPU,
 *   2. fetches the publisher's own checksum manifest over HTTPS,
 *   3. downloads the archive and verifies SHA-256 *before* it is usable,
 *   4. extracts it into an isolated prefix under the RARE cache — never onto
 *      the user's PATH and never over an existing system runtime,
 *   5. runs `<prefix>/bin/<tool> --version` and reads the real output.
 *
 * The last step is the point. A downloaded file, an extracted directory and a
 * working toolchain are three different things, and only the third is reported
 * as `installed`.
 *
 * Adapters that are declared but not implemented are exported as
 * `UNAVAILABLE_ADAPTERS` with the real reason, so the manager can explain the
 * gap instead of silently returning nothing.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  ToolchainAdapter,
  probeExecutable,
} from './ToolchainManager.js';
import {
  checksumFromManifest,
  downloadArtifact,
  fetchText,
} from './Downloader.js';

const execFileAsync = promisify(execFile);

// -----------------------------------------------------------------------------
// Platform resolution
// -----------------------------------------------------------------------------

export interface ResolvedTarget {
  /** Runtime version, without a leading `v`. */
  version: string;
  /** Publisher's OS/arch slug for this machine. */
  slug: string;
  archiveName: string;
  url: string;
  /** Checksum manifest URL, fetched from the publisher's own host. */
  manifestUrl: string;
  /** How to pull the digest out of the manifest. */
  manifestFormat: 'sha256sum' | 'json-digest';
}

function unsupported(reason: string): never {
  throw new Error(reason);
}

/**
 * Node.js publishes static tarballs for every supported OS/arch and a single
 * `SHASUMS256.txt` per release.
 */
export async function resolveNode(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  requestedVersion?: string,
): Promise<ResolvedTarget> {
  const slug = nodeSlug(platform, arch);
  const index = await fetchText('https://nodejs.org/dist/index.json');
  if (!index.ok || !index.text) unsupported(`Could not read the Node.js distribution index (${index.detail}).`);

  let parsed: Array<{ version: string; lts: string | false }>;
  try {
    parsed = JSON.parse(index.text);
  } catch {
    return unsupported('The Node.js distribution index was not valid JSON.');
  }

  let version: string;
  if (requestedVersion) {
    const wanted = requestedVersion.startsWith('v') ? requestedVersion : `v${requestedVersion}`;
    if (!parsed.some((entry) => entry.version === wanted)) {
      return unsupported(`Node.js ${wanted} is not available from nodejs.org.`);
    }
    version = wanted;
  } else {
    // Prefer LTS: a project build should not land on a current-odd release.
    const lts = parsed.find((entry) => entry.lts);
    if (!lts) return unsupported('The Node.js distribution index listed no LTS release.');
    version = lts.version;
  }

  const archiveName = `node-${version}-${slug}.tar.gz`;
  return {
    version: version.replace(/^v/, ''),
    slug,
    archiveName,
    url: `https://nodejs.org/dist/${version}/${archiveName}`,
    manifestUrl: `https://nodejs.org/dist/${version}/SHASUMS256.txt`,
    manifestFormat: 'sha256sum',
  };
}

export function nodeSlug(platform: NodeJS.Platform, arch: string): string {
  if (platform === 'linux') {
    if (arch === 'x64') return 'linux-x64';
    if (arch === 'arm64') return 'linux-arm64';
  }
  if (platform === 'darwin') {
    if (arch === 'x64') return 'darwin-x64';
    if (arch === 'arm64') return 'darwin-arm64';
  }
  return unsupported(
    `RARE has no portable Node.js build for ${platform}/${arch}. Windows builds are served as .zip and are not wired up yet.`,
  );
}

/**
 * python-build-standalone ships a self-contained CPython (`install_only`), so no
 * system Python and no compilation is involved.
 */
export async function resolvePython(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  requestedVersion = '3.12',
): Promise<ResolvedTarget> {
  const triple = pbsTriple(platform, arch);
  const release = await fetchText(
    'https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest',
  );
  if (!release.ok || !release.text) {
    return unsupported(`Could not read the python-build-standalone release index (${release.detail}).`);
  }

  let body: { tag_name?: string; assets?: Array<{ name: string }> };
  try {
    body = JSON.parse(release.text);
  } catch {
    return unsupported('The python-build-standalone release index was not valid JSON.');
  }

  const tag = body.tag_name;
  const assets = (body.assets || []).map((asset) => asset.name);
  if (!tag || assets.length === 0) return unsupported('No python-build-standalone release assets were listed.');

  // Prefer `install_only` (unpacked, ready to run); `stripped` drops debug
  // symbols and is smaller but is not always published for every version.
  const candidates = assets.filter(
    (name) =>
      name.startsWith(`cpython-${requestedVersion}`) &&
      name.includes(triple) &&
      name.includes('install_only') &&
      !name.includes('stripped') &&
      name.endsWith('.tar.gz'),
  );
  if (candidates.length === 0) {
    return unsupported(
      `No python-build-standalone asset for CPython ${requestedVersion} on ${triple}.`,
    );
  }
  // Highest patch version wins within the requested minor.
  const archiveName = candidates.sort().reverse()[0];
  const manifestUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/SHA256SUMS`;

  return {
    version: archiveName.match(/^cpython-(\d+\.\d+\.\d+)/)?.[1] || requestedVersion,
    slug: triple,
    archiveName,
    url: `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/${archiveName}`,
    manifestUrl,
    manifestFormat: 'sha256sum',
  };
}

export function pbsTriple(platform: NodeJS.Platform, arch: string): string {
  if (platform === 'linux') {
    if (arch === 'x64') return 'x86_64-unknown-linux-gnu';
    if (arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  }
  if (platform === 'darwin') {
    if (arch === 'x64') return 'x86_64-apple-darwin';
    if (arch === 'arm64') return 'aarch64-apple-darwin';
  }
  return unsupported(`RARE has no portable CPython build for ${platform}/${arch}.`);
}

/**
 * Dart publishes the standalone SDK as a zip plus a `.sha256sum` sidecar. The
 * Flutter SDK is a separate, far larger download that bundles this same Dart
 * SDK; RARE provisions the Dart SDK, which is what a Dart/Flutter project needs
 * to run `dart` (and `flutter pub`-style resolution is reported separately).
 */
export async function resolveDart(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Promise<ResolvedTarget> {
  const slug = dartSlug(platform, arch);
  const versionDoc = await fetchText(
    'https://storage.googleapis.com/dart-archive/channels/stable/release/latest/VERSION',
  );
  if (!versionDoc.ok || !versionDoc.text) {
    return unsupported(`Could not read the Dart release index (${versionDoc.detail}).`);
  }

  let version: string;
  try {
    version = JSON.parse(versionDoc.text).version;
  } catch {
    return unsupported('The Dart release index was not valid JSON.');
  }
  if (!version) return unsupported('The Dart release index did not report a version.');

  const archiveName = `dartsdk-${slug}-release.zip`;
  return {
    version,
    slug,
    archiveName,
    url: `https://storage.googleapis.com/dart-archive/channels/stable/release/${version}/sdk/${archiveName}`,
    manifestUrl: `https://storage.googleapis.com/dart-archive/channels/stable/release/${version}/sdk/${archiveName}.sha256sum`,
    manifestFormat: 'sha256sum',
  };
}

export function dartSlug(platform: NodeJS.Platform, arch: string): string {
  if (platform === 'linux') {
    if (arch === 'x64') return 'linux-x64';
    if (arch === 'arm64') return 'linux-arm64';
  }
  if (platform === 'darwin') {
    if (arch === 'x64') return 'macos-x64';
    if (arch === 'arm64') return 'macos-arm64';
  }
  return unsupported(`RARE has no Dart SDK build for ${platform}/${arch}.`);
}

// -----------------------------------------------------------------------------
// Extraction
// -----------------------------------------------------------------------------

/** `.tar.gz` archives from nodejs.org and python-build-standalone have one top level dir. */
async function extractTarGz(archive: string, prefix: string): Promise<void> {
  const tar = await import('tar');
  await tar.x({
    file: archive,
    cwd: prefix,
    // Both publishers wrap everything in a single versioned directory; dropping
    // it puts `bin/`, `lib/` at the prefix root so `prefix/bin/node` is stable.
    strip: 1,
  });
}

/** Dart ships a zip whose single top level dir must be hoisted, since `adm-zip` cannot strip. */
async function extractZip(archive: string, prefix: string): Promise<void> {
  const AdmZip = (await import('adm-zip')).default;
  const staging = `${prefix}.unzip`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    new AdmZip(archive).extractAllTo(staging, true);
    const entries = fs.readdirSync(staging);
    if (entries.length === 1 && fs.statSync(path.join(staging, entries[0])).isDirectory()) {
      hoist(path.join(staging, entries[0]), prefix);
    } else {
      hoist(staging, prefix);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** Move every child of `from` into `to`, replacing whatever was there. */
function hoist(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from)) {
    const source = path.join(from, entry);
    const target = path.join(to, entry);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(source, target);
  }
}

// -----------------------------------------------------------------------------
// Adapter factory
// -----------------------------------------------------------------------------

interface AdapterSpec {
  capability: string;
  label: string;
  /** Binary the adapter must be able to execute after install, relative to `bin/`. */
  binary: string;
  resolve: () => Promise<ResolvedTarget>;
  extract: (archive: string, prefix: string) => Promise<void>;
  /** Extra probe args, e.g. Node's `--version` vs Python's `-V`. */
  versionArgs?: string[];
}

function makeRealAdapter(spec: AdapterSpec): ToolchainAdapter {
  const binPath = (prefix: string) =>
    path.join(prefix, 'bin', process.platform === 'win32' ? `${spec.binary}.exe` : spec.binary);

  return {
    capability: spec.capability,
    label: spec.label,
    kind: 'real',
    upstream: spec.label,

    async verify(prefix: string) {
      const binary = binPath(prefix);
      if (!fs.existsSync(binary)) {
        return { ok: false, detail: `${spec.binary} is not present at ${path.relative(prefix, binary) || binary}.` };
      }
      // `--version` (or `-V`) is the real test: a file that exists but cannot
      // execute is a broken toolchain, not an installed one.
      const probe = await probeExecutable(binary, spec.versionArgs || ['--version']);
      if (probe.ok) return probe;
      return { ok: false, detail: classifyProbeFailure(probe.detail) };
    },

    async install(prefix: string) {
      fs.mkdirSync(prefix, { recursive: true });

      // 1. Resolve a concrete version for this machine.
      let target: ResolvedTarget;
      try {
        target = await spec.resolve();
      } catch (error: any) {
        return { ok: false, detail: error?.message || String(error) };
      }

      // 2. Fetch the publisher's own checksum manifest. Without a digest there is
      //    no integrity guarantee, so the install stops here rather than
      //    executing an unverified archive.
      const manifest = await fetchText(target.manifestUrl);
      if (!manifest.ok || !manifest.text) {
        return {
          ok: false,
          detail: `Could not fetch the checksum manifest ${target.manifestUrl} (${manifest.detail}). Refusing to install unverified.`,
        };
      }
      const expected = checksumFromManifest(manifest.text, target.archiveName);
      if (!expected) {
        return {
          ok: false,
          detail: `The checksum manifest did not list ${target.archiveName}; refusing to install unverified.`,
        };
      }

      // 3. Download to a scratch dir, verify, then extract. The archive is never
      //    executed from the scratch location.
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-dl-'));
      const archive = path.join(scratch, target.archiveName);
      try {
        const download = await downloadArtifact({
          url: target.url,
          sha256: expected,
          destination: archive,
        });
        if (!download.ok) {
          return { ok: false, detail: `${spec.label} download failed (${download.reason}): ${download.detail}` };
        }

        // 4. Extract into the isolated prefix.
        try {
          await spec.extract(archive, prefix);
        } catch (error: any) {
          return { ok: false, detail: `Extracting ${target.archiveName} failed: ${error?.message || error}` };
        }

        // 5. Prove the binary runs before reporting anything.
        //
        //    An extracted-but-unrunnable runtime is the classic false positive:
        //    the download and checksum were fine, but the official Linux build
        //    links system libraries (`libatomic.so.1`, `libstdc++`, `libnss3`)
        //    that a minimal container does not ship. That is a *platform*
        //    restriction, not a failed install, and it is reported as such with
        //    the exact library and the package that provides it — otherwise the
        //    user sees a confusing "did not run" with no next step.
        const probe = await probeExecutable(binPath(prefix), spec.versionArgs || ['--version']);
        if (!probe.ok) {
          return { ok: false, detail: classifyProbeFailure(probe.detail) };
        }
        return {
          ok: true,
          detail: `${spec.label} ${target.version} installed into an isolated prefix and verified (${probe.detail}).`,
        };
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Turn a raw probe failure into something a human can act on.
 *
 * The dominant real-world case for a freshly extracted Linux runtime is a
 * missing shared library. Naming the library *and* the distro package is the
 * difference between a support ticket and a one-line fix.
 */
export function classifyProbeFailure(detail: string): string {
  const missingLib = detail.match(/error while loading shared libraries: ([\w.+-]+):/);
  if (missingLib) {
    const lib = missingLib[1];
    const provider =
      KNOWN_LIB_PROVIDERS[lib] ||
      `the distribution package that provides ${lib}`;
    return `${detail.split('\n')[0]} — the runtime installed and verified, but this host is missing ${lib}. Install ${provider} and retry; RARE cannot do this unattended because it changes the system, not the project.`;
  }
  if (/Permission denied/i.test(detail)) {
    return `${detail.split('\n')[0]} — the artifact extracted but is not executable. This usually means the archive was unpacked without its mode bits.`;
  }
  if (/No such file or directory/i.test(detail)) {
    return `${detail.split('\n')[0]} — the binary is present but its interpreter is missing, which points at an architecture mismatch.`;
  }
  return `Installed but did not run: ${detail}`;
}

/** System prerequisites the official portable builds assume, and who provides them. */
const KNOWN_LIB_PROVIDERS: Record<string, string> = {
  'libatomic.so.1': 'libatomic1 (Debian/Ubuntu) or gcc-libs (Fedora/Arch)',
  'libstdc++.so.6': 'libstdc++6 (Debian/Ubuntu) or gcc-libs (Fedora/Arch)',
  'libgcc_s.so.1': 'libgcc-s1 (Debian/Ubuntu) or libgcc (Fedora)',
  'libnss3.so': 'libnss3 (Debian/Ubuntu) or nss (Fedora)',
  'libz.so.1': 'zlib1g (Debian/Ubuntu) or zlib (Fedora)',
};

/** Portable Node.js, for building a project that pins a Node version. */
export const nodeRuntimeAdapter = (version?: string): ToolchainAdapter =>
  makeRealAdapter({
    capability: 'node_runtime',
    label: 'Node.js (portable)',
    binary: 'node',
    resolve: () => resolveNode(process.platform, process.arch, version),
    extract: extractTarGz,
  });

/** Portable CPython, self-contained — no system Python, no compilation. */
export const pythonRuntimeAdapter = (version?: string): ToolchainAdapter =>
  makeRealAdapter({
    capability: 'python_runtime',
    label: 'CPython (portable)',
    binary: 'python3',
    versionArgs: ['-V'],
    resolve: () => resolvePython(process.platform, process.arch, version),
    extract: extractTarGz,
  });

/** Dart SDK — the runtime a Dart/Flutter project needs. */
export const dartSdkAdapter = (): ToolchainAdapter =>
  makeRealAdapter({
    capability: 'dart_sdk',
    label: 'Dart SDK',
    binary: 'dart',
    resolve: () => resolveDart(process.platform, process.arch),
    extract: extractZip,
  });

/**
 * Every adapter that actually performs a verified install, keyed by capability.
 *
 * Only ecosystems with a portable, checksum-verifiable runtime are here. The
 * rest are listed in `UNAVAILABLE_ADAPTERS` with the real obstacle — a JDK
 * needs a licence decision and root; .NET and the MSVC toolchain have no
 * redistribution RARE may make on the user's behalf; Flutter is a multi-GB
 * bundle that must not be pulled implicitly.
 */
export function realAdapters(options: {
  nodeVersion?: string;
  pythonVersion?: string;
  include?: string[];
} = {}): ToolchainAdapter[] {
  const all: ToolchainAdapter[] = [
    nodeRuntimeAdapter(options.nodeVersion),
    pythonRuntimeAdapter(options.pythonVersion),
    dartSdkAdapter(),
  ];
  if (!options.include) return all;
  return all.filter((adapter) => options.include!.includes(adapter.capability));
}

/** Capabilities RARE recognises but cannot install itself, and why. */
export const UNAVAILABLE_ADAPTERS: Array<{ capability: string; label: string; reason: string }> = [
  {
    capability: 'java_toolchain',
    label: 'Java/JVM (JDK)',
    reason:
      'A JDK is distributable, but installing one implies accepting a vendor licence and, for the system JDK, root. RARE will not accept a licence on the user\'s behalf.',
  },
  {
    capability: 'dotnet_sdk',
    label: '.NET SDK',
    reason: 'The .NET SDK installer writes to a system location and its licence terms are not ours to accept unattended.',
  },
  {
    capability: 'c_compiler',
    label: 'C/C++ toolchain',
    reason: 'No portable, redistribution-clean C toolchain is available for all targets; this needs the platform package manager.',
  },
  {
    capability: 'flutter_sdk',
    label: 'Flutter SDK',
    reason: 'Flutter is a multi-gigabyte bundle plus Android tooling. It must be requested explicitly, never pulled implicitly.',
  },
  {
    capability: 'rust_cargo',
    label: 'Rust toolchain',
    reason: 'rustup installs a network-driven toolchain with its own trust root; wiring it up is planned but not implemented here.',
  },
  {
    capability: 'go_toolchain',
    label: 'Go toolchain',
    reason: 'A Go distribution is redistributable and checksum-verifiable; the adapter is planned but not implemented here.',
  },
];

// -----------------------------------------------------------------------------
// Dependency installation
// -----------------------------------------------------------------------------

export interface DependencyInstallResult {
  ok: boolean;
  detail: string;
  /** Combined output, truncated. */
  output?: string;
  /** True when a lockfile was present, so the install is reproducible. */
  reproducible: boolean;
}

/**
 * Install a Node project's dependencies using the *provisioned* Node/npm, with
 * the prefix's `bin` first on PATH — so the project builds against the pinned
 * runtime rather than whatever happens to be on the host.
 *
 * `npm ci` is used when a lockfile exists (reproducible); otherwise `npm install`
 * and the caller is told it was not reproducible rather than being left to
 * assume it was.
 */
export async function installNodeDependencies(
  prefix: string,
  projectRoot: string,
  options: { production?: boolean; timeoutMs?: number } = {},
): Promise<DependencyInstallResult> {
  const npm = path.join(prefix, 'bin', process.platform === 'win32' ? 'npm.cmd' : 'npm');
  if (!fs.existsSync(npm)) {
    return { ok: false, detail: `No npm at ${npm}; provision node_runtime first.`, reproducible: false };
  }
  if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
    return { ok: false, detail: 'The project has no package.json.', reproducible: false };
  }

  const hasLockfile = fs.existsSync(path.join(projectRoot, 'package-lock.json'));
  const args = hasLockfile ? ['ci', '--no-audit', '--no-fund'] : ['install', '--no-audit', '--no-fund'];
  if (options.production) args.push('--omit=dev');

  try {
    const result = await execFileAsync(npm, args, {
      cwd: projectRoot,
      timeout: options.timeoutMs ?? 5 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
      env: childEnv(prefix),
    });
    return {
      ok: true,
      reproducible: hasLockfile,
      detail: hasLockfile ? 'Installed from package-lock.json (reproducible).' : 'Installed without a lockfile (not reproducible).',
      output: `${result.stdout || ''}${result.stderr || ''}`.slice(-4000),
    };
  } catch (error: any) {
    return {
      ok: false,
      reproducible: hasLockfile,
      detail: `Dependency installation failed (exit ${error?.code ?? 'unknown'}): ${error?.message || error}`,
      output: `${error?.stdout || ''}${error?.stderr || ''}`.slice(-4000),
    };
  }
}

/** Install Python dependencies with the provisioned interpreter. */
export async function installPythonDependencies(
  prefix: string,
  projectRoot: string,
  options: { timeoutMs?: number } = {},
): Promise<DependencyInstallResult> {
  const python = path.join(prefix, 'bin', process.platform === 'win32' ? 'python.exe' : 'python3');
  if (!fs.existsSync(python)) {
    return { ok: false, detail: `No interpreter at ${python}; provision python_runtime first.`, reproducible: false };
  }

  const requirements = path.join(projectRoot, 'requirements.txt');
  const pyproject = path.join(projectRoot, 'pyproject.toml');
  if (!fs.existsSync(requirements) && !fs.existsSync(pyproject)) {
    return { ok: false, detail: 'The project declares no requirements.txt or pyproject.toml.', reproducible: false };
  }

  const target = fs.existsSync(requirements) ? requirements : pyproject;
  const args = ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', target];

  try {
    const result = await execFileAsync(python, args, {
      cwd: projectRoot,
      timeout: options.timeoutMs ?? 5 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
      env: childEnv(prefix),
    });
    return {
      ok: true,
      reproducible: true,
      detail: `Installed from ${path.basename(target)}.`,
      output: `${result.stdout || ''}${result.stderr || ''}`.slice(-4000),
    };
  } catch (error: any) {
    return {
      ok: false,
      reproducible: true,
      detail: `Dependency installation failed (exit ${error?.code ?? 'unknown'}): ${error?.message || error}`,
      output: `${error?.stdout || ''}${error?.stderr || ''}`.slice(-4000),
    };
  }
}

/**
 * Environment for a child process using a provisioned prefix.
 *
 * The prefix's `bin` goes first so the pinned runtime wins, and the child gets a
 * copy of the environment with credentials removed — a build script must not be
 * able to read the deployment's secrets.
 */
export function childEnv(prefix: string): NodeJS.ProcessEnv {
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [pathKey]: `${path.join(prefix, 'bin')}${path.delimiter}${process.env[pathKey] || ''}`,
    // Keep the provisioned runtime self-contained and reproducible.
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  };
  for (const secret of [
    'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
    'RARE_API_TOKEN', 'RARE_DEV_KEY', 'DATABASE_URL',
    'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY',
    'VERCEL_TOKEN', 'GITHUB_TOKEN',
  ]) {
    delete env[secret];
  }
  return env;
}
