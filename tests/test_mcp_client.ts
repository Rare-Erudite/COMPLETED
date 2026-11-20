import assert from 'node:assert/strict';
import { parseServerConfig, McpClientManager } from '../src/server/mcp/McpClientManager.js';

/**
 * MCP client tests.
 *
 * These prove the parts that can be proven without spawning a real server:
 * configuration parsing, honest status reporting for an unreachable server, and
 * the qualified-name contract the executor relies on. A live stdio handshake is
 * exercised separately by scripts/mcp_smoke.mjs, which starts a real server.
 */
export async function runMcpTests(): Promise<void> {
  console.log('\n[mcp-client]');

  // 1. Empty configuration is not an error, and reports zero servers.
  const empty = parseServerConfig(undefined);
  assert.deepEqual(empty.servers, []);
  assert.equal(empty.error, undefined);
  console.log('  ✓ an unset RARE_MCP_SERVERS yields no servers and no error');

  // 2. Malformed JSON is reported, not thrown.
  const malformed = parseServerConfig('{not json');
  assert.equal(malformed.servers.length, 0);
  assert.ok(malformed.error && malformed.error.includes('not valid JSON'));
  console.log('  ✓ malformed configuration is reported as an error, not a crash');

  // 3. A valid array is parsed, with transport defaulting to stdio.
  const parsed = parseServerConfig(JSON.stringify([
    { id: 'fs', name: 'Filesystem', target: 'npx', args: ['-y', 'server-filesystem'] },
    { id: 'remote', transport: 'sse', target: 'https://example.com/sse' },
  ]));
  assert.equal(parsed.servers.length, 2);
  assert.equal(parsed.servers[0].transport, 'stdio');
  assert.deepEqual(parsed.servers[0].args, ['-y', 'server-filesystem']);
  assert.equal(parsed.servers[1].transport, 'sse');
  console.log('  ✓ valid configuration is parsed and transport defaults to stdio');

  // 4. An unreachable server is reported as disconnected with the real error,
  //    never as available.
  const manager = new McpClientManager([
    { id: 'dead', name: 'Dead server', transport: 'stdio', target: 'definitely-not-a-real-binary-rare' },
  ]);
  const statuses = await manager.connectAll();
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].connected, false);
  assert.ok(statuses[0].error, 'a failed connection must carry an error message');
  assert.equal(manager.listTools().length, 0);
  console.log('  ✓ an unreachable server is reported disconnected with its real error');

  // 5. Calling a tool on a disconnected server fails honestly.
  const call = await manager.callTool('dead__anything', {});
  assert.equal(call.ok, false);
  assert.ok(call.error && call.error.includes('not connected'));
  console.log('  ✓ calling a tool on a disconnected server fails with a clear reason');

  // 6. An unqualified tool name is rejected rather than guessed.
  const unqualified = await manager.callTool('noSeparator', {});
  assert.equal(unqualified.ok, false);
  assert.ok(unqualified.error && unqualified.error.includes('qualified'));
  console.log('  ✓ an unqualified tool name is rejected');

  await manager.closeAll();
}
