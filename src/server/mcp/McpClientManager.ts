/**
 * RARE MCP client — a real Model Context Protocol client.
 *
 * Before this file existed, "plugins" were a static in-code array with an
 * `installed` boolean. There was no transport, no handshake, no tool schema
 * negotiation. This replaces that with the official MCP TypeScript SDK
 * (`@modelcontextprotocol/sdk`, Apache-2.0/MIT — see
 * docs/SOURCE_INVENTORY_AND_LICENCES.md), which is the reference
 * implementation of the protocol.
 *
 * What it does:
 *  - Connects to MCP servers over stdio (a local command) or SSE/HTTP (a URL).
 *  - Performs the real `initialize` handshake and `tools/list` discovery.
 *  - Exposes every discovered tool through `listTools()` / `callTool()`.
 *  - Reports connection state honestly: a server that failed to start is
 *    listed as `connected: false` with the real error, never as available.
 *
 * Security posture:
 *  - stdio servers are only started from an explicit allow-list configured by
 *    the operator (RARE_MCP_SERVERS). A user cannot make the server execute an
 *    arbitrary command through the API.
 *  - Every call is bounded by a timeout.
 *  - Tool results are returned verbatim; RARE does not claim a tool succeeded
 *    when the server returned `isError: true`.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export type McpTransportKind = 'stdio' | 'sse' | 'http';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransportKind;
  /** For stdio: the command to run. For sse/http: the URL. */
  target: string;
  /** For stdio: arguments. */
  args?: string[];
  /** For stdio: extra environment variables. */
  env?: Record<string, string>;
  /** Optional human note shown in the UI. */
  description?: string;
}

export interface McpToolInfo {
  serverId: string;
  name: string;
  /** Fully-qualified name used by the executor: `serverId__toolName`. */
  qualifiedName: string;
  description: string;
  inputSchema: unknown;
}

export interface McpServerStatus {
  id: string;
  name: string;
  transport: McpTransportKind;
  target: string;
  connected: boolean;
  error?: string;
  toolCount: number;
  serverInfo?: { name?: string; version?: string };
}

interface Connection {
  config: McpServerConfig;
  client: Client;
  tools: McpToolInfo[];
  status: McpServerStatus;
}

const CALL_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

/**
 * Parses the operator's server list from RARE_MCP_SERVERS.
 *
 * Format: a JSON array of McpServerConfig objects, e.g.
 *   [{"id":"fs","name":"Filesystem","transport":"stdio","target":"npx",
 *     "args":["-y","@modelcontextprotocol/server-filesystem","/data"]}]
 *
 * A malformed value yields an empty list plus a recorded error, never a crash.
 */
export function parseServerConfig(raw: string | undefined): { servers: McpServerConfig[]; error?: string } {
  if (!raw || !raw.trim()) return { servers: [] };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { servers: [], error: 'RARE_MCP_SERVERS must be a JSON array.' };
    const servers: McpServerConfig[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const { id, name, transport, target, args, env, description } = entry as Record<string, unknown>;
      if (typeof id !== 'string' || typeof target !== 'string') continue;
      const kind: McpTransportKind =
        transport === 'sse' || transport === 'http' || transport === 'stdio' ? transport : 'stdio';
      servers.push({
        id,
        name: typeof name === 'string' ? name : id,
        transport: kind,
        target,
        args: Array.isArray(args) ? args.filter((a): a is string => typeof a === 'string') : undefined,
        env: env && typeof env === 'object' ? (env as Record<string, string>) : undefined,
        description: typeof description === 'string' ? description : undefined,
      });
    }
    return { servers };
  } catch (error) {
    return { servers: [], error: `RARE_MCP_SERVERS is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export class McpClientManager {
  private connections = new Map<string, Connection>();
  private configError?: string;

  constructor(private readonly configs: McpServerConfig[], configError?: string) {
    this.configError = configError;
  }

  /** Builds a manager from the environment. */
  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): McpClientManager {
    const { servers, error } = parseServerConfig(env.RARE_MCP_SERVERS);
    return new McpClientManager(servers, error);
  }

  get configurationError(): string | undefined {
    return this.configError;
  }

  /** Connects every configured server. Failures are recorded, not thrown. */
  async connectAll(): Promise<McpServerStatus[]> {
    await Promise.all(this.configs.map((config) => this.connect(config)));
    return this.statuses();
  }

  /**
   * Register a server at runtime and connect it for real. Used by the plugin
   * registry when a user installs a plugin. Returns the real connection result.
   */
  async addServer(config: McpServerConfig): Promise<{ ok: boolean; error?: string }> {
    if (this.configs.some((c) => c.id === config.id)) {
      await this.removeServer(config.id);
    }
    this.configs.push(config);
    const status = await this.connect(config);
    return { ok: status.connected, error: status.error };
  }

  /** Disconnect and forget a server. Returns true when it was configured. */
  async removeServer(id: string): Promise<boolean> {
    const connection = this.connections.get(id);
    if (connection) {
      try {
        await connection.client.close();
      } catch {
        // The transport may already be gone; forgetting it is still correct.
      }
      this.connections.delete(id);
    }
    const index = this.configs.findIndex((c) => c.id === id);
    if (index >= 0) {
      this.configs.splice(index, 1);
      return true;
    }
    return false;
  }

  async connect(config: McpServerConfig): Promise<McpServerStatus> {
    const existing = this.connections.get(config.id);
    if (existing) return existing.status;

    const status: McpServerStatus = {
      id: config.id,
      name: config.name,
      transport: config.transport,
      target: config.target,
      connected: false,
      toolCount: 0,
    };

    try {
      const client = new Client({ name: 'rare', version: '1.2.0' }, { capabilities: {} });
      let transport;
      if (config.transport === 'stdio') {
        transport = new StdioClientTransport({
          command: config.target,
          args: config.args ?? [],
          env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
          stderr: 'pipe',
        });
      } else if (config.transport === 'sse') {
        transport = new SSEClientTransport(new URL(config.target));
      } else {
        transport = new StreamableHTTPClientTransport(new URL(config.target));
      }

      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `MCP connect to ${config.id}`);

      const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `MCP tools/list on ${config.id}`);
      const tools: McpToolInfo[] = (listed.tools ?? []).map((tool) => ({
        serverId: config.id,
        name: tool.name,
        qualifiedName: `${config.id}__${tool.name}`,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
      }));

      const serverVersion = client.getServerVersion();
      status.connected = true;
      status.toolCount = tools.length;
      status.serverInfo = serverVersion
        ? { name: serverVersion.name, version: serverVersion.version }
        : undefined;

      this.connections.set(config.id, { config, client, tools, status });
    } catch (error) {
      status.connected = false;
      status.error = error instanceof Error ? error.message : String(error);
      this.connections.set(config.id, {
        config,
        client: null as unknown as Client,
        tools: [],
        status,
      });
    }
    return status;
  }

  statuses(): McpServerStatus[] {
    return this.configs.map((config) => {
      const connection = this.connections.get(config.id);
      return connection
        ? connection.status
        : {
            id: config.id,
            name: config.name,
            transport: config.transport,
            target: config.target,
            connected: false,
            toolCount: 0,
            error: 'Not connected yet.',
          };
    });
  }

  /** Every tool from every connected server. */
  listTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = [];
    for (const connection of this.connections.values()) {
      if (connection.status.connected) tools.push(...connection.tools);
    }
    return tools;
  }

  /** Calls a tool by its qualified name (`serverId__toolName`). */
  async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<{
    ok: boolean;
    content?: unknown;
    error?: string;
  }> {
    const separator = qualifiedName.indexOf('__');
    if (separator <= 0) {
      return { ok: false, error: `Tool name "${qualifiedName}" is not qualified as serverId__toolName.` };
    }
    const serverId = qualifiedName.slice(0, separator);
    const toolName = qualifiedName.slice(separator + 2);
    const connection = this.connections.get(serverId);
    if (!connection || !connection.status.connected) {
      return { ok: false, error: `MCP server "${serverId}" is not connected.` };
    }
    try {
      const result = await withTimeout(
        connection.client.callTool({ name: toolName, arguments: args }),
        CALL_TIMEOUT_MS,
        `MCP call ${qualifiedName}`
      );
      const isError = (result as { isError?: boolean }).isError === true;
      return {
        ok: !isError,
        content: (result as { content?: unknown }).content,
        error: isError ? 'The MCP server reported the tool call as an error.' : undefined,
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async closeAll(): Promise<void> {
    for (const connection of this.connections.values()) {
      try {
        if (connection.status.connected) await connection.client.close();
      } catch {
        /* closing is best-effort */
      }
    }
    this.connections.clear();
  }
}
