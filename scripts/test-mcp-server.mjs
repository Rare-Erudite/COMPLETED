#!/usr/bin/env node
/**
 * A minimal, real MCP server used to prove RARE's plugin lifecycle end to end.
 *
 * It speaks the actual Model Context Protocol over stdio using the official
 * SDK, so RARE's MCP client performs a genuine `initialize` handshake and
 * `tools/list` discovery against it — nothing is mocked. It exposes two tools:
 *
 *   echo        — returns the text it was given (proves a round trip)
 *   add_numbers — returns the real sum of two numbers (proves real execution)
 *
 * Run: node scripts/test-mcp-server.mjs
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'rare-test-plugin', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: 'Return the text it was given, unchanged.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Text to echo back.' } },
        required: ['text'],
      },
    },
    {
      name: 'add_numbers',
      description: 'Return the real sum of two numbers.',
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'First addend.' },
          b: { type: 'number', description: 'Second addend.' },
        },
        required: ['a', 'b'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === 'echo') {
    return { content: [{ type: 'text', text: String(args?.text ?? '') }] };
  }
  if (name === 'add_numbers') {
    const a = Number(args?.a);
    const b = Number(args?.b);
    if (Number.isNaN(a) || Number.isNaN(b)) {
      return { content: [{ type: 'text', text: 'Both a and b must be numbers.' }], isError: true };
    }
    return { content: [{ type: 'text', text: String(a + b) }] };
  }
  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
