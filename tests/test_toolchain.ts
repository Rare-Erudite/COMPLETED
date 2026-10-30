/**
 * Proves the toolchain manager distinguishes real states and never fabricates
 * a successful install.
 *
 * The pre-existing registry could only say "here is an install hint". These
 * assertions cover the harder contract: a missing tool is reported missing, a
 * cached-but-broken env is NOT reused, an adapter that lies about installing is
 * recorded as failed, and project detection reads manifests rather than guesses.
 */

import assert from 'assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildPlan,
  detectProject,
  assessProject,
  provisionability,
  ToolchainManager,
  type ToolchainAdapter,
} from '../src/server/builder/ToolchainManager.js';

let pass = 0;
let fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    pass += 1;
    console.log(`  PASS  ${name}`);
  } catch (error: any) {
    fail += 1;
    console.error(`  FAIL  ${name} — ${error?.message || error}`);
  }
}

function tmpProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-tc-'));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  }
  return root;
}

export async function runToolchainTests() {
  console.log('[Test Group] Managed toolchain detection and provisioning');

  await check('detects a Node + TypeScript + Vite project from real manifests', async () => {
    const root = tmpProject({
      'package.json': JSON.stringify({
        name: 'app',
        scripts: { build: 'vite build', test: 'vitest run' },
        dependencies: { react: '19.0.0' },
        devDependencies: { typescript: '5.0.0', vite: '6.0.0' },
      }),
      'tsconfig.json': '{}',
      'vite.config.ts': 'export default {}',
      'package-lock.json': '{}',
    });
    const profile = detectProject(root);
    assert.ok(profile.ecosystems.includes('node'), JSON.stringify(profile.ecosystems));
    assert.ok(profile.frameworks.includes('React'), JSON.stringify(profile.frameworks));
    assert.ok(profile.frameworks.includes('TypeScript'), JSON.stringify(profile.frameworks));
    assert.ok(profile.frameworks.includes('Vite'), JSON.stringify(profile.frameworks));
    assert.ok(profile.packageManagers.includes('npm'), JSON.stringify(profile.packageManagers));
    assert.deepStrictEqual(profile.scripts.build, 'vite build');
    assert.ok(profile.requiredCapabilities.includes('node_ts'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  await check('detects a Dart project and reports the SDK as installable, never as satisfied', async () => {
    const root = tmpProject({ 'pubspec.yaml': 'name: app\n', 'pubspec.lock': 'packages: {}\n' });
    const profile = detectProject(root);
    assert.ok(profile.ecosystems.includes('dart'), JSON.stringify(profile.ecosystems));
    const assessments = await assessProject(profile, { platform: 'linux' });
    const dart = assessments.find((a) => a.capability === 'dart_sdk');
    assert.ok(dart, 'dart capability should be assessed');
    // There is still no *probe* for Dart, so RARE must not claim it is present.
    // What changed is that RARE now ships a real installer for it, so the honest
    // state is `missing` + provisionable — not `unknown`.
    assert.notStrictEqual(dart!.state, 'satisfied', 'never satisfied without probing or installing');
    assert.strictEqual(dart!.state, 'missing', `${dart!.state}: ${dart!.reason}`);
    assert.strictEqual(dart!.provisionable, true, 'a real Dart adapter exists');
    assert.ok(dart!.reason && /provision|probe/i.test(dart!.reason), dart!.reason);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await check('a .NET project is found by file extension', async () => {
    const root = tmpProject({ 'App.csproj': '<Project />' });
    const profile = detectProject(root);
    assert.ok(profile.ecosystems.includes('dotnet'), JSON.stringify(profile.ecosystems));
    assert.ok(profile.requiredCapabilities.includes('dotnet_sdk'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  await check('a Rust project is detected from Cargo.toml', async () => {
    const root = tmpProject({ 'Cargo.toml': '[package]\nname="x"\n', 'Cargo.lock': '' });
    const profile = detectProject(root);
    assert.ok(profile.ecosystems.includes('rust'));
    assert.ok(profile.packageManagers.includes('cargo'));
    const plan = buildPlan(profile, []);
    assert.ok(plan.steps.some((s) => s.id === 'cargo_build'), JSON.stringify(plan.steps.map((s) => s.id)));
    fs.rmSync(root, { recursive: true, force: true });
  });

  await check('a plan never invents a build script the project does not declare', async () => {
    const root = tmpProject({ 'package.json': JSON.stringify({ name: 'x', scripts: { test: 'true' } }) });
    const profile = detectProject(root);
    const plan = buildPlan(profile, []);
    assert.ok(!plan.steps.some((s) => s.id === 'build'), 'no build step without a build script');
    assert.ok(plan.steps.some((s) => s.id === 'test'), 'test step should exist');
    assert.ok(plan.steps.some((s) => s.id === 'inspect'), 'inspection is always available');
    fs.rmSync(root, { recursive: true, force: true });
  });

  await check('an unsatisfied capability makes the plan non-executable', async () => {
    const root = tmpProject({ 'package.json': JSON.stringify({ name: 'x', scripts: { build: 'vite build' } }) });
    const profile = detectProject(root);
    const assessments = [
      { capability: 'node_ts', purpose: 'typecheck', state: 'missing' as const, reason: 'not installed', provisionable: false },
    ];
    const plan = buildPlan(profile, assessments);
    assert.strictEqual(plan.executable, false);
    assert.ok(plan.blockers.length > 0);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await check('provisionability refuses unsafe targets', async () => {
    assert.strictEqual(provisionability('node_ts', 'linux').ok, false, 'cannot replace the host runtime');
    assert.strictEqual(provisionability('java_toolchain', 'linux').ok, false, 'JDK needs a licence decision');
    assert.strictEqual(provisionability('python_runtime', 'win32').ok, false, 'no Windows adapter');
    assert.strictEqual(provisionability('python_runtime', 'linux').ok, true);
    // The capabilities with a real adapter must be offered, and the ones that
    // are merely planned must not be.
    assert.strictEqual(provisionability('node_runtime', 'linux').ok, true);
    assert.strictEqual(provisionability('dart_sdk', 'linux').ok, true);
    assert.strictEqual(provisionability('rust_cargo', 'linux').ok, false, 'rustup is planned, not implemented');
    assert.strictEqual(provisionability('dotnet_sdk', 'linux').ok, false);
  });

  await check('provisioning without an adapter reports unavailable with a reason', async () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-cache-'));
    const manager = new ToolchainManager({ cacheRoot: cache });
    const record = await manager.provision('dart_sdk', { projectRoot: '/tmp/x', platform: 'linux' });
    assert.strictEqual(record.status, 'unavailable');
    assert.ok(record.detail.length > 0, 'must explain why');
    assert.ok(!fs.existsSync(path.join(cache, 'provisioned.json')), 'no manifest entry for a non-install');
    fs.rmSync(cache, { recursive: true, force: true });
  });

  await check('a lying adapter is recorded as failed, not installed', async () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-cache-'));
    const lying: ToolchainAdapter = {
      capability: 'python_runtime',
      label: 'Fake Python',
      // Claims success, but the tool never appears.
      install: async () => ({ ok: true, detail: 'pretend install succeeded' }),
      verify: async () => ({ ok: false, detail: 'binary not found after install' }),
    };
    const manager = new ToolchainManager({ cacheRoot: cache, adapters: [lying] });
    const record = await manager.provision('python_runtime', { projectRoot: '/tmp/proj' });
    assert.strictEqual(record.status, 'failed', `${record.status}: ${record.detail}`);
    assert.ok(/verification failed/i.test(record.detail), record.detail);

    const manifest = manager.readManifest();
    const entry = manifest.find((m) => m.capability === 'python_runtime');
    assert.ok(entry, 'a failed attempt should be recorded');
    assert.strictEqual(entry!.status, 'failed', 'never recorded as installed');
    fs.rmSync(cache, { recursive: true, force: true });
  });

  await check('a working adapter installs, verifies and is reused', async () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-cache-'));
    let installs = 0;
    const good: ToolchainAdapter = {
      capability: 'python_runtime',
      label: 'Portable Python',
      install: async (prefix) => {
        installs += 1;
        fs.writeFileSync(path.join(prefix, 'python'), '#!/bin/sh\necho 3.12.0\n', { mode: 0o755 });
        return { ok: true, detail: 'unpacked' };
      },
      verify: async (prefix) =>
        fs.existsSync(path.join(prefix, 'python'))
          ? { ok: true, detail: '3.12.0' }
          : { ok: false, detail: 'missing binary' },
    };
    const manager = new ToolchainManager({ cacheRoot: cache, adapters: [good] });

    const first = await manager.provision('python_runtime', { projectRoot: '/tmp/proj-a' });
    assert.strictEqual(first.status, 'installed', `${first.status}: ${first.detail}`);
    assert.strictEqual(installs, 1);

    // Second call must reuse the verified cache, not reinstall.
    const second = await manager.provision('python_runtime', { projectRoot: '/tmp/proj-a' });
    assert.strictEqual(second.status, 'already_present', `${second.status}: ${second.detail}`);
    assert.strictEqual(installs, 1, 'must not reinstall a verified cache');
    fs.rmSync(cache, { recursive: true, force: true });
  });

  await check('a corrupted cache is not reused', async () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-cache-'));
    let installs = 0;
    const adapter: ToolchainAdapter = {
      capability: 'go_toolchain',
      label: 'Go',
      install: async (prefix) => {
        installs += 1;
        fs.writeFileSync(path.join(prefix, 'go'), 'bin');
        return { ok: true, detail: 'unpacked' };
      },
      verify: async (prefix) =>
        fs.existsSync(path.join(prefix, 'go'))
          ? { ok: true, detail: 'go1.22' }
          : { ok: false, detail: 'missing' },
    };
    const manager = new ToolchainManager({ cacheRoot: cache, adapters: [adapter] });

    await manager.provision('go_toolchain', { projectRoot: '/tmp/p' });
    assert.strictEqual(installs, 1);

    // Corrupt the cache: the directory exists but the binary is gone.
    fs.rmSync(path.join(cache, 'go_toolchain', 'go'));
    const after = await manager.provision('go_toolchain', { projectRoot: '/tmp/p' });
    assert.strictEqual(installs, 2, 'a broken cache must trigger a reinstall');
    assert.strictEqual(after.status, 'installed', `${after.status}: ${after.detail}`);
    fs.rmSync(cache, { recursive: true, force: true });
  });

  await check('clean removes only cache state, never project files', async () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-cache-'));
    const projectRoot = tmpProject({ 'keep.txt': 'must survive' });
    const adapter: ToolchainAdapter = {
      capability: 'go_toolchain',
      label: 'Go',
      install: async (prefix) => {
        fs.writeFileSync(path.join(prefix, 'go'), 'bin');
        return { ok: true, detail: 'ok' };
      },
      verify: async (prefix) => ({ ok: fs.existsSync(path.join(prefix, 'go')), detail: '' }),
    };
    const manager = new ToolchainManager({ cacheRoot: cache, adapters: [adapter] });
    await manager.provision('go_toolchain', { projectRoot });

    const removed = manager.clean(projectRoot);
    assert.strictEqual(removed, 1);
    assert.strictEqual(manager.readManifest().length, 0);
    assert.ok(fs.existsSync(path.join(projectRoot, 'keep.txt')), 'project data must be untouched');
    fs.rmSync(cache, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  await check('platform placement refuses a local capability from the hosted backend', async () => {
    const { canExecuteHere, placementFor, currentExecutionSite, platformCaveat } = await import(
      '../src/server/builder/PlatformExecution.js'
    );

    // An APK/EXE build is a local-native capability; a Vercel container must
    // never claim it can produce one.
    const native = canExecuteHere('build_native_artifact');
    if (currentExecutionSite() === 'serverless') {
      assert.strictEqual(native.ok, false, 'the hosted backend must not claim a native build');
      assert.ok(/device|local-native/i.test(native.reason), native.reason);
      assert.ok(platformCaveat().length > 0, 'a serverless host must carry the caveat');
    } else {
      assert.strictEqual(native.ok, true, native.reason);
      assert.strictEqual(platformCaveat(), '', 'a local host needs no caveat');
    }

    // Reading device files happens in the browser, never on the server.
    assert.strictEqual(canExecuteHere('read_device_files').ok, false);
    // OS control is unavailable everywhere from a web page.
    assert.strictEqual(canExecuteHere('control_os').ok, false);
    // An unknown capability fails closed rather than being assumed to work.
    assert.strictEqual(placementFor('something_invented').site, 'unavailable');
    assert.strictEqual(canExecuteHere('something_invented').ok, false);
    // Provisioning a runtime is genuinely possible on the serverless host.
    assert.strictEqual(canExecuteHere('provision_runtime').ok, true);
  });

  await check('the real registry probes this repository and reports real versions', async () => {
    const profile = detectProject(process.cwd());
    const assessments = await assessProject(profile);
    const node = assessments.find((a) => a.capability === 'node_ts');
    assert.ok(node, 'node_ts must be assessed for this repo');
    assert.strictEqual(node!.state, 'satisfied', `${node!.state}: ${node!.reason}`);
    assert.ok(node!.toolchain?.version, 'a version must be recorded');
  });

  console.log(`  → ${pass} passed, ${fail} failed\n`);
  if (fail > 0) throw new Error(`${fail} toolchain assertion(s) failed.`);
}
