import assert from 'assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../src/server/storage/MemoryStore.js';
import { CheckpointStore } from '../src/server/storage/CheckpointStore.js';
import { TrajectoryStore } from '../src/server/storage/TrajectoryStore.js';
import { ToolExecutor } from '../src/server/tools/ToolExecutor.js';
import { SelfDevelopmentEngine } from '../src/server/development/SelfDevelopmentEngine.js';
import { SelfRepairEngine } from '../src/engine/repair/self-repair-engine.js';
import { FilePersistentStore } from '../src/engine/memory/file-persistent.js';
import { ToolRegistry } from '../src/engine/tools/registry.js';

export async function runDevelopmentTests() {
  console.log('--- Testing 10-Step Self-Development & Checkpointing ---');

  const memoryStore = new MemoryStore();
  const checkpointStore = new CheckpointStore();
  const trajectoryStore = new TrajectoryStore();
  const toolExecutor = new ToolExecutor(memoryStore, checkpointStore);
  const engine = new SelfDevelopmentEngine(checkpointStore, trajectoryStore, toolExecutor);

  // 1. Unauthenticated self-development attempt must be safely blocked
  const unauthRes = await engine.executeCycle(
    { instruction: 'Modify core engine loop without authorization' },
    false // not developer authenticated
  );
  assert.strictEqual(unauthRes.status, 'REVERTED_ON_FAILURE');
  assert.ok(unauthRes.steps.some((s) => s.outcome === 'Blocked'));

  // 2. An authenticated cycle with no grounded change must stop honestly.
  //
  // This used to assert `steps.length === 10` for an instruction that names no
  // file and produces no patch — which only passed because the engine reported
  // "Modify Source Files: Completed" without touching disk. A run that cannot
  // ground a change is now BLOCKED at step 4, and that is the correct outcome:
  // reporting ten green steps for an unchanged tree is the defect, not the spec.
  const authRes = await engine.executeCycle(
    { instruction: 'Verify system integrity and baseline check' },
    true // developer authenticated
  );
  assert.strictEqual(authRes.status, 'BLOCKED', 'An ungroundable instruction must be BLOCKED');
  assert.ok(authRes.blocker, 'A blocked run must explain why');
  assert.strictEqual(authRes.trajectory.changedFiles.length, 0, 'A blocked run must change no files');
  assert.strictEqual(authRes.trajectory.testOutcome, 'not_run', 'A blocked run must not claim tests ran');
  assert.ok(authRes.checkpointId, 'Must create a checkpoint before any mutation attempt');

  // 2b. A grounded instruction must actually change the file and report it.
  const groundedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-dev-grounded-'));
  try {
    fs.mkdirSync(path.join(groundedRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(groundedRoot, 'src', 'sample.ts'),
      'export const alpha = 1;\nexport const beta = 2;\n',
      'utf-8',
    );
    const groundedExecutor = new ToolExecutor(
      new MemoryStore(),
      new CheckpointStore(),
      undefined,
      undefined,
      undefined,
      groundedRoot,
    );
    const groundedEngine = new SelfDevelopmentEngine(
      new CheckpointStore(),
      new TrajectoryStore(),
      groundedExecutor,
      groundedRoot,
    );
    const grounded = await groundedEngine.executeCycle(
      { instruction: 'rename alpha to omega in src/sample.ts' },
      true,
    );
    const onDisk = fs.readFileSync(path.join(groundedRoot, 'src', 'sample.ts'), 'utf-8');
    assert.ok(onDisk.includes('omega'), 'A grounded self-build must change the file on disk');
    assert.ok(
      grounded.trajectory.changedFiles.includes('src/sample.ts'),
      'changedFiles must list the file that really changed',
    );
    assert.ok((grounded.diffs || []).length > 0, 'A real change must produce a real diff');
  } finally {
    fs.rmSync(groundedRoot, { recursive: true, force: true });
  }

  // 3. Verify trajectory is stored in TrajectoryStore
  const recorded = trajectoryStore.getAll();
  assert.ok(recorded.length > 0, 'Trajectory must be persisted');
  assert.ok(recorded.some((t) => t.task.includes('Verify system integrity')));

  // The advertised harmless repair demonstration must perform a real isolated
  // repair and must not leave its temporary fixture behind.
  const repairDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-repair-store-test-'));
  try {
    const repairStore = new FilePersistentStore(repairDataDir);
    const repairEngine = new SelfRepairEngine(repairStore, new ToolRegistry());
    const repairDemo = await repairEngine.testHarmlessFaultSelfRepair();
    assert.strictEqual(repairDemo.success, true, 'Harmless syntax fault must be repaired and independently verified');
    assert.strictEqual(repairDemo.repairResult.status, 'REPAIRED_AND_VERIFIED');
    assert.ok(repairDemo.auditLog.some((line) => line.includes('PASS: true')));
  } finally {
    fs.rmSync(repairDataDir, { recursive: true, force: true });
  }

  console.log('✓ 10-Step Self-Development & Checkpointing tests passed.');
}
