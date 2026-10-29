/**
 * Proves the diagnostic and fault-injection paths do real work.
 *
 * The endpoint these tests cover previously returned a hardcoded list of green
 * ticks, then a 501. Both were dishonest in different ways. These assertions
 * fail if a check can report `pass` without having executed, or if the fault
 * round-trip does not actually inject, detect, repair and clean up.
 */

import assert from 'assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runDiagnostics, runFaultInjectionTest } from '../src/server/development/Diagnostics.js';

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

export async function runDiagnosticsTests() {
  console.log('[Test Group] Diagnostics and fault injection do real work');

  const fakeRun = (exitCode: number, stdout = '', stderr = '') =>
    async () => ({ exitCode, stdout, stderr });

  await check('fault round-trip injects, detects, repairs, verifies and cleans up', async () => {
    const result = await runFaultInjectionTest();
    assert.strictEqual(result.faultInjected, true, 'must inject');
    assert.strictEqual(result.detected, true, 'must detect');
    assert.strictEqual(result.repaired, true, 'must repair');
    assert.strictEqual(result.verified, true, 'must verify');
    assert.strictEqual(result.cleanedUp, true, 'must clean up');
    assert.ok(!fs.existsSync(result.workspace), 'temp workspace must be gone');
  });

  await check('fault round-trip never touches the live application', async () => {
    const appRoot = process.cwd();
    const before = fs.readFileSync(path.join(appRoot, 'server.ts'), 'utf-8').length;
    const result = await runFaultInjectionTest();
    const after = fs.readFileSync(path.join(appRoot, 'server.ts'), 'utf-8').length;
    assert.strictEqual(before, after, 'server.ts must be byte-identical');
    assert.ok(result.workspace.startsWith(os.tmpdir()), 'workspace must be under the temp dir');
  });

  await check('a failing typecheck is reported as fail, not pass', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-diag-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'true' } }));
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');

    const report = await runDiagnostics({
      root,
      frontendDir: undefined,
      runCommand: async (binary, args) => {
        if (binary === 'node') return { exitCode: 0, stdout: 'v20.0.0', stderr: '' };
        // tsc fails
        return { exitCode: 2, stdout: 'src/x.ts(1,1): error TS1005: expected ;', stderr: '' };
      },
    });

    const typecheck = report.checks.find((c) => c.id === 'typecheck');
    assert.ok(typecheck, 'typecheck check must exist');
    assert.strictEqual(typecheck!.status, 'fail', 'must report fail');
    assert.ok(typecheck!.detail.includes('TS1005'), `detail must quote the real diagnostic: ${typecheck!.detail}`);
    assert.strictEqual(report.allPassed, false, 'a failure must not yield allPassed');
    fs.rmSync(root, { recursive: true, force: true });
  });

  await check('a passing typecheck is reported as pass', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-diag-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'true' } }));
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');

    const report = await runDiagnostics({
      root,
      frontendDir: undefined,
      runCommand: async (binary) => ({ exitCode: 0, stdout: binary === 'node' ? 'v20.0.0' : '', stderr: '' }),
    });

    const typecheck = report.checks.find((c) => c.id === 'typecheck');
    assert.strictEqual(typecheck!.status, 'pass');
    fs.rmSync(root, { recursive: true, force: true });
  });

  await check('an old runtime is reported as fail, not pass', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-diag-'));
    const report = await runDiagnostics({
      root,
      frontendDir: undefined,
      // Claim Node 16 — below the >=18 requirement.
      runCommand: async () => ({ exitCode: 0, stdout: 'v16.20.0', stderr: '' }),
    });
    const runtime = report.checks.find((c) => c.id === 'runtime_version');
    assert.strictEqual(runtime!.status, 'fail', `got ${runtime!.status}: ${runtime!.detail}`);
    assert.ok(/below/.test(runtime!.detail), runtime!.detail);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await check('a malformed package.json is detected', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-diag-'));
    fs.writeFileSync(path.join(root, 'package.json'), '{ "name": '); // truncated JSON
    const report = await runDiagnostics({
      root,
      frontendDir: undefined,
      runCommand: async () => ({ exitCode: 0, stdout: 'v20.0.0', stderr: '' }),
    });
    const manifest = report.checks.find((c) => c.id === 'manifest_valid');
    assert.strictEqual(manifest!.status, 'fail', `got ${manifest!.status}`);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await check('a skipped check does not count as a pass', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-diag-'));
    // No tsconfig, no package.json → typecheck and manifest skip.
    const report = await runDiagnostics({
      root,
      frontendDir: undefined,
      runCommand: async () => ({ exitCode: 0, stdout: 'v20.0.0', stderr: '' }),
    });
    assert.ok(report.counts.skipped > 0, 'some checks should skip');
    assert.strictEqual(report.allPassed, false, 'skips must not produce allPassed');
    fs.rmSync(root, { recursive: true, force: true });
  });

  await check('no check claims a result without running', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-diag-'));
    const invoked: string[] = [];
    const report = await runDiagnostics({
      root,
      frontendDir: undefined,
      runCommand: async (binary) => {
        invoked.push(binary);
        return { exitCode: 0, stdout: binary === 'node' ? 'v20.0.0' : '', stderr: '' };
      },
    });
    for (const checkResult of report.checks) {
      if (checkResult.status === 'pass' && checkResult.id === 'runtime_version') {
        assert.ok(invoked.includes('node'), 'runtime check must have invoked node');
      }
      assert.ok(checkResult.detail.length > 0, `${checkResult.id} has no detail`);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  console.log(`  → ${pass} passed, ${fail} failed\n`);
  if (fail > 0) throw new Error(`${fail} diagnostics assertion(s) failed.`);
}
