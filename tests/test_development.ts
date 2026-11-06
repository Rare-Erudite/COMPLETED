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

  // 2. Authenticated self-development cycle executes full 10 steps
  const authRes = await engine.executeCycle(
    { instruction: 'Verify system integrity and baseline check' },
    true // developer authenticated
  );
  assert.strictEqual(authRes.steps.length, 10, 'Must execute all 10 development steps');
  assert.ok(authRes.checkpointId, 'Must create a checkpoint before mutations');

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
