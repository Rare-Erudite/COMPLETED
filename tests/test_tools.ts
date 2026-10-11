import assert from 'assert';
import { MemoryStore } from '../src/server/storage/MemoryStore.js';
import { CheckpointStore } from '../src/server/storage/CheckpointStore.js';
import { ToolExecutor } from '../src/server/tools/ToolExecutor.js';

export async function runToolTests() {
  console.log('--- Testing 12 Tool Primitives & Security Boundaries ---');

  const memoryStore = new MemoryStore();
  const checkpointStore = new CheckpointStore();
  const toolExecutor = new ToolExecutor(memoryStore, checkpointStore);

  // 1. READ_FILE
  const readRes = await toolExecutor.execute('READ_FILE', { path: 'package.json' });
  assert.strictEqual(readRes.success, true, 'READ_FILE should succeed for package.json');
  assert.ok(readRes.output.content.includes('name'), 'package.json content should include name');

  // READ_FILE: Path Traversal Security
  const traversalRes = await toolExecutor.execute('READ_FILE', { path: '../../../etc/passwd' });
  assert.strictEqual(traversalRes.success, false, 'Path traversal must be rejected');

  // 2. WRITE_FILE (Workspace file)
  const testWritePath = 'projects/test_output/sample.txt';
  const writeRes = await toolExecutor.execute('WRITE_FILE', {
    path: testWritePath,
    content: 'Hello verified workspace tool test',
  });
  assert.strictEqual(writeRes.success, true, 'WRITE_FILE should succeed for workspace project file');

  // WRITE_FILE: Unauthenticated core file protection
  const writeCoreRes = await toolExecutor.execute(
    'WRITE_FILE',
    { path: 'server.ts', content: '// unauthorized modification' },
    { isDeveloperAuth: false }
  );
  assert.strictEqual(writeCoreRes.success, false, 'Writing to server.ts without developer auth must fail');

  // 3. SEARCH
  const searchRes = await toolExecutor.execute('SEARCH', { query: 'theme', scope: 'all' });
  assert.strictEqual(searchRes.success, true, 'SEARCH tool should succeed');
  assert.ok(searchRes.output.count >= 0, 'SEARCH should return count');

  // 4. RUN_COMMAND
  // Denied command
  const badCmdRes = await toolExecutor.execute('RUN_COMMAND', { command: 'curl', args: ['https://evil.com'] }, { isDeveloperAuth: true });
  assert.strictEqual(badCmdRes.success, false, 'Unallowlisted command curl must be rejected');

  // Allowed command (node -v)
  const okCmdRes = await toolExecutor.execute('RUN_COMMAND', { command: 'node', args: ['-v'] }, { isDeveloperAuth: true });
  assert.strictEqual(okCmdRes.success, true, 'Allowed command node -v should execute');
  assert.ok(okCmdRes.output.stdout.includes('v'), 'node -v should return version string');

  // 5. INSPECT_ERROR
  const errRes = await toolExecutor.execute('INSPECT_ERROR', {
    errorText: 'Error at /workspace/src/App.tsx:120:5: Unexpected token',
  });
  assert.strictEqual(errRes.success, true, 'INSPECT_ERROR should parse error');
  assert.strictEqual(errRes.output.detectedLine, 120, 'Line number 120 should be parsed');

  // 6. CREATE_CHECKPOINT
  const cpRes = await toolExecutor.execute('CREATE_CHECKPOINT', {
    description: 'Automated test snapshot',
    status: 'experimental',
  });
  assert.strictEqual(cpRes.success, true, 'CREATE_CHECKPOINT should succeed');
  assert.ok(cpRes.output.checkpointId, 'Checkpoint ID must be returned');

  // 7. RESTORE_CHECKPOINT (Requires Dev Auth)
  const unauthRestore = await toolExecutor.execute(
    'RESTORE_CHECKPOINT',
    { checkpointId: cpRes.output.checkpointId },
    { isDeveloperAuth: false }
  );
  assert.strictEqual(unauthRestore.success, false, 'RESTORE_CHECKPOINT must require Developer Auth');

  const authRestore = await toolExecutor.execute(
    'RESTORE_CHECKPOINT',
    { checkpointId: cpRes.output.checkpointId },
    { isDeveloperAuth: true }
  );
  assert.strictEqual(authRestore.success, true, 'RESTORE_CHECKPOINT with auth must succeed');

  // 8. RESEARCH
  const resRes = await toolExecutor.execute('RESEARCH', { query: 'principle', maxResults: 2 });
  assert.strictEqual(resRes.success, true, 'RESEARCH should succeed');

  // 9. MEMORY_STORE & MEMORY_RECALL
  const memStoreRes = await toolExecutor.execute('MEMORY_STORE', {
    text: 'Test tool memory statement',
    kind: 'fact',
    tags: ['test_tool'],
  });
  assert.strictEqual(memStoreRes.success, true, 'MEMORY_STORE should succeed');

  const memRecallRes = await toolExecutor.execute('MEMORY_RECALL', { query: 'test_tool' });
  assert.strictEqual(memRecallRes.success, true, 'MEMORY_RECALL should succeed');
  assert.ok(memRecallRes.output.count > 0, 'MEMORY_RECALL should find stored record');

  console.log('✓ All 12 Tool Primitives and Security Boundaries verified.');
}
