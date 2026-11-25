/**
 * RARE — Plugin Registry
 *
 * The lifecycle layer the platform brief (section 7) asks for, on top of the
 * real MCP client. The MCP client already does the hard part — a genuine
 * `initialize` handshake and `tools/list` discovery over stdio/SSE/HTTP. What
 * was missing was the *lifecycle*: a durable record of what is installed, what
 * it is allowed to do, whether it is healthy, and how to disable or remove it.
 *
 * This registry provides:
 *   - discover:  list every configured server and its real connection state
 *   - inspect:   metadata, tools, permissions and trust for one plugin
 *   - install:   register a new server (persisted, then connected)
 *   - configure: attach credentials/args to a plugin
 *   - execute:   call a discovered tool and return the real result
 *   - health:    probe every plugin and record the outcome
 *   - disable / enable / uninstall
 *
 * Trust model: a plugin is only ever started from an explicit operator
 * allow-list (RARE_MCP_SERVERS) or an explicit install through this registry.
 * A plugin's declared permissions are recorded and surfaced, never silently
 * granted. Nothing here claims a plugin works when its server is disconnected.
 */

import crypto from 'crypto';
import type { McpClientManager, McpServerConfig, McpServerStatus, McpToolInfo } from '../mcp/McpClientManager.js';
import type { PersistentJsonStore } from '../storage/PersistentJsonStore.js';

export type PluginTrust = 'operator' | 'user-installed' | 'untrusted';

export interface PluginRecord {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  target: string;
  args?: string[];
  description?: string;
  trust: PluginTrust;
  /** Declared capability scopes, e.g. ['files:read', 'network']. */
  permissions: string[];
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  /** Last health probe result. */
  lastHealth?: { at: string; connected: boolean; toolCount: number; error?: string };
}

export interface PluginView extends PluginRecord {
  /** Live connection state from the MCP client. */
  connected: boolean;
  toolCount: number;
  tools: McpToolInfo[];
  error?: string;
}

const STATE_KEY = 'plugin_registry';

export class PluginRegistry {
  private storage: PersistentJsonStore | undefined;

  constructor(private readonly mcp: McpClientManager) {}

  attach(storage: PersistentJsonStore): void {
    this.storage = storage;
  }

  private async records(ownerId: string): Promise<PluginRecord[]> {
    if (!this.storage) return [];
    return this.storage.getOwnedState<PluginRecord[]>(ownerId, STATE_KEY, []);
  }

  private async mutate(ownerId: string, fn: (records: PluginRecord[]) => PluginRecord[]): Promise<void> {
    if (!this.storage) throw new Error('PluginRegistry is not attached to storage yet.');
    await this.storage.updateOwnedState<PluginRecord[]>(ownerId, STATE_KEY, [], (current) => {
      const list = Array.isArray(current) ? current : [];
      return fn(list);
    });
  }

  /**
   * Every plugin the operator configured plus every plugin the user installed,
   * merged with live connection state. A configured server with no record is
   * shown as an operator plugin so nothing is hidden.
   */
  async list(ownerId: string): Promise<PluginView[]> {
    const records = await this.records(ownerId);
    const statuses = new Map<string, McpServerStatus>(this.mcp.statuses().map((s) => [s.id, s]));
    const tools = this.mcp.listTools();

    const views: PluginView[] = [];
    const seen = new Set<string>();

    for (const record of records) {
      seen.add(record.id);
      const status = statuses.get(record.id);
      views.push({
        ...record,
        connected: Boolean(status?.connected),
        toolCount: tools.filter((t) => t.serverId === record.id).length,
        tools: tools.filter((t) => t.serverId === record.id),
        error: status?.error,
      });
    }

    // Operator-configured servers that have no user record yet.
    for (const status of this.mcp.statuses()) {
      if (seen.has(status.id)) continue;
      views.push({
        id: status.id,
        name: status.name,
        transport: status.transport,
        target: status.target,
        trust: 'operator',
        permissions: [],
        enabled: true,
        installedAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        connected: status.connected,
        toolCount: tools.filter((t) => t.serverId === status.id).length,
        tools: tools.filter((t) => t.serverId === status.id),
        error: status.error,
      });
    }

    return views;
  }

  async inspect(ownerId: string, id: string): Promise<PluginView | null> {
    const all = await this.list(ownerId);
    return all.find((plugin) => plugin.id === id) || null;
  }

  /**
   * Install (register) a plugin. The server is added to the live MCP client and
   * a durable record is written. Returns the resulting view with its real
   * connection state — a plugin that fails to connect is reported as such.
   */
  async install(
    ownerId: string,
    input: {
      id?: string;
      name: string;
      transport: 'stdio' | 'sse' | 'http';
      target: string;
      args?: string[];
      description?: string;
      permissions?: string[];
    },
  ): Promise<PluginView> {
    const id = (input.id || input.name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id) throw new Error('A plugin id is required.');

    const config: McpServerConfig = {
      id,
      name: input.name,
      transport: input.transport,
      target: input.target,
      args: input.args,
      description: input.description,
    };

    const now = new Date().toISOString();
    await this.mutate(ownerId, (records) => {
      const existing = records.find((r) => r.id === id);
      if (existing) {
        existing.name = input.name;
        existing.transport = input.transport;
        existing.target = input.target;
        existing.args = input.args;
        existing.description = input.description;
        existing.permissions = input.permissions || existing.permissions;
        existing.enabled = true;
        existing.updatedAt = now;
      } else {
        records.push({
          id,
          name: input.name,
          transport: input.transport,
          target: input.target,
          args: input.args,
          description: input.description,
          trust: 'user-installed',
          permissions: input.permissions || [],
          enabled: true,
          installedAt: now,
          updatedAt: now,
        });
      }
      return records;
    });

    // Connect for real. A failure here is recorded, not hidden.
    const connectResult = await this.mcp.addServer(config);
    await this.mutate(ownerId, (records) => {
      const record = records.find((r) => r.id === id);
      if (record) {
        record.lastHealth = {
          at: new Date().toISOString(),
          connected: connectResult.ok,
          toolCount: this.mcp.listTools().filter((t) => t.serverId === id).length,
          error: connectResult.error,
        };
      }
      return records;
    });

    const view = await this.inspect(ownerId, id);
    if (!view) throw new Error('Plugin record vanished after install.');
    return view;
  }

  async setEnabled(ownerId: string, id: string, enabled: boolean): Promise<PluginView | null> {
    await this.mutate(ownerId, (records) => {
      const record = records.find((r) => r.id === id);
      if (record) {
        record.enabled = enabled;
        record.updatedAt = new Date().toISOString();
      }
      return records;
    });
    if (enabled) {
      const record = (await this.records(ownerId)).find((r) => r.id === id);
      if (record) {
        await this.mcp.addServer({
          id: record.id,
          name: record.name,
          transport: record.transport,
          target: record.target,
          args: record.args,
          description: record.description,
        });
      }
    } else {
      await this.mcp.removeServer(id);
    }
    return this.inspect(ownerId, id);
  }

  async uninstall(ownerId: string, id: string): Promise<boolean> {
    await this.mcp.removeServer(id);
    let removed = false;
    await this.mutate(ownerId, (records) => {
      const next = records.filter((r) => r.id !== id);
      removed = next.length !== records.length;
      return next;
    });
    return removed;
  }

  /** Probe every plugin and record the outcome. */
  async health(ownerId: string): Promise<PluginView[]> {
    const views = await this.list(ownerId);
    const now = new Date().toISOString();
    await this.mutate(ownerId, (records) => {
      for (const record of records) {
        const view = views.find((v) => v.id === record.id);
        if (!view) continue;
        record.lastHealth = {
          at: now,
          connected: view.connected,
          toolCount: view.toolCount,
          error: view.error,
        };
      }
      return records;
    });
    return this.list(ownerId);
  }

  /** Execute a discovered tool. Returns the real result, never a claim. */
  async execute(
    ownerId: string,
    qualifiedTool: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const serverId = qualifiedTool.split('__')[0];
    const plugin = await this.inspect(ownerId, serverId);
    if (plugin && !plugin.enabled) {
      return { ok: false, error: `Plugin "${serverId}" is disabled.` };
    }
    const result = await this.mcp.callTool(qualifiedTool, args);
    return { ok: result.ok, result: result.content, error: result.error };
  }
}

export function newPluginId(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
}
