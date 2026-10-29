/**
 * Proves the self-build engine performs real, verified work.
 *
 * These assertions are behavioural: they read the file back off disk, compare
 * the reported diff with the bytes that actually changed, and check that an
 * unauthorized run leaves the tree byte-identical. They would all fail against
 * the previous implementation, which reported success without writing anything.
 */

import assert from 'assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MemoryStore } from '../src/server/storage/MemoryStore.js';
import { CheckpointStore } from '../src/server/storage/CheckpointStore.js';
import { TrajectoryStore } from '../src/server/storage/TrajectoryStore.js';
import { ToolExecutor } from '../src/server/tools/ToolExecutor.js';
import { SelfDevelopmentEngine } from '../src/server/development/SelfDevelopmentEngine.js';
import { resolveWorkspacePath, unifiedDiff } from '../src/server/development/PatchEngine.js';
import { diagnoseFailure } from '../src/server/development/Diagnosis.js';

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      console.log(`  PASS  ${name}`);
    })
    .catch((error: any) => {
      fail += 1;
      console.error(`  FAIL  ${name} — ${error?.message || error}`);
    });
}

/**
 * The engine resolves paths against `RARE_APP_ROOT`. Point it at a throwaway
 * project so the suite never modifies the real repository.
 */
function makeSandbox(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-selfdev-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'sandbox-app', scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
  );
  fs.writeFileSync(path.join(root, 'src', 'greeting.ts'), 'export const greeting = "hello";\n');
  return root;
}

export async function runRealSelfDevelopmentTests() {
  console.log('[Test Group] Self-build performs real, verified file changes');

  const root = makeSandbox();
  process.env.RARE_APP_ROOT = root;

  const memoryStore = new MemoryStore();
  const checkpointStore = new CheckpointStore();
  const trajectoryStore = new TrajectoryStore();
  const toolExecutor = new ToolExecutor(memoryStore, checkpointStore);
  const engine = new SelfDevelopmentEngine({ checkpointStore, trajectoryStore, toolExecutor });

  const target = path.join(root, 'src', 'greeting.ts');
  const original = fs.readFileSync(target, 'utf-8');

  // ---------------------------------------------------------------------
  // 1. Unauthorized request is refused and writes nothing.
  // ---------------------------------------------------------------------
  await check('unauthorized self-build is blocked and the file is untouched', async () => {
    const result = await engine.executeCycle(
      { instruction: 'change the greeting in src/greeting.ts to "pwned"' },
      false,
    );
    assert.strictEqual(result.status, 'BLOCKED_UNAUTHORIZED');
    assert.strictEqual(result.changedFiles.length, 0);
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), original, 'file must be byte-identical');
    assert.ok(result.steps.every((s) => s.outcome !== 'completed' || s.title === 'Developer authorization') === false
      || result.checkpointId === null, 'no checkpoint should be created before authorization');
    assert.strictEqual(result.checkpointId, null, 'no checkpoint may exist for a blocked run');
  });

  // ---------------------------------------------------------------------
  // 2. Authorized run with real patches actually changes the file.
  // ---------------------------------------------------------------------
  let authorizedResult: any;
  await check('authorized self-build applies the patch to disk', async () => {
    authorizedResult = await engine.executeCycle(
      {
        instruction: 'change the greeting in src/greeting.ts to "goodbye"',
        patches: [{
          path: 'src/greeting.ts',
          operation: 'modify',
          search: 'export const greeting = "hello";',
          replace: 'export const greeting = "goodbye";',
        }],
      },
      true,
    );
    assert.strictEqual(
      fs.readFileSync(target, 'utf-8'),
      'export const greeting = "goodbye";\n',
      'the file on disk must contain the new text',
    );
  });

  // ---------------------------------------------------------------------
  // 3. The reported diff matches what actually changed.
  // ---------------------------------------------------------------------
  await check('reported diff matches the real change', async () => {
    assert.strictEqual(authorizedResult.changedFiles.length, 1, 'exactly one file reported');
    const change = authorizedResult.changedFiles[0];
    assert.strictEqual(change.path, 'src/greeting.ts');
    assert.ok(change.diff.includes('-export const greeting = "hello";'), change.diff);
    assert.ok(change.diff.includes('+export const greeting = "goodbye";'), change.diff);
    assert.strictEqual(change.linesAdded, 1);
    assert.strictEqual(change.linesRemoved, 1);
  });

  // ---------------------------------------------------------------------
  // 4. changedFiles is NOT always empty (the old bug).
  // ---------------------------------------------------------------------
  await check('changedFiles is populated for a real run', async () => {
    assert.ok(authorizedResult.changedFiles.length > 0);
    assert.ok(authorizedResult.trajectory.changedFiles.includes('src/greeting.ts'));
  });

  // ---------------------------------------------------------------------
  // 5. Acceptance criteria were evaluated with real evidence.
  // ---------------------------------------------------------------------
  await check('acceptance criteria carry real evidence, not assertions', async () => {
    assert.ok(authorizedResult.criteria.length > 0);
    for (const entry of authorizedResult.criteria) {
      assert.ok(typeof entry.evidence === 'string' && entry.evidence.length > 0,
        `criterion ${entry.criterion.id} has no evidence`);
    }
    const content = authorizedResult.criteria.find((c: any) => c.criterion.kind === 'content');
    assert.ok(content, 'the quoted expectation should produce a content criterion');
    assert.strictEqual(content.satisfied, true);
  });

  // ---------------------------------------------------------------------
  // 6. A failing acceptance criterion triggers diagnosis and rollback.
  // ---------------------------------------------------------------------
  await check('a patch that breaks a criterion is diagnosed and reverted', async () => {
    const before = fs.readFileSync(target, 'utf-8');
    const result = await engine.executeCycle(
      {
        // The quoted expectation will not be met, so the content criterion fails.
        instruction: 'set the greeting in src/greeting.ts to "unreachable"',
        patches: [{
          path: 'src/greeting.ts',
          operation: 'modify',
          search: 'export const greeting = "goodbye";',
          replace: 'export const greeting = "still-not-it";',
        }],
      },
      true,
    );
    assert.strictEqual(result.status, 'REVERTED_ON_FAILURE', `got ${result.status}`);
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), before, 'checkpoint must be restored');
    assert.ok(result.steps.some((s) => s.title === 'Diagnose failure'), 'must diagnose');
    assert.ok(result.steps.some((s) => s.outcome === 'reverted'), 'must report the rollback');
    assert.ok(result.steps.some((s) => s.title === 'Rollback' && /Restored/.test(s.details)),
      'rollback must say it restored files');
  });

  // ---------------------------------------------------------------------
  // 7. A request with no patches is not reported as implemented.
  // ---------------------------------------------------------------------
  await check('a request with no derivable change is not claimed as success', async () => {
    const before = fs.readFileSync(target, 'utf-8');
    const result = await engine.executeCycle(
      { instruction: 'make the app nicer' },
      true,
    );
    assert.notStrictEqual(result.status, 'VERIFIED_SUCCESS', 'must not claim success');
    assert.strictEqual(result.changedFiles.length, 0);
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), before, 'nothing may change');
    assert.ok(result.blockedReason, 'must state why it stopped');
    assert.ok(result.steps.some((s) => s.title === 'Plan changes' && s.outcome === 'failed'));
  });

  // ---------------------------------------------------------------------
  // 8. A stale patch (file changed under us) is refused, not partially applied.
  // ---------------------------------------------------------------------
  await check('a stale search block is refused without writing', async () => {
    fs.writeFileSync(target, 'export const greeting = "drifted";\n');
    const before = fs.readFileSync(target, 'utf-8');
    const result = await engine.executeCycle(
      {
        instruction: 'change the greeting in src/greeting.ts',
        patches: [{
          path: 'src/greeting.ts',
          operation: 'modify',
          search: 'export const greeting = "hello";', // no longer present
          replace: 'export const greeting = "x";',
        }],
      },
      true,
    );
    assert.notStrictEqual(result.status, 'VERIFIED_SUCCESS');
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), before, 'file must be unchanged');
  });

  // ---------------------------------------------------------------------
  // 9. Path traversal cannot escape the project root.
  // ---------------------------------------------------------------------
  await check('path traversal is rejected', async () => {
    assert.strictEqual(resolveWorkspacePath(root, '../../etc/passwd'), null);
    assert.strictEqual(resolveWorkspacePath(root, '/etc/passwd'), null);
    assert.strictEqual(resolveWorkspacePath(root, 'src/../src/greeting.ts'), null,
      'any .. segment is refused, even one that resolves inside');
  });

  // ---------------------------------------------------------------------
  // 10. Diff helper is stable and empty for identical input.
  // ---------------------------------------------------------------------
  await check('diff is empty for identical content and non-empty otherwise', async () => {
    assert.strictEqual(unifiedDiff('a\n', 'a\n', 'f.txt'), '');
    assert.ok(unifiedDiff('a\n', 'b\n', 'f.txt').includes('-a'));
    assert.ok(unifiedDiff('a\n', 'b\n', 'f.txt').includes('+b'));
  });

  // ---------------------------------------------------------------------
  // 11. Diagnosis distinguishes cases that must NOT be auto-repaired.
  // ---------------------------------------------------------------------
  await check('a failing assertion is escalated, not auto-repaired', async () => {
    const d = diagnoseFailure('✗ expected 2 to equal 3', 1, 'tests');
    assert.strictEqual(d.classification, 'test_assertion');
    assert.strictEqual(d.remediation.type, 'developer');
  });

  // ---------------------------------------------------------------------
  // 12. Resume of an interrupted run restores the checkpoint and does NOT
  //     report the interrupted work as complete.
  // ---------------------------------------------------------------------
  await check('an interrupted run resumes by restoring, not by claiming success', async () => {
    const { RunStateStore } = await import('../src/server/development/RunStateStore.js');
    const runStates = new RunStateStore(root);
    const engineWithResume = new SelfDevelopmentEngine({
      checkpointStore,
      trajectoryStore,
      toolExecutor,
      runStateStore: runStates,
    });

    // A verified run to produce a real checkpoint.
    fs.writeFileSync(target, 'export const greeting = "hello";\n');
    const done = await engineWithResume.executeCycle(
      {
        instruction: 'set the greeting in src/greeting.ts to "resumed-value"',
        patches: [{
          path: 'src/greeting.ts', operation: 'modify',
          search: 'export const greeting = "hello";',
          replace: 'export const greeting = "resumed-value";',
        }],
      },
      true,
    );
    assert.strictEqual(done.status, 'VERIFIED_SUCCESS', `${done.status}`);
    assert.ok(done.checkpointId, 'a checkpoint must exist');

    // Simulate an interruption: the run state says 'running' and the file has
    // been mutated, but nothing was verified.
    fs.writeFileSync(target, 'export const greeting = "half applied";\n');
    runStates.save({
      runId: 'sdev_interrupted',
      instruction: 'set the greeting in src/greeting.ts to "resumed-value"',
      checkpointId: done.checkpointId,
      appliedPaths: ['src/greeting.ts'],
      status: 'running',
      startedAt: new Date().toISOString(),
      lastStep: 6,
    });

    const resumed = await engineWithResume.executeCycle(
      {
        instruction: 'set the greeting in src/greeting.ts to "resumed-value"',
        resumeRunId: 'sdev_interrupted',
        patches: [{
          path: 'src/greeting.ts', operation: 'modify',
          search: 'export const greeting = "hello";',
          replace: 'export const greeting = "resumed-value";',
        }],
      },
      true,
    );

    const resumeStep = resumed.steps.find((s) => s.title === 'Resume interrupted run');
    assert.ok(resumeStep, 'must report the resume');
    assert.ok(/Restored checkpoint/.test(resumeStep!.details), resumeStep!.details);
    // The half-applied patch must be gone, and the real change applied.
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), 'export const greeting = "resumed-value";\n');
    // The record is closed out under the same run id — it must no longer be
    // listed as interrupted, or a later resume would try to restore it again.
    const leftover = runStates.load('sdev_interrupted');
    assert.ok(!leftover || leftover.status !== 'running',
      `resumed run left as 'running': ${JSON.stringify(leftover)}`);
    assert.strictEqual(
      runStates.listInterrupted().filter((r) => r.runId === 'sdev_interrupted').length, 0,
      'a resumed run must not remain in the interrupted list',
    );
  });

  await check('the engine records run state so a crash leaves a trace', async () => {
    const { RunStateStore } = await import('../src/server/development/RunStateStore.js');
    const runStates = new RunStateStore(root);
    const engineWithResume = new SelfDevelopmentEngine({
      checkpointStore, trajectoryStore, toolExecutor, runStateStore: runStates,
    });
    fs.writeFileSync(target, 'export const greeting = "hello";\n');
    await engineWithResume.executeCycle(
      { instruction: 'set the greeting in src/greeting.ts to "traced"',
        patches: [{ path: 'src/greeting.ts', operation: 'modify',
          search: 'export const greeting = "hello";', replace: 'export const greeting = "traced";' }] },
      true,
    );
    // A completed run must be closed out, not left as 'running'.
    const interrupted = runStates.listInterrupted();
    assert.strictEqual(interrupted.length, 0, `completed runs left as interrupted: ${interrupted.map(i=>i.runId)}`);
  });

  // ---------------------------------------------------------------------
  // 13. Every completed step is backed by a real operation.
  // ---------------------------------------------------------------------
  await check('steps with outcome=completed are all marked verified or explicitly not', async () => {
    for (const step of authorizedResult.steps) {
      assert.ok(['completed', 'skipped', 'blocked', 'failed', 'reverted', 'not_verified'].includes(step.outcome));
      assert.strictEqual(typeof step.verified, 'boolean');
      if (step.outcome === 'completed' && step.title === 'Apply patches') {
        assert.strictEqual(step.verified, true);
      }
    }
  });

  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.RARE_APP_ROOT;

  console.log(`  → ${pass} passed, ${fail} failed\n`);
  if (fail > 0) throw new Error(`${fail} real self-development assertion(s) failed.`);
}
