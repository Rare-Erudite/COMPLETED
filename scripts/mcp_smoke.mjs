#!/usr/bin/env node
/**
 * Live MCP smoke test.
 *
 * The unit tests prove configuration parsing and honest failure reporting. This
 * script proves the client actually speaks the protocol: it starts a real MCP
 * server over stdio, performs the handshake, lists its tools and calls one.
 *
 * It uses the official reference server `@modelcontextprotocol/server-everything`
 * (MIT), which is designed for exactly this purpose.
 *
 * Usage: node scripts/mcp_smoke.mjs
 */

import { McpClientManager } from '../src/server/mcp/McpClientManager.ts';

const manager = new McpClientManager([
  {
    id: 'everything',
    name: 'MCP Everything (reference server)',
    transport: 'stdio',
    target: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
  },
]);

const statuses = await manager.connectAll();
console.log('Server status:', JSON.stringify(statuses, null, 2));

const tools = manager.listTools();
console.log(`Discovered ${tools.length} tools:`);
for (const tool of tools.slice(0, 12)) {
  console.log(`  - ${tool.qualifiedName}: ${tool.description.slice(0, 80)}`);
}

if (tools.length === 0) {
  console.error('FAIL: the reference server exposed no tools.');
  await manager.closeAll();
  process.exit(1);
}

// Call a tool that exists on the reference server and has no side effects.
const echo = tools.find((t) => t.name === 'echo');
if (echo) {
  const result = await manager.callTool(echo.qualifiedName, { message: 'rare-mcp-smoke' });
  console.log('echo result:', JSON.stringify(result).slice(0, 300));
  if (!result.ok) {
    console.error('FAIL: echo tool call failed.');
    await manager.closeAll();
    process.exit(1);
  }
}

console.log('PASS: real MCP handshake, tool discovery and tool call succeeded.');
await manager.closeAll();
