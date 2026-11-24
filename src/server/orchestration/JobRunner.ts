/**
 * RARE — Job Runner
 *
 * Executes a capability as a durable background job so a long build does not
 * depend on one HTTP request staying open.
 *
 * Flow:
 *   start()  -> creates the durable record, returns immediately with the id
 *   (async)  -> invokes the capability with an AbortSignal and a progress sink
 *   finish() -> writes the real result or the real error to the record
 *
 * The runner is deliberately in-process: RARE's own server is the worker. That
 * is honest — there is no external queue in this deployment — and it is still
 * durable, because the record is persisted before the work starts and after
 * every transition. A restart marks in-flight jobs `interrupted` and they can
 * be resumed with `resume()`.
 */

import { capabilityRegistry, type CapabilityResult } from './CapabilityRegistry.js';
import { jobStore, type JobRecord } from './JobStore.js';

export interface StartJobInput {
  ownerId: string;
  capabilityId: string;
  args: Record<string, unknown>;
  title?: string;
}

export interface StartJobResult {
  job: JobRecord;
  /** Resolves when the background work finishes (for tests and callers that wait). */
  done: Promise<JobRecord>;
}

/** Capabilities that are long enough to deserve a job record. */
const JOB_CAPABILITIES = new Set([
  'builder.deliver',
  'research.run',
  'research.report_to_document',
  'documents.import_url',
  'documents.export',
  'documents.summarise',
  'deployment.static',
  'repository.create',
  'intelligence.evaluate',
]);

export function shouldRunAsJob(capabilityId: string): boolean {
  return JOB_CAPABILITIES.has(capabilityId);
}

export async function startJob(input: StartJobInput): Promise<StartJobResult> {
  const descriptor = capabilityRegistry.get(input.capabilityId);
  if (!descriptor) {
    throw new Error(`Unknown capability "${input.capabilityId}".`);
  }
  const problems = capabilityRegistry.validateArgs(input.capabilityId, input.args);
  if (problems.length) {
    throw new Error(`Invalid arguments: ${problems.join(' ')}`);
  }

  const job = await jobStore.create({
    ownerId: input.ownerId,
    capabilityId: input.capabilityId,
    args: input.args,
    title: input.title || descriptor.title,
  });

  const done = execute(job, descriptor.timeoutMs);
  return { job, done };
}

async function execute(job: JobRecord, timeoutMs?: number): Promise<JobRecord> {
  const controller = new AbortController();
  jobStore.registerController(job.id, controller);

  await jobStore.update(job.ownerId, job.id, (record) => {
    record.status = 'running';
    record.startedAt = new Date().toISOString();
    record.log.push({ at: record.startedAt, stage: 'start', detail: `Running ${record.capabilityId}.` });
  });

  let result: CapabilityResult;
  try {
    result = await capabilityRegistry.invoke(job.capabilityId, job.args, {
      ownerId: job.ownerId,
      correlationId: job.id,
      signal: controller.signal,
      report: (stage, detail) => {
        // Fire-and-forget: a progress write must never block the work itself.
        void jobStore.update(job.ownerId, job.id, (record) => {
          record.log.push({ at: new Date().toISOString(), stage, detail });
          if (record.log.length > 200) record.log.splice(0, record.log.length - 200);
        });
      },
    });
  } catch (error: any) {
    result = {
      ok: false,
      summary: error?.message || 'Job failed.',
      error: { message: error?.message || 'Job failed.', code: 'job_error' },
      durationMs: 0,
    };
  } finally {
    jobStore.releaseController(job.id);
  }

  const cancelled = controller.signal.aborted;
  const finished = await jobStore.update(job.ownerId, job.id, (record) => {
    record.finishedAt = new Date().toISOString();
    if (cancelled) {
      record.status = 'cancelled';
      record.error = { message: 'Cancelled by the user.', code: 'cancelled' };
      record.log.push({ at: record.finishedAt, stage: 'cancel', detail: 'Job cancelled.' });
      return;
    }
    record.status = result.ok ? 'succeeded' : 'failed';
    record.result = result.data ?? null;
    if (!result.ok) record.error = result.error;
    record.log.push({
      at: record.finishedAt,
      stage: result.ok ? 'done' : 'error',
      detail: result.summary,
    });
  });

  return finished || job;
}

/**
 * Resume an interrupted job from its persisted arguments.
 * Returns null when the job is not resumable (already finished, or unknown).
 */
export async function resumeJob(ownerId: string, id: string): Promise<StartJobResult | null> {
  const job = await jobStore.get(ownerId, id);
  if (!job) return null;
  if (!['interrupted', 'failed', 'queued'].includes(job.status)) return null;

  await jobStore.update(ownerId, id, (record) => {
    record.status = 'queued';
    record.resumedCount += 1;
    record.error = undefined;
    record.log.push({
      at: new Date().toISOString(),
      stage: 'resume',
      detail: `Resuming (attempt ${record.resumedCount + 1}).`,
    });
  });

  const refreshed = (await jobStore.get(ownerId, id))!;
  const descriptor = capabilityRegistry.get(refreshed.capabilityId);
  const done = execute(refreshed, descriptor?.timeoutMs);
  return { job: refreshed, done };
}
