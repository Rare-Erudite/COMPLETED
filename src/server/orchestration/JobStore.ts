/**
 * RARE — Durable Job Store
 *
 * The fix for "long-running work dies with the HTTP request".
 *
 * The platform brief (section 16) asks why previous work kept stopping. One of
 * the real causes is architectural: a build that takes four minutes cannot live
 * inside a single serverless request, and a task that is only held in a local
 * variable is lost the moment the process recycles. This store makes a job a
 * first-class, persisted object:
 *
 *   - every job has a durable record (status, steps, progress, evidence);
 *   - every step transition is written through to storage, so a crash leaves a
 *     resumable checkpoint rather than a lost task;
 *   - a job can be cancelled (cooperative, via AbortSignal);
 *   - a job that was `running` when the process died is detected on boot and
 *     marked `interrupted` so it can be resumed instead of silently vanishing;
 *   - progress is queryable at any time by id, independent of the request that
 *     started it.
 *
 * Storage is the same owner-scoped PersistentJsonStore the rest of RARE uses,
 * so jobs survive a restart on Postgres and on the local fallback alike.
 */

import crypto from 'crypto';
import type { PersistentJsonStore } from '../storage/PersistentJsonStore.js';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface JobStep {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  summary?: string;
  startedAt?: string;
  finishedAt?: string;
  evidence?: unknown;
}

export interface JobRecord {
  id: string;
  ownerId: string;
  /** Capability id this job drives, e.g. "builder.deliver". */
  capabilityId: string;
  /** Arguments the job was started with (kept for resume). */
  args: Record<string, unknown>;
  title: string;
  status: JobStatus;
  /** 0..100, derived from step completion. */
  progress: number;
  steps: JobStep[];
  /** Free-form progress log, newest last. */
  log: Array<{ at: string; stage: string; detail: string }>;
  result?: unknown;
  error?: { message: string; code: string };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Set when the job was resumed after an interruption. */
  resumedCount: number;
}

const STATE_KEY = 'orchestration_jobs';
const MAX_JOBS_PER_OWNER = 100;

/** In-process registry of live AbortControllers, keyed by job id. */
const liveControllers = new Map<string, AbortController>();

export class JobStore {
  private storage: PersistentJsonStore | undefined;

  attach(storage: PersistentJsonStore): void {
    this.storage = storage;
  }

  private require(): PersistentJsonStore {
    if (!this.storage) throw new Error('JobStore is not attached to storage yet.');
    return this.storage;
  }

  private async all(ownerId: string): Promise<JobRecord[]> {
    return this.require().getOwnedState<JobRecord[]>(ownerId, STATE_KEY, []);
  }

  async list(ownerId: string): Promise<JobRecord[]> {
    const jobs = await this.all(ownerId);
    return [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(ownerId: string, id: string): Promise<JobRecord | null> {
    const jobs = await this.all(ownerId);
    return jobs.find((job) => job.id === id) || null;
  }

  async create(input: {
    ownerId: string;
    capabilityId: string;
    args: Record<string, unknown>;
    title: string;
    steps?: Array<{ id: string; title: string }>;
  }): Promise<JobRecord> {
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: `job_${crypto.randomUUID()}`,
      ownerId: input.ownerId,
      capabilityId: input.capabilityId,
      args: input.args,
      title: input.title,
      status: 'queued',
      progress: 0,
      steps: (input.steps || []).map((step) => ({ ...step, status: 'pending' as const })),
      log: [],
      createdAt: now,
      updatedAt: now,
      resumedCount: 0,
    };
    await this.mutate(input.ownerId, (jobs) => {
      jobs.unshift(job);
      return jobs.slice(0, MAX_JOBS_PER_OWNER);
    });
    return job;
  }

  /** Apply a mutation to one job and persist the whole list. */
  async update(
    ownerId: string,
    id: string,
    mutate: (job: JobRecord) => void,
  ): Promise<JobRecord | null> {
    let updated: JobRecord | null = null;
    await this.mutate(ownerId, (jobs) => {
      const job = jobs.find((entry) => entry.id === id);
      if (!job) return jobs;
      mutate(job);
      job.updatedAt = new Date().toISOString();
      job.progress = computeProgress(job);
      updated = job;
      return jobs;
    });
    return updated;
  }

  private async mutate(ownerId: string, fn: (jobs: JobRecord[]) => JobRecord[]): Promise<void> {
    await this.require().updateOwnedState<JobRecord[]>(ownerId, STATE_KEY, [], (current) => {
      const list = Array.isArray(current) ? current : [];
      return fn(list);
    });
  }

  /**
   * Mark jobs that were `running` when the process last died as `interrupted`.
   * Called once at boot. Returns the ids that were recovered so the caller can
   * decide whether to resume them.
   */
  async recoverInterrupted(ownerId: string): Promise<string[]> {
    const recovered: string[] = [];
    await this.mutate(ownerId, (jobs) => {
      for (const job of jobs) {
        if (job.status === 'running' || job.status === 'queued') {
          job.status = 'interrupted';
          job.updatedAt = new Date().toISOString();
          job.log.push({
            at: job.updatedAt,
            stage: 'recovery',
            detail: 'The process restarted while this job was in flight; it is resumable.',
          });
          recovered.push(job.id);
        }
      }
      return jobs;
    });
    return recovered;
  }

  /** Register the AbortController for a running job so it can be cancelled. */
  registerController(id: string, controller: AbortController): void {
    liveControllers.set(id, controller);
  }

  releaseController(id: string): void {
    liveControllers.delete(id);
  }

  /** Request cancellation. Returns false when the job is not running here. */
  cancel(id: string): boolean {
    const controller = liveControllers.get(id);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  isLive(id: string): boolean {
    return liveControllers.has(id);
  }
}

function computeProgress(job: JobRecord): number {
  if (job.status === 'succeeded') return 100;
  if (!job.steps.length) {
    if (job.status === 'running') return 50;
    if (job.status === 'failed' || job.status === 'cancelled') return 100;
    return 0;
  }
  const done = job.steps.filter((s) => s.status === 'passed' || s.status === 'failed' || s.status === 'skipped').length;
  return Math.round((done / job.steps.length) * 100);
}

export const jobStore = new JobStore();
