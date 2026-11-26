/**
 * RARE — Scheduler persistence.
 *
 * Two implementations of `SchedulePersistence`:
 *
 *   PostgresScheduleStore — authoritative. Tasks live in
 *     `rare_scheduled_tasks`, and a claim is a single conditional UPDATE, so
 *     the database itself guarantees that only one worker wins a task. A lease
 *     expiry lets a crashed worker's task be reclaimed.
 *
 *   LocalScheduleStore — used when no database is reachable. Tasks are kept in
 *     the same durable JSON store the rest of RARE falls back to, under a
 *     reserved owner. Claims are serialised by an in-process mutex plus a
 *     persisted lease. Correct for ONE process; NOT safe across instances.
 *
 * The engine reports which mode is active, and the verification document states
 * the limitation explicitly rather than implying multi-instance safety.
 */

import { Pool } from 'pg';
import type { ScheduledTask, SchedulePersistence } from './ScheduleEngine.js';
import { resolvePgSsl } from '../storage/pgSsl.js';

const RESERVED_OWNER = '__scheduler__';
const STATE_KEY = 'scheduled_tasks';

export interface StoredTask extends ScheduledTask {
  owner_id: string;
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

export class PostgresScheduleStore implements SchedulePersistence {
  readonly mode = 'postgres' as const;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl: resolvePgSsl(connectionString),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      max: 5,
    });
  }

  /** Create the table if it is missing. Idempotent. */
  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS rare_scheduled_tasks (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        next_run_at TIMESTAMPTZ,
        lease_owner TEXT,
        lease_expires_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS rare_scheduled_tasks_due_idx
        ON rare_scheduled_tasks (status, next_run_at)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS rare_scheduled_tasks_owner_idx
        ON rare_scheduled_tasks (owner_id)
    `);
  }

  async listAll(): Promise<ScheduledTask[]> {
    const result = await this.pool.query<{ payload: StoredTask }>(
      'SELECT payload FROM rare_scheduled_tasks',
    );
    return result.rows.map((row) => row.payload);
  }

  async listByOwner(ownerId: string): Promise<ScheduledTask[]> {
    const result = await this.pool.query<{ payload: StoredTask }>(
      'SELECT payload FROM rare_scheduled_tasks WHERE owner_id = $1 ORDER BY updated_at DESC',
      [ownerId],
    );
    return result.rows.map((row) => row.payload);
  }

  async save(task: ScheduledTask): Promise<void> {
    const stored = task as StoredTask;
    const ownerId = stored.owner_id ?? RESERVED_OWNER;
    await this.pool.query(
      `INSERT INTO rare_scheduled_tasks (id, owner_id, payload, status, next_run_at, lease_owner, lease_expires_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, now())
       ON CONFLICT (id) DO UPDATE SET
         payload = EXCLUDED.payload,
         status = EXCLUDED.status,
         next_run_at = EXCLUDED.next_run_at,
         lease_owner = EXCLUDED.lease_owner,
         lease_expires_at = EXCLUDED.lease_expires_at,
         updated_at = now()`,
      [
        task.id,
        ownerId,
        JSON.stringify(task),
        task.status ?? 'active',
        task.next_run_at ?? null,
        task.lease_owner ?? null,
        task.lease_expires_at ?? null,
      ],
    );
  }

  /**
   * Atomic claim. The WHERE clause is the lock: only a row whose lease is free
   * or expired can be taken, and the UPDATE itself is atomic, so two workers
   * racing on the same task produce exactly one winner.
   */
  async claim(taskId: string, workerId: string, leaseMs: number, now: number): Promise<ScheduledTask | null> {
    const expires = new Date(now + leaseMs).toISOString();
    const result = await this.pool.query<{ payload: ScheduledTask }>(
      `UPDATE rare_scheduled_tasks
          SET lease_owner = $2, lease_expires_at = $3, updated_at = now()
        WHERE id = $1
          AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at < now())
        RETURNING payload`,
      [taskId, workerId, expires],
    );
    if (result.rows.length === 0) return null;
    const task = result.rows[0].payload;
    return { ...task, lease_owner: workerId, lease_expires_at: expires };
  }

  async release(taskId: string, workerId: string): Promise<void> {
    await this.pool.query(
      `UPDATE rare_scheduled_tasks
          SET lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE id = $1 AND lease_owner = $2`,
      [taskId, workerId],
    );
  }

  async delete(taskId: string, ownerId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM rare_scheduled_tasks WHERE id = $1 AND owner_id = $2',
      [taskId, ownerId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Local (durable JSON fallback)
// ---------------------------------------------------------------------------

interface LocalStateLike {
  getOwnedState<T>(ownerId: string, stateKey: string, initialValue: T): Promise<T>;
  updateOwnedState<T>(
    ownerId: string,
    stateKey: string,
    initialValue: T,
    update: (current: T) => T,
  ): Promise<T>;
}

export class LocalScheduleStore implements SchedulePersistence {
  readonly mode = 'local' as const;
  private readonly store: LocalStateLike;
  /** Serialises claim/save so two ticks in one process cannot interleave. */
  private mutex: Promise<unknown> = Promise.resolve();

  constructor(store: LocalStateLike) {
    this.store = store;
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutex.then(fn, fn);
    // Keep the chain alive even if fn rejects.
    this.mutex = run.catch(() => undefined);
    return run;
  }

  private async readAll(): Promise<StoredTask[]> {
    return this.store.getOwnedState<StoredTask[]>(RESERVED_OWNER, STATE_KEY, []);
  }

  async listAll(): Promise<ScheduledTask[]> {
    return this.readAll();
  }

  async listByOwner(ownerId: string): Promise<ScheduledTask[]> {
    const all = await this.readAll();
    return all.filter((task) => task.owner_id === ownerId);
  }

  async save(task: ScheduledTask): Promise<void> {
    const stored = task as StoredTask;
    const ownerId = stored.owner_id ?? RESERVED_OWNER;
    await this.withLock(async () => {
      await this.store.updateOwnedState<StoredTask[]>(RESERVED_OWNER, STATE_KEY, [], (items) => {
        const next = items.filter((item) => item.id !== task.id);
        next.push({ ...task, owner_id: ownerId });
        return next;
      });
    });
  }

  async claim(taskId: string, workerId: string, leaseMs: number, now: number): Promise<ScheduledTask | null> {
    return this.withLock(async () => {
      let claimed: ScheduledTask | null = null;
      const expires = new Date(now + leaseMs).toISOString();
      await this.store.updateOwnedState<StoredTask[]>(RESERVED_OWNER, STATE_KEY, [], (items) =>
        items.map((item) => {
          if (item.id !== taskId) return item;
          const leaseLive =
            item.lease_owner &&
            item.lease_expires_at &&
            Date.parse(item.lease_expires_at) > now;
          if (leaseLive) return item;
          claimed = { ...item, lease_owner: workerId, lease_expires_at: expires };
          return claimed as StoredTask;
        }),
      );
      return claimed;
    });
  }

  async release(taskId: string, workerId: string): Promise<void> {
    await this.withLock(async () => {
      await this.store.updateOwnedState<StoredTask[]>(RESERVED_OWNER, STATE_KEY, [], (items) =>
        items.map((item) =>
          item.id === taskId && item.lease_owner === workerId
            ? { ...item, lease_owner: null, lease_expires_at: null }
            : item,
        ),
      );
    });
  }

  async delete(taskId: string, ownerId: string): Promise<boolean> {
    return this.withLock(async () => {
      let removed = false;
      await this.store.updateOwnedState<StoredTask[]>(RESERVED_OWNER, STATE_KEY, [], (items) =>
        items.filter((item) => {
          if (item.id === taskId && item.owner_id === ownerId) {
            removed = true;
            return false;
          }
          return true;
        }),
      );
      return removed;
    });
  }
}

/**
 * Choose a backend. Tries Postgres when a connection string is present and the
 * server answers; otherwise falls back to the durable local store.
 */
export async function createScheduleStore(
  connectionString: string | undefined,
  localStore: LocalStateLike,
): Promise<{ store: SchedulePersistence; mode: 'postgres' | 'local'; note: string }> {
  if (connectionString) {
    try {
      const pg = new PostgresScheduleStore(connectionString);
      await pg.ensureSchema();
      return {
        store: pg,
        mode: 'postgres',
        note: 'Postgres backend: claims are atomic across processes.',
      };
    } catch (error) {
      console.warn('[Scheduler] Postgres unavailable, using local durable store:', error instanceof Error ? error.message : error);
    }
  }
  return {
    store: new LocalScheduleStore(localStore),
    mode: 'local',
    note: 'Local durable store: single-process only. Claims are mutex-guarded, not cross-instance safe.',
  };
}
