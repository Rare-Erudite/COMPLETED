import assert from 'assert';
import { MemoryStore } from '../src/server/storage/MemoryStore.js';
import { CheckpointStore } from '../src/server/storage/CheckpointStore.js';
import { TrajectoryStore } from '../src/server/storage/TrajectoryStore.js';
import { ToolExecutor } from '../src/server/tools/ToolExecutor.js';
import { SelfDevelopmentEngine } from '../src/server/development/SelfDevelopmentEngine.js';

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

  console.log('✓ 10-Step Self-Development & Checkpointing tests passed.');
}
