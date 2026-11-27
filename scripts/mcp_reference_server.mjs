#!/usr/bin/env node
/**
 * RARE reference MCP server — a real Model Context Protocol server over stdio.
 *
 * This exists so the MCP integration can be proven end to end without a paid
 * account, an API key or a network dependency. It is a genuine MCP server: it
 * speaks the protocol on stdin/stdout, performs the `initialize` handshake,
 * advertises tools via `tools/list` and executes them via `tools/call`.
 *
 * The tools are real and deterministic — they compute actual results from
 * their arguments. Nothing here returns a canned "success" string.
 *
 * Tools:
 *   - echo            : returns the text it was given (protocol round-trip proof)
 *   - add             : sums two numbers (real arithmetic)
 *   - now             : current UTC time in ISO 8601
 *   - word_count      : counts words, characters and lines in a string
 *   - sha256          : SHA-256 of a string
 *   - rare_version    : the RARE package version read from package.json
 *
 * Run: node scripts/mcp_reference_server.mjs
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const TOOLS = [
  {
    name: 'echo',
    description: 'Return the given text unchanged. Proves a full protocol round trip.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to return.' } },
      required: ['text'],
    },
  },
  {
    name: 'add',
    description: 'Add two numbers and return the exact sum.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First addend.' },
        b: { type: 'number', description: 'Second addend.' },
      },
      required: ['a', 'b'],
    },
  },
  {
    name: 'now',
    description: 'Return the current UTC time as an ISO 8601 timestamp.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'word_count',
    description: 'Count words, characters and lines in the given text.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to measure.' } },
      required: ['text'],
    },
  },
  {
    name: 'sha256',
    description: 'Return the SHA-256 hex digest of the given text.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to hash.' } },
      required: ['text'],
    },
  },
  {
    name: 'rare_version',
    description: 'Read the RARE package version from package.json.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const server = new Server(
  { name: 'rare-reference', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  const text = (value) => ({ content: [{ type: 'text', text: String(value) }] });

  switch (name) {
    case 'echo':
      return text(args.text ?? '');

    case 'add': {
      const a = Number(args.a);
      const b = Number(args.b);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        return { content: [{ type: 'text', text: 'Both a and b must be numbers.' }], isError: true };
      }
      return text(a + b);
    }

    case 'now':
      return text(new Date().toISOString());

    case 'word_count': {
      const value = String(args.text ?? '');
      const words = value.trim() ? value.trim().split(/\s+/).length : 0;
      return text(JSON.stringify({ words, characters: value.length, lines: value.split('\n').length }));
    }

    case 'sha256':
      return text(crypto.createHash('sha256').update(String(args.text ?? '')).digest('hex'));

    case 'rare_version': {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
        return text(pkg.version || 'unknown');
      } catch (error) {
        return { content: [{ type: 'text', text: `Could not read package.json: ${error.message}` }], isError: true };
      }
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool "${name}".` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
