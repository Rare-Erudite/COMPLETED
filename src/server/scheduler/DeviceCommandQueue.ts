/**
 * RARE — Device command queue.
 *
 * The Android app is a client: it cannot be dialled from the server. So the
 * server queues a command and the phone polls for it, executes it through the
 * real accessibility/notification services, and posts the result back.
 *
 * This is the transport that makes a scheduled device action possible at all.
 * Without it, "check WhatsApp every 2 minutes" has nowhere to run.
 *
 * Durability: commands live in the same owner-scoped store as everything else,
 * so a queued command survives a server restart and is picked up when the phone
 * next polls. Commands expire after `COMMAND_TTL_MS` so a phone that comes back
 * days later does not execute a stale instruction.
 *
 * Online detection: a device is "online" if it has polled within
 * `ONLINE_WINDOW_MS`. That is a real signal — it is the phone's own heartbeat,
 * not an assumption.
 */

import type { DeviceCommand, DeviceCommandQueue } from './dispatcher.js';

const STATE_KEY = 'device_commands';
const PRESENCE_KEY = 'device_presence';
const COMMAND_TTL_MS = 10 * 60_000;
const ONLINE_WINDOW_MS = 90_000;
const MAX_COMMANDS = 200;

interface StateStore {
  getOwnedState<T>(ownerId: string, stateKey: string, initialValue: T): Promise<T>;
  updateOwnedState<T>(
    ownerId: string,
    stateKey: string,
    initialValue: T,
    update: (current: T) => T,
  ): Promise<T>;
}

export class StoreDeviceCommandQueue implements DeviceCommandQueue {
  private readonly store: StateStore;
  private readonly waiters = new Map<string, Array<(cmd: DeviceCommand) => void>>();

  constructor(store: StateStore) {
    this.store = store;
  }

  async enqueue(
    ownerId: string,
    action: string,
    args: Record<string, unknown>,
    taskId?: string,
  ): Promise<DeviceCommand> {
    const command: DeviceCommand = {
      id: `cmd_${crypto.randomUUID()}`,
      owner_id: ownerId,
      action,
      args,
      created_at: new Date().toISOString(),
      status: 'pending',
      claimed_at: null,
      completed_at: null,
      result: null,
      error: null,
      task_id: taskId ?? null,
    };
    await this.store.updateOwnedState<DeviceCommand[]>(ownerId, STATE_KEY, [], (items) => {
      const pruned = items.filter((item) => {
        const age = Date.now() - Date.parse(item.created_at);
        return age < COMMAND_TTL_MS * 6;
      });
      return [command, ...pruned].slice(0, MAX_COMMANDS);
    });
    return command;
  }

  /** Called by the phone's poll endpoint. Returns pending commands and marks them claimed. */
  async claimPending(ownerId: string, limit = 5): Promise<DeviceCommand[]> {
    const now = Date.now();
    let claimed: DeviceCommand[] = [];
    await this.store.updateOwnedState<DeviceCommand[]>(ownerId, STATE_KEY, [], (items) =>
      items.map((item) => {
        if (claimed.length >= limit) return item;
        if (item.status !== 'pending') return item;
        const age = now - Date.parse(item.created_at);
        if (age > COMMAND_TTL_MS) {
          return { ...item, status: 'expired' as const, error: 'command expired before the device polled' };
        }
        const next: DeviceCommand = {
          ...item,
          status: 'claimed',
          claimed_at: new Date(now).toISOString(),
        };
        claimed.push(next);
        return next;
      }),
    );
    return claimed;
  }

  /** Called by the phone to post a result. */
  async complete(
    ownerId: string,
    commandId: string,
    outcome: { ok: boolean; result?: unknown; error?: string | null },
  ): Promise<DeviceCommand | null> {
    let finished: DeviceCommand | null = null;
    await this.store.updateOwnedState<DeviceCommand[]>(ownerId, STATE_KEY, [], (items) =>
      items.map((item) => {
        if (item.id !== commandId) return item;
        finished = {
          ...item,
          status: outcome.ok ? 'done' : 'failed',
          completed_at: new Date().toISOString(),
          result: outcome.result ?? null,
          error: outcome.error ?? null,
        };
        return finished;
      }),
    );
    if (finished) this.notifyWaiters(finished);
    return finished;
  }

  async awaitResult(commandId: string, timeoutMs: number): Promise<DeviceCommand | null> {
    // Fast path: already terminal.
    const existing = await this.findCommand(commandId);
    if (existing && (existing.status === 'done' || existing.status === 'failed' || existing.status === 'expired')) {
      return existing;
    }

    return new Promise<DeviceCommand | null>((resolve) => {
      // Deliberately NOT unref'd: this timer is the only thing keeping the
      // process alive while we wait for the device to answer. Unref'ing it lets
      // Node exit mid-wait, which silently drops the result.
      const timer = setTimeout(() => {
        this.removeWaiter(commandId, onDone);
        resolve(null);
      }, timeoutMs);

      const onDone = (cmd: DeviceCommand) => {
        clearTimeout(timer);
        this.removeWaiter(commandId, onDone);
        resolve(cmd);
      };
      const list = this.waiters.get(commandId) ?? [];
      list.push(onDone);
      this.waiters.set(commandId, list);
    });
  }

  async isDeviceOnline(ownerId: string, withinMs = ONLINE_WINDOW_MS): Promise<boolean> {
    const presence = await this.store.getOwnedState<{ lastSeenAt?: string }>(
      ownerId,
      PRESENCE_KEY,
      {},
    );
    if (!presence.lastSeenAt) return false;
    return Date.now() - Date.parse(presence.lastSeenAt) < withinMs;
  }

  /** Called by the phone's poll endpoint to record its heartbeat. */
  async recordPresence(ownerId: string, info: Record<string, unknown> = {}): Promise<void> {
    await this.store.updateOwnedState<Record<string, unknown>>(ownerId, PRESENCE_KEY, {}, () => ({
      lastSeenAt: new Date().toISOString(),
      ...info,
    }));
  }

  async listRecent(ownerId: string, limit = 20): Promise<DeviceCommand[]> {
    const items = await this.store.getOwnedState<DeviceCommand[]>(ownerId, STATE_KEY, []);
    return items.slice(0, limit);
  }

  private async findCommand(commandId: string): Promise<DeviceCommand | null> {
    // Commands are owner-scoped, so we cannot look one up without the owner.
    // The waiter path is the normal one; this fast path is best-effort and is
    // only used when the caller already knows the command is terminal.
    return null;
  }

  private notifyWaiters(cmd: DeviceCommand): void {
    const list = this.waiters.get(cmd.id);
    if (!list) return;
    for (const fn of list) fn(cmd);
    this.waiters.delete(cmd.id);
  }

  private removeWaiter(commandId: string, fn: (cmd: DeviceCommand) => void): void {
    const list = this.waiters.get(commandId);
    if (!list) return;
    const next = list.filter((item) => item !== fn);
    if (next.length === 0) this.waiters.delete(commandId);
    else this.waiters.set(commandId, next);
  }
}
