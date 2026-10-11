import assert from 'assert';
import { MemoryStore } from '../src/server/storage/MemoryStore.js';
import { CheckpointStore } from '../src/server/storage/CheckpointStore.js';
import { ToolExecutor } from '../src/server/tools/ToolExecutor.js';
import { BenchmarkSuite } from '../src/server/evaluation/BenchmarkSuite.js';

export async function runEvaluationTests() {
  console.log('--- Testing Reproducible Benchmark Evaluation Suite ---');

  const memoryStore = new MemoryStore();
  const checkpointStore = new CheckpointStore();
  const toolExecutor = new ToolExecutor(memoryStore, checkpointStore);
  const suite = new BenchmarkSuite(toolExecutor, memoryStore, checkpointStore);

  // 1. Initial state before run must be un-evaluated
  assert.strictEqual(suite.getLastReport(), null, 'Before execution, evaluation must not have fabricated baseline');

  // 2. Run benchmark suite and verify empirical results
  const report = await suite.runSuite('RARE Offline Cognitive Engine');
  assert.strictEqual(report.evaluated, true);
  assert.strictEqual(typeof report.overallScore, 'number');
  assert.ok(report.totalTests >= 6, 'Must test at least 6 capability test cases');
  assert.strictEqual(report.passedTests + report.failedTests, report.totalTests);

  // 3. Verify all 6 capability vectors are scored
  assert.ok(report.vectors.reasoning >= 0);
  assert.ok(report.vectors.coding >= 0);
  assert.ok(report.vectors.debugging_repair >= 0);
  assert.ok(report.vectors.tool_use >= 0);
  assert.ok(report.vectors.memory_recall >= 0);
  assert.ok(report.vectors.safety_sandbox >= 0);

  console.log(`✓ Benchmark Suite evaluated: Overall score ${report.overallScore}% (${report.passedTests}/${report.totalTests} passed)`);
}
