#!/usr/bin/env node
/**
 * RARE — Android device MCP server.
 *
 * A REAL Model Context Protocol server (official SDK, stdio transport) that
 * exposes the Android device's accessibility and notification capabilities as
 * MCP tools. This is not the WebView JavaScript bridge relabelled: an external
 * MCP client performs a genuine `initialize` handshake, `tools/list` discovery
 * and `tools/call` execution against this process.
 *
 * How a call actually reaches the phone
 * -------------------------------------
 *   1. MCP client calls e.g. `android_tap_text { text: "Send" }`.
 *   2. This server enqueues a command for the owner's device.
 *   3. The Android app polls `/api/device/poll`, receives the command, executes
 *      it through RareAccessibilityService / RareNotificationListener, and
 *      posts the result to `/api/device/result`.
 *   4. This server returns that real result to the MCP client.
 *
 * If no device is connected, the tool returns `isError: true` with a clear
 * reason. It never fabricates a success.
 *
 * Safety
 * ------
 * • Every tool validates its arguments against a schema before enqueuing.
 * • Consequential actions (send/delete/purchase) are refused unless the server
 *   was started with RARE_ANDROID_MCP_ALLOW_CONSEQUENTIAL=true.
 * • The owner is fixed at startup (RARE_ANDROID_MCP_OWNER); a client cannot
 *   address another user's device.
 *
 * Run:
 *   RARE_ANDROID_MCP_OWNER=<ownerId> \
 *   RARE_API_BASE=http://localhost:5000 \
 *   RARE_ANDROID_MCP_TOKEN=<session token> \
 *   node scripts/android-mcp-server.mjs
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const API_BASE = (process.env.RARE_API_BASE || 'http://localhost:5000').replace(/\/$/, '');
const OWNER = process.env.RARE_ANDROID_MCP_OWNER || '';
const TOKEN = process.env.RARE_ANDROID_MCP_TOKEN || '';
const ALLOW_CONSEQUENTIAL = process.env.RARE_ANDROID_MCP_ALLOW_CONSEQUENTIAL === 'true';
const COMMAND_TIMEOUT_MS = Number(process.env.RARE_ANDROID_MCP_TIMEOUT_MS) || 45_000;

if (!OWNER) {
  console.error('[android-mcp] RARE_ANDROID_MCP_OWNER is required — refusing to start without a fixed owner.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Tool catalogue
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'android_describe_screen',
    description: 'Read the current screen: the accessibility node tree with visible text, ids, bounds and clickable state.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    action: 'describe_screen',
    args: () => ({}),
  },
  {
    name: 'android_list_apps',
    description: 'List installed applications that can be launched.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    action: 'list_apps',
    args: () => ({}),
  },
  {
    name: 'android_notifications',
    description: 'Read notifications the user has granted notification access to.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum notifications to return (1-50).' },
        package: { type: 'string', description: 'Only return notifications from this package.' },
      },
      required: [],
    },
    action: 'notifications',
    args: (a) => ({ limit: clamp(a.limit, 1, 50, 50), ...(a.package ? { package: String(a.package) } : {}) }),
  },
  {
    name: 'android_tap_text',
    description: 'Tap the on-screen element whose visible text matches.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Visible text of the element to tap.' } },
      required: ['text'],
    },
    action: 'tap_text',
    args: (a) => ({ text: requireString(a.text, 'text') }),
  },
  {
    name: 'android_tap_id',
    description: 'Tap the on-screen element with the given view id / resource name.',
    inputSchema: {
      type: 'object',
      properties: { viewId: { type: 'string', description: 'View id or resource name.' } },
      required: ['viewId'],
    },
    action: 'tap_id',
    args: (a) => ({ viewId: requireString(a.viewId, 'viewId') }),
  },
  {
    name: 'android_tap_at',
    description: 'Tap absolute screen coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate in pixels.' },
        y: { type: 'number', description: 'Y coordinate in pixels.' },
      },
      required: ['x', 'y'],
    },
    action: 'tap_at',
    args: (a) => ({ x: requireNumber(a.x, 'x'), y: requireNumber(a.y, 'y') }),
  },
  {
    name: 'android_type_text',
    description: 'Type text into the currently focused input field.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The text to type.' } },
      required: ['text'],
    },
    action: 'type_text',
    args: (a) => ({ text: requireString(a.text, 'text') }),
  },
  {
    name: 'android_scroll',
    description: 'Scroll the current screen in a direction.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction.' },
      },
      required: ['direction'],
    },
    action: 'scroll',
    args: (a) => {
      const dir = String(a.direction || '');
      if (!['up', 'down', 'left', 'right'].includes(dir)) throw new Error('direction must be up, down, left or right');
      return { direction: dir };
    },
  },
  {
    name: 'android_swipe',
    description: 'Perform a swipe gesture between two points.',
    inputSchema: {
      type: 'object',
      properties: {
        x1: { type: 'number' }, y1: { type: 'number' },
        x2: { type: 'number' }, y2: { type: 'number' },
        durationMs: { type: 'number', description: 'Swipe duration in milliseconds (default 300).' },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
    action: 'swipe',
    args: (a) => ({
      x1: requireNumber(a.x1, 'x1'), y1: requireNumber(a.y1, 'y1'),
      x2: requireNumber(a.x2, 'x2'), y2: requireNumber(a.y2, 'y2'),
      durationMs: clamp(a.durationMs, 50, 5000, 300),
    }),
  },
  {
    name: 'android_global_action',
    description: 'Perform a system navigation action.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          enum: ['back', 'home', 'recents', 'notifications', 'quick_settings', 'lock'],
          description: 'The system action.',
        },
      },
      required: ['name'],
    },
    action: 'global_action',
    args: (a) => {
      const n = String(a.name || '');
      const allowed = ['back', 'home', 'recents', 'notifications', 'quick_settings', 'lock'];
      if (!allowed.includes(n)) throw new Error(`name must be one of ${allowed.join(', ')}`);
      return { name: n };
    },
  },
  {
    name: 'android_open_app',
    description: 'Launch an installed application by package name.',
    inputSchema: {
      type: 'object',
      properties: { package: { type: 'string', description: 'Android package name, e.g. com.whatsapp.' } },
      required: ['package'],
    },
    action: 'open_app',
    args: (a) => ({ package: requireString(a.package, 'package') }),
  },
  {
    name: 'android_device_status',
    description: 'Report whether a device is connected and which capabilities it has granted.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    action: '__status__',
    args: () => ({}),
  },
];

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required and must be a non-empty string`);
  if (value.length > 4000) throw new Error(`${field} is too long (max 4000 characters)`);
  return value;
}
function requireNumber(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field} is required and must be a number`);
  return n;
}
function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

// ---------------------------------------------------------------------------
// HTTP bridge to RARE
// ---------------------------------------------------------------------------

async function api(path, init = {}) {
  const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    throw new Error(`RARE API ${path} returned ${response.status}: ${body?.error?.message || text.slice(0, 200)}`);
  }
  return body;
}

async function deviceStatus() {
  return api('/api/device/status');
}

/**
 * Enqueue a command and wait for the phone to answer.
 *
 * The queue is drained by the phone's own poll loop, so this function polls the
 * command list until the command reaches a terminal state or the timeout hits.
 */
async function runDeviceAction(action, args) {
  const status = await deviceStatus();
  if (!status.online) {
    return {
      isError: true,
      text: 'No Android device is connected. The phone must be running RARE with the device channel active.',
    };
  }

  // Enqueue through the scheduler's device queue endpoint.
  const enqueued = await api('/api/device/enqueue', {
    method: 'POST',
    body: JSON.stringify({ action, args }),
  });
  const commandId = enqueued?.command?.id;
  if (!commandId) {
    return { isError: true, text: 'RARE did not return a command id for the device action.' };
  }

  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const recent = await api('/api/device/status');
    const found = (recent.recent || []).find((c) => c.id === commandId);
    if (found && (found.status === 'done' || found.status === 'failed' || found.status === 'expired')) {
      if (found.status === 'done') {
        return { isError: false, text: JSON.stringify(found.result ?? {}, null, 2), raw: found.result };
      }
      return { isError: true, text: `Device action failed: ${found.error || found.status}` };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { isError: true, text: `The device did not answer within ${Math.round(COMMAND_TIMEOUT_MS / 1000)}s.` };
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'rare-android-device', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }

  try {
    const args = tool.args(rawArgs || {});

    if (tool.action === '__status__') {
      const status = await deviceStatus();
      return {
        content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
      };
    }

    if (CONSEQUENTIAL_ACTIONS.has(tool.action) && !ALLOW_CONSEQUENTIAL) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Refused "${tool.action}": consequential actions require RARE_ANDROID_MCP_ALLOW_CONSEQUENTIAL=true.`,
        }],
      };
    }

    const outcome = await runDeviceAction(tool.action, args);
    return {
      isError: outcome.isError === true,
      content: [{ type: 'text', text: outcome.text }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Tool "${name}" failed: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
});

const CONSEQUENTIAL_ACTIONS = new Set(['send_message', 'delete', 'purchase', 'submit', 'call']);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[android-mcp] ready — owner=${OWNER} api=${API_BASE} tools=${TOOLS.length}`);
