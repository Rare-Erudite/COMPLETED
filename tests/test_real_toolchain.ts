/**
 * RARE — Real toolchain provisioning (end-to-end)
 *
 * This is the test that answers the question the previous suite could not:
 * **can RARE actually install a runtime it did not have, and then run it?**
 *
 * The assertions below hit the real upstream publishers (nodejs.org and
 * python-build-standalone), verify real SHA-256 checksums, extract into a
 * throwaway cache and execute the resulting binary. There is no mocked
 * downloader and no fake compiler here — if the network is unavailable the test
 * reports that honestly instead of passing.
 *
 * It is deliberately marked `real` and skips *by reporting a skip*, never by
 * silently succeeding. A skipped real test is not a passed real test.
 *
 * Cost note: this downloads a ~47 MB Node tarball. That is the point — a
 * provisioning test that does not provision anything proves nothing.
 */

import assert from 'assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  ToolchainManager,
  createToolchainManager,
  extractVersion,
  directorySize,
  REAL_PROVISIONABLE_CAPABILITIES,
} from '../src/server/builder/ToolchainManager.js';
import {
  checksumFromManifest,
  downloadArtifact,
  fetchText,
} from '../src/server/builder/Downloader.js';
import {
  realAdapters,
  resolveDart,
  resolveNode,
  resolvePython,
  UNAVAILABLE_ADAPTERS,
  childEnv,
  classifyProbeFailure,
} from '../src/server/builder/RuntimeAdapters.js';

const execFileAsync = promisify(execFile);

let pass = 0;
let fail = 0;
let skipped = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    const outcome = await fn();
    if (outcome === 'skip') {
      skipped += 1;
      console.log(`  SKIP  ${name} (real upstream unavailable — not counted as a pass)`);
      return;
    }
    pass += 1;
    console.log(`  PASS  ${name}`);
  } catch (error: any) {
    fail += 1;
    console.error(`  FAIL  ${name} — ${error?.message || error}`);
  }
}

/** True when the upstream host answers, so a skip is a network fact, not a mask. */
async function upstreamReachable(url: string): Promise<boolean> {
  const probe = await fetchText(url, 20_000);
  return probe.ok;
}

export async function runRealToolchainTests() {
  console.log('[Test Group] REAL toolchain provisioning (downloads and executes upstream runtimes)');

  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-real-tc-'));
  // A 3 GB budget so the size assertions exercise real bytes rather than the cap.
  const manager = await createToolchainManager({ cacheRoot: cache, diskBudgetBytes: 3 * 1024 * 1024 * 1024 });

  const nodeIndexReachable = await upstreamReachable('https://nodejs.org/dist/index.json');

  // --- Unit-level: resolution and checksum parsing (no download) -------------

  await check('the real adapter set matches the capabilities the assessor promises', () => {
    const provided = realAdapters().map((adapter) => adapter.capability).sort();
    const declared = [...REAL_PROVISIONABLE_CAPABILITIES].sort();
    assert.deepStrictEqual(
      provided,
      declared,
      'assessProject reports provisionable capabilities from REAL_PROVISIONABLE_CAPABILITIES, so the two must not drift',
    );
    assert.ok(realAdapters().every((adapter) => adapter.kind === 'real'), 'every shipped adapter must be marked real');
  });

  await check('resolveNode selects an LTS build for this machine and a checksum manifest', async () => {
    if (!nodeIndexReachable) return 'skip';
    const target = await resolveNode();
    assert.ok(/^\d+\.\d+\.\d+$/.test(target.version), `unexpected version ${target.version}`);
    assert.ok(target.url.startsWith('https://nodejs.org/dist/v'), target.url);
    assert.ok(target.archiveName.includes(target.slug), target.archiveName);
    assert.ok(target.manifestUrl.endsWith('SHASUMS256.txt'), target.manifestUrl);
  });

  await check('checksumFromManifest finds the right digest and ignores a missing file', async () => {
    const manifest = [
      '# a comment line',
      'a'.repeat(64) + '  wanted.tar.gz',
      'b'.repeat(64) + ' *other.zip',
    ].join('\n');
    assert.strictEqual(checksumFromManifest(manifest, 'wanted.tar.gz'), 'a'.repeat(64));
    assert.strictEqual(checksumFromManifest(manifest, 'other.zip'), 'b'.repeat(64));
    // Absent must be undefined, so the caller refuses rather than skipping the check.
    assert.strictEqual(checksumFromManifest(manifest, 'absent.tar.gz'), undefined);
  });

  // --- Refusals: the downloader must not accept unverifiable input ----------

  await check('a non-HTTPS artifact is refused before any bytes move', async () => {
    const result = await downloadArtifact({
      url: 'http://nodejs.org/dist/x.tar.gz',
      destination: path.join(cache, 'nope.tar.gz'),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'insecure_url');
    assert.ok(!fs.existsSync(path.join(cache, 'nope.tar.gz')), 'nothing may be written');
  });

  await check('a wrong checksum is rejected and leaves no artifact behind', async () => {
    // A tiny real HTTPS fetch (nodejs.org index) proves the rejection path
    // without pulling a 47 MB archive.
    if (!nodeIndexReachable) return 'skip';
    const destination = path.join(cache, 'index.json');
    const result = await downloadArtifact({
      url: 'https://nodejs.org/dist/index.json',
      sha256: 'f'.repeat(64),
      destination,
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'checksum');
    assert.ok(!fs.existsSync(destination), 'a failed checksum must not leave the file');
    assert.ok(!fs.existsSync(`${destination}.part`), 'a failed checksum must not leave staging data');
  });

  await check('a size mismatch is named as a size problem, not a checksum problem', async () => {
    if (!nodeIndexReachable) return 'skip';
    const destination = path.join(cache, 'index-size.json');
    const result = await downloadArtifact({
      url: 'https://nodejs.org/dist/index.json',
      sizeBytes: 5,
      destination,
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'size');
    assert.ok(!fs.existsSync(destination));
  });

  await check('a missing system library is explained, not reported as a vague failure', () => {
    // This is the exact stderr from a real nodejs.org build on a container
    // without libatomic — the case that produced a confusing failure in practice.
    const message = classifyProbeFailure(
      'Command failed: /prefix/bin/node --version\n/prefix/bin/node: error while loading shared libraries: libatomic.so.1: cannot open shared object file: No such file or directory\n',
    );
    assert.ok(/libatomic\.so\.1/.test(message), message);
    assert.ok(/libatomic1/.test(message), 'the provider package must be named');
  });

  await check('the disk budget is checked before a download starts', async () => {
    const tightRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-tight-'));
    // Consume the budget with an existing prefix, then ask for a *different*
    // runtime. The manager must refuse on budget — before any network activity —
    // rather than relying on the adapter-absent path to save it.
    fs.mkdirSync(path.join(tightRoot, 'python_runtime', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(tightRoot, 'python_runtime', 'bin', 'python3'), Buffer.alloc(200 * 1024));

    const tight = await createToolchainManager({
      cacheRoot: tightRoot,
      diskBudgetBytes: 1024,
      include: ['node_runtime'],
    });
    const record = await tight.provision('node_runtime', { projectRoot: '/tmp/proj', platform: 'linux' });
    assert.strictEqual(record.status, 'unavailable');
    assert.ok(/budget/i.test(record.detail), record.detail);
    assert.ok(!fs.existsSync(path.join(tightRoot, 'node_runtime')), 'no prefix may be created when over budget');
    fs.rmSync(tightRoot, { recursive: true, force: true });
  });

  await check('capabilities with no adapter are reported with their real obstacle', async () => {
    const record = await manager.provision('java_toolchain', { projectRoot: '/tmp/proj', platform: 'linux' });
    assert.strictEqual(record.status, 'unavailable');
    assert.ok(/licence|root/i.test(record.detail), record.detail);
    // Every declared-unavailable capability must explain itself.
    for (const entry of UNAVAILABLE_ADAPTERS) {
      assert.ok(entry.reason.length > 20, `${entry.capability} needs a real reason`);
    }
  });

  // --- THE REAL END-TO-END TEST -------------------------------------------

  await check('REAL: provision portable Node.js — download, verify, extract and execute', async () => {
    if (!nodeIndexReachable) return 'skip';

    const record = await manager.provision('node_runtime', { projectRoot: '/tmp/real-node-project' });

    assert.strictEqual(
      record.status,
      'installed',
      `provisioning failed: ${record.detail}`,
    );
    assert.strictEqual(record.adapterKind, 'real', 'the install must come from the real adapter');
    assert.ok(record.version && /^\d+\.\d+/.test(record.version), `no version recorded: ${record.version}`);

    // The binary must exist *and* run, from the isolated prefix — not from PATH.
    const binary = path.join(manager.getCacheRoot(), 'node_runtime', 'bin', 'node');
    assert.ok(fs.existsSync(binary), `node binary missing at ${binary}`);

    const { stdout } = await execFileAsync(binary, ['--version'], { timeout: 20_000 });
    assert.ok(/^v\d+\./.test(stdout.trim()), `unexpected --version output: ${stdout}`);
    assert.strictEqual(extractVersion(stdout), record.version, 'recorded version must match what the binary reports');

    // And it must actually evaluate JavaScript, which is what a build needs.
    const evaluated = await execFileAsync(binary, ['-e', 'process.stdout.write(String(6 * 7))'], { timeout: 20_000 });
    assert.strictEqual(evaluated.stdout, '42', 'the provisioned runtime must execute code, not just print a version');

    const bytes = manager.prefixBytes('node_runtime');
    assert.ok(bytes > 20 * 1024 * 1024, `an unpacked Node runtime should be tens of MB, measured ${bytes}`);
    console.log(`        ↳ node ${record.version} provisioned, ${(bytes / 1024 / 1024).toFixed(1)} MB on disk`);
  });

  await check('REAL: a second provision reuses the verified cache instead of re-downloading', async () => {
    if (!nodeIndexReachable) return 'skip';
    const before = directorySize(path.join(manager.getCacheRoot(), 'node_runtime'));
    const record = await manager.provision('node_runtime', { projectRoot: '/tmp/real-node-project' });
    assert.strictEqual(record.status, 'already_present', `${record.status}: ${record.detail}`);
    const after = directorySize(path.join(manager.getCacheRoot(), 'node_runtime'));
    assert.strictEqual(after, before, 'reuse must not rewrite the prefix');
  });

  await check('REAL: a corrupted cache is detected and repaired by reinstalling', async () => {
    if (!nodeIndexReachable) return 'skip';
    const binary = path.join(manager.getCacheRoot(), 'node_runtime', 'bin', 'node');
    fs.rmSync(binary);
    assert.ok(!fs.existsSync(binary), 'precondition: binary removed');

    const record = await manager.provision('node_runtime', { projectRoot: '/tmp/real-node-project' });
    assert.strictEqual(record.status, 'installed', `a broken cache must be repaired: ${record.detail}`);
    assert.ok(fs.existsSync(binary), 'the binary must be back');
  });

  await check('REAL: provision portable CPython from python-build-standalone and run it', async () => {
    const reachable = await upstreamReachable('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest');
    if (!reachable) return 'skip';

    const target = await resolvePython();
    const digest = await fetchText(target.manifestUrl);
    assert.ok(digest.ok && digest.text, `could not read the PBS checksum manifest: ${digest.detail}`);
    const expected = checksumFromManifest(digest.text, target.archiveName);
    assert.ok(expected, `the PBS manifest did not list ${target.archiveName}`);

    const pythonManager = await createToolchainManager({
      cacheRoot: cache,
      diskBudgetBytes: 3 * 1024 * 1024 * 1024,
      include: ['python_runtime'],
    });
    const record = await pythonManager.provision('python_runtime', { projectRoot: '/tmp/real-py-project' });
    assert.strictEqual(record.status, 'installed', `python provisioning failed: ${record.detail}`);

    const binary = path.join(cache, 'python_runtime', 'bin', 'python3');
    assert.ok(fs.existsSync(binary), `interpreter missing at ${binary}`);
    const { stdout } = await execFileAsync(binary, ['-V'], { timeout: 20_000 });
    assert.ok(/^Python 3\./.test(stdout.trim()), `unexpected -V output: ${stdout}`);
    assert.strictEqual(extractVersion(stdout), record.version, 'recorded version must match the interpreter');

    const ran = await execFileAsync(binary, ['-c', 'print(sum(range(101)))'], { timeout: 20_000 });
    assert.strictEqual(ran.stdout.trim(), '5050', 'the provisioned interpreter must run real code');
  });

  await check('REAL: the pinned runtime is what a child process sees on PATH', async () => {
    if (!nodeIndexReachable) return 'skip';
    const env = childEnv(path.join(cache, 'node_runtime'));
    // Secrets must never reach a build script.
    for (const secret of ['DATABASE_URL', 'GEMINI_API_KEY', 'VERCEL_TOKEN', 'GITHUB_TOKEN']) {
      assert.ok(!(secret in env), `${secret} must be stripped from a build child process`);
    }
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
    assert.ok(
      String(env[pathKey]).startsWith(path.join(cache, 'node_runtime', 'bin')),
      'the provisioned prefix must come first on PATH so the pinned runtime wins',
    );
  });

  await check('Dart resolution reports a real archive and checksum URL', async () => {
    const reachable = await upstreamReachable('https://storage.googleapis.com/dart-archive/channels/stable/release/latest/VERSION');
    if (!reachable) return 'skip';
    const target = await resolveDart('linux', 'x64');
    assert.ok(/^\d+\.\d+\.\d+/.test(target.version), target.version);
    assert.strictEqual(target.archiveName, 'dartsdk-linux-x64-release.zip');
    assert.ok(target.manifestUrl.endsWith('.zip.sha256sum'), target.manifestUrl);
    // The sidecar must actually carry a digest for that exact filename.
    const sidecar = await fetchText(target.manifestUrl);
    assert.ok(sidecar.ok && sidecar.text, sidecar.detail);
    assert.ok(checksumFromManifest(sidecar.text, target.archiveName), 'the Dart sidecar must list the archive');
  });

  fs.rmSync(cache, { recursive: true, force: true });

  console.log(`  → ${pass} passed, ${fail} failed, ${skipped} skipped (skips are real upstream/network limits)`);
  console.log('  → real installs performed by this group: node_runtime (and python_runtime when reachable)');
  if (fail > 0) throw new Error(`${fail} real toolchain assertion(s) failed.`);
}
