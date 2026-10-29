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

  // 1. Unauthenticated self-development attempt must be safely blocked and must
  //    not have created a checkpoint or touched a file.
  const unauthRes = await engine.executeCycle(
    { instruction: 'Modify core engine loop without authorization' },
    false // not developer authenticated
  );
  assert.strictEqual(unauthRes.status, 'BLOCKED_UNAUTHORIZED');
  assert.ok(unauthRes.steps.some((s) => s.outcome === 'blocked'));
  assert.strictEqual(unauthRes.checkpointId, null, 'A blocked run may not take a checkpoint');
  assert.strictEqual(unauthRes.changedFiles.length, 0, 'A blocked run may not change files');

  // 2. An authorized cycle that has no derivable file change must NOT be
  //    reported as success. (Reporting 10 green steps for a no-op was the
  //    original defect this suite used to enforce.)
  const noChangeRes = await engine.executeCycle(
    { instruction: 'Verify system integrity and baseline check' },
    true // developer authenticated
  );
  assert.notStrictEqual(noChangeRes.status, 'VERIFIED_SUCCESS', 'A no-op must not claim success');
  assert.ok(noChangeRes.steps.length > 0, 'Steps must be reported');
  assert.strictEqual(noChangeRes.changedFiles.length, 0, 'No files changed without patches');

  // 3. Verify trajectory is stored in TrajectoryStore for both runs
  const recorded = trajectoryStore.getAll();
  assert.ok(recorded.length > 0, 'Trajectory must be persisted');
  assert.ok(recorded.some((t) => t.task.includes('Verify system integrity')));

  console.log('✓ Self-development authorization, no-op honesty and trajectory tests passed.');
}
