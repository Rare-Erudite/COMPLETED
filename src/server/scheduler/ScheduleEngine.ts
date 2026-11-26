/**
 * RARE — Scheduler execution engine.
 *
 * The previous implementation stored schedules and never ran them. This module
 * is the missing half: a durable tick that finds due work, claims it atomically,
 * dispatches a REAL action, records what actually happened, and schedules the
 * next occurrence.
 *
 * Durability model
 * ----------------
 * Two backends, chosen at runtime:
 *
 *   postgres  — the authoritative path. Tasks live in `rare_scheduled_tasks`
 *               and claims use `UPDATE ... WHERE ... RETURNING`, which is atomic
 *               across processes, so two workers can never run the same task.
 *               A lease with an expiry means a crashed worker's task is
 *               reclaimed after the lease lapses.
 *
 *   local     — the fallback used when DATABASE_URL is absent or unreachable
 *               (dev, tests, single-instance). Claims are guarded by an
 *               in-process mutex plus a persisted lease timestamp. This is
 *               correct for ONE process only; it is NOT safe across multiple
 *               instances. The engine reports which mode it is in so callers
 *               never have to guess.
 *
 * Missed runs
 * -----------
 * If the process was down past a task's due time, the engine does not fire the
 * backlog N times. It records a single `missed` execution and jumps to the next
 * future occurrence. That is the documented policy (`catchUp: 'skip'`).
 *
 * Retries
 * -------
 * A failed action increments `failure_count` and schedules a retry with
 * exponential backoff (30s, 60s, 120s … capped at 30 min). After
 * `maxFailures` consecutive failures the task is marked `failed` and stops
 * retrying until the owner resumes it.
 */

import type { ParsedSchedule } from './cron.js';
import { parseSchedule, nextRunAfter, isValidTimeZone, describeSchedule } from './cron.js';

export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'failed';

export type ActionKind =
  | 'mcp_tool'
  | 'tool'
  | 'device'
  | 'agent'
  | 'notification_check'
  | 'report';

export interface ScheduleExecution {
  id: string;
  task_id: string;
  started_at: string;
  finished_at: string;
  status: 'success' | 'failed' | 'missed' | 'skipped';
  action_kind: ActionKind;
  /** Short human-readable summary of what the action actually did. */
  summary: string;
  /** Structured result returned by the dispatcher. */
  result?: unknown;
  error?: string | null;
  duration_ms: number;
  attempt: number;
}

export interface ScheduledTask {
  id: string;
  title: string;
  /** Legacy display field, kept so the existing UI keeps working. */
  time: string;
  type: 'alarm' | 'recurring' | 'reminder' | 'automation';
  action: string;
  enabled: boolean;
  repeat: string;
  created_at: string;

  // --- execution state (added by the engine) ---
  /** The schedule expression the engine evaluates. */
  schedule?: string;
  timezone?: string;
  status?: ScheduleStatus;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: 'success' | 'failed' | 'missed' | null;
  last_error?: string | null;
  run_count?: number;
  failure_count?: number;
  /** Consecutive failures; reset on success. */
  consecutive_failures?: number;
  /** Per-task memory, e.g. seen message ids for a monitoring task. */
  checkpoint?: Record<string, unknown>;
  action_kind?: ActionKind;
  action_config?: Record<string, unknown>;
  /** Lease bookkeeping (local backend). */
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  /** Bounded execution history, newest first. */
  history?: ScheduleExecution[];
}

export interface DispatchRequest {
  task: ScheduledTask;
  /** True when this is a manual "run now" rather than a scheduled fire. */
  manual: boolean;
}

export interface DispatchResult {
  ok: boolean;
  summary: string;
  result?: unknown;
  error?: string | null;
  /** Optional checkpoint update the engine should persist. */
  checkpoint?: Record<string, unknown>;
}

export type ActionDispatcher = (request: DispatchRequest) => Promise<DispatchResult>;

export interface EngineOptions {
  /** How often the tick runs. */
  tickMs?: number;
  /** Lease length; a crashed worker's task is reclaimed after this. */
  leaseMs?: number;
  /** Consecutive failures before a task is parked as `failed`. */
  maxFailures?: number;
  /** Bounded history length per task. */
  historyLimit?: number;
  /** Clock injection for tests. */
  now?: () => number;
  /** Identifier for this worker, recorded on leases. */
  workerId?: string;
}

export interface TickReport {
  scanned: number;
  claimed: number;
  executed: number;
  succeeded: number;
  failed: number;
  missed: number;
  skipped: number;
  errors: string[];
}

/** Persistence contract the engine needs. Implemented by both backends. */
export interface SchedulePersistence {
  readonly mode: 'postgres' | 'local';
  /** All tasks across all owners (engine-level scan). */
  listAll(): Promise<ScheduledTask[]>;
  /** Persist a single task by id. */
  save(task: ScheduledTask): Promise<void>;
  /**
   * Atomically claim a task for execution. Returns the claimed task, or null
   * if another worker holds a live lease.
   */
  claim(taskId: string, workerId: string, leaseMs: number, now: number): Promise<ScheduledTask | null>;
  /** Release a lease without changing anything else. */
  release(taskId: string, workerId: string): Promise<void>;
}

const DEFAULT_TICK_MS = 15_000;
const DEFAULT_LEASE_MS = 120_000;
const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_HISTORY_LIMIT = 50;

export class ScheduleEngine {
  private readonly dispatcher: ActionDispatcher;
  private readonly persistence: SchedulePersistence;
  private readonly tickMs: number;
  private readonly leaseMs: number;
  private readonly maxFailures: number;
  private readonly historyLimit: number;
  private readonly now: () => number;
  readonly workerId: string;

  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = true;
  private lastTickAt: string | null = null;
  private lastReport: TickReport | null = null;
  private tickCount = 0;

  constructor(
    persistence: SchedulePersistence,
    dispatcher: ActionDispatcher,
    options: EngineOptions = {},
  ) {
    this.persistence = persistence;
    this.dispatcher = dispatcher;
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.now = options.now ?? (() => Date.now());
    this.workerId = options.workerId ?? `worker_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  }

  get mode(): 'postgres' | 'local' {
    return this.persistence.mode;
  }

  status() {
    return {
      running: !this.stopped,
      mode: this.mode,
      workerId: this.workerId,
      tickMs: this.tickMs,
      leaseMs: this.leaseMs,
      tickCount: this.tickCount,
      lastTickAt: this.lastTickAt,
      lastReport: this.lastReport,
    };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    // Run one tick immediately so a restart picks up overdue work without
    // waiting a full interval.
    void this.tick().catch((error) => {
      console.error('[Scheduler] initial tick failed:', error);
    });
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        console.error('[Scheduler] tick failed:', error);
      });
    }, this.tickMs);
    // Never hold the process open just for the scheduler.
    this.timer.unref?.();
    console.log(`[Scheduler] engine started (mode=${this.mode}, tick=${this.tickMs}ms, worker=${this.workerId})`);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One evaluation pass. Safe to call concurrently — re-entrancy is guarded. */
  async tick(): Promise<TickReport> {
    const report: TickReport = {
      scanned: 0, claimed: 0, executed: 0, succeeded: 0, failed: 0,
      missed: 0, skipped: 0, errors: [],
    };
    if (this.ticking) return report;
    this.ticking = true;
    try {
      const now = this.now();
      const tasks = await this.persistence.listAll();
      report.scanned = tasks.length;

      for (const task of tasks) {
        if (!this.isDue(task, now)) continue;

        const claimed = await this.persistence.claim(task.id, this.workerId, this.leaseMs, now);
        if (!claimed) {
          report.skipped += 1;
          continue;
        }
        report.claimed += 1;

        try {
          const outcome = await this.runClaimed(claimed, now, false);
          report.executed += 1;
          if (outcome === 'success') report.succeeded += 1;
          else if (outcome === 'failed') report.failed += 1;
          else if (outcome === 'missed') report.missed += 1;
          else report.skipped += 1;
        } catch (error) {
          report.errors.push(`${task.id}: ${error instanceof Error ? error.message : String(error)}`);
          await this.persistence.release(task.id, this.workerId).catch(() => undefined);
        }
      }

      this.tickCount += 1;
      this.lastTickAt = new Date(now).toISOString();
      this.lastReport = report;
      return report;
    } finally {
      this.ticking = false;
    }
  }

  /** Manual "run now" — bypasses the due check but still takes the lease. */
  async runNow(taskId: string): Promise<ScheduleExecution | null> {
    const now = this.now();
    const claimed = await this.persistence.claim(taskId, this.workerId, this.leaseMs, now);
    if (!claimed) return null;
    await this.runClaimed(claimed, now, true);
    const refreshed = (await this.persistence.listAll()).find((t) => t.id === taskId);
    return refreshed?.history?.[0] ?? null;
  }

  private isDue(task: ScheduledTask, now: number): boolean {
    if (!task.enabled) return false;
    if ((task.status ?? 'active') !== 'active') return false;
    if (!task.next_run_at) return false;
    const due = Date.parse(task.next_run_at);
    if (Number.isNaN(due)) return false;
    return due <= now;
  }

  private async runClaimed(
    task: ScheduledTask,
    now: number,
    manual: boolean,
  ): Promise<'success' | 'failed' | 'missed' | 'skipped'> {
    const startedAt = new Date(now).toISOString();
    const tz = task.timezone && isValidTimeZone(task.timezone) ? task.timezone : 'UTC';
    const parsed = this.parseTaskSchedule(task);

    // Missed-run policy: if the due time is far in the past, do not replay the
    // backlog. Record one `missed` entry and jump to the next future slot.
    const dueAt = task.next_run_at ? Date.parse(task.next_run_at) : now;
    const lateness = now - dueAt;
    const graceMs = Math.max(this.tickMs * 4, 60_000);
    if (!manual && lateness > graceMs) {
      const next = parsed.ok ? nextRunAfter(parsed, now, tz) : null;
      const execution: ScheduleExecution = {
        id: `exe_${crypto.randomUUID()}`,
        task_id: task.id,
        started_at: startedAt,
        finished_at: new Date(this.now()).toISOString(),
        status: 'missed',
        action_kind: task.action_kind ?? 'report',
        summary: `Missed run: due ${new Date(dueAt).toISOString()}, engine was ${Math.round(lateness / 1000)}s late. Skipped to next occurrence.`,
        error: null,
        duration_ms: 0,
        attempt: (task.consecutive_failures ?? 0) + 1,
      };
      const updated: ScheduledTask = {
        ...task,
        next_run_at: next ? new Date(next).toISOString() : null,
        status: next ? 'active' : 'completed',
        last_status: 'missed',
        lease_owner: null,
        lease_expires_at: null,
        history: [execution, ...(task.history ?? [])].slice(0, this.historyLimit),
      };
      await this.persistence.save(updated);
      return 'missed';
    }

    // --- real dispatch ---
    let outcome: DispatchResult;
    const dispatchStart = this.now();
    try {
      outcome = await this.dispatcher({ task, manual });
    } catch (error) {
      outcome = {
        ok: false,
        summary: 'Action threw an exception.',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const finishedAt = new Date(this.now()).toISOString();
    const durationMs = this.now() - dispatchStart;

    const execution: ScheduleExecution = {
      id: `exe_${crypto.randomUUID()}`,
      task_id: task.id,
      started_at: startedAt,
      finished_at: finishedAt,
      status: outcome.ok ? 'success' : 'failed',
      action_kind: task.action_kind ?? 'report',
      summary: outcome.summary,
      result: outcome.result,
      error: outcome.error ?? null,
      duration_ms: durationMs,
      attempt: (task.consecutive_failures ?? 0) + 1,
    };

    const consecutive = outcome.ok ? 0 : (task.consecutive_failures ?? 0) + 1;
    const parked = !outcome.ok && consecutive >= this.maxFailures;

    let nextRunAt: string | null = null;
    let status: ScheduleStatus = task.status ?? 'active';

    if (outcome.ok) {
      if (parsed.ok) {
        const next = nextRunAfter(parsed, this.now(), tz);
        nextRunAt = next ? new Date(next).toISOString() : null;
        status = next ? 'active' : 'completed';
      } else {
        nextRunAt = null;
        status = 'completed';
      }
    } else if (parked) {
      nextRunAt = null;
      status = 'failed';
    } else {
      // Exponential backoff: 30s, 60s, 120s … capped at 30 minutes.
      const backoffMs = Math.min(30_000 * 2 ** (consecutive - 1), 30 * 60_000);
      nextRunAt = new Date(this.now() + backoffMs).toISOString();
      status = 'active';
    }

    const updated: ScheduledTask = {
      ...task,
      status,
      next_run_at: nextRunAt,
      last_run_at: finishedAt,
      last_status: outcome.ok ? 'success' : 'failed',
      last_error: outcome.ok ? null : (outcome.error ?? outcome.summary),
      run_count: (task.run_count ?? 0) + 1,
      failure_count: (task.failure_count ?? 0) + (outcome.ok ? 0 : 1),
      consecutive_failures: consecutive,
      checkpoint: outcome.checkpoint ?? task.checkpoint,
      lease_owner: null,
      lease_expires_at: null,
      history: [execution, ...(task.history ?? [])].slice(0, this.historyLimit),
    };
    await this.persistence.save(updated);
    return outcome.ok ? 'success' : 'failed';
  }

  private parseTaskSchedule(task: ScheduledTask): ParsedSchedule | { ok: false; error: string } {
    const expression = task.schedule ?? task.time ?? task.repeat ?? '';
    return parseSchedule(expression);
  }
}

/** Build a task's initial execution state from a schedule expression. */
export function initialiseTask(
  base: Omit<ScheduledTask, 'next_run_at' | 'status' | 'run_count' | 'failure_count' | 'consecutive_failures' | 'history'>,
  now: number = Date.now(),
): { task: ScheduledTask } | { error: string } {
  const expression = base.schedule ?? base.time ?? base.repeat ?? '';
  const parsed = parseSchedule(expression, now);
  if (!parsed.ok) return { error: parsed.error };

  const tz = base.timezone && isValidTimeZone(base.timezone) ? base.timezone : 'UTC';
  const next = nextRunAfter(parsed, now, tz);
  if (next === null) {
    return { error: `The schedule "${expression}" has no future occurrence.` };
  }

  return {
    task: {
      ...base,
      schedule: expression,
      timezone: tz,
      status: 'active',
      next_run_at: new Date(next).toISOString(),
      last_run_at: null,
      last_status: null,
      last_error: null,
      run_count: 0,
      failure_count: 0,
      consecutive_failures: 0,
      checkpoint: base.checkpoint ?? {},
      history: [],
      lease_owner: null,
      lease_expires_at: null,
    },
  };
}

export { describeSchedule, parseSchedule, nextRunAfter };
