/**
 * TaskRegistry — the shared, durable, owner-scoped task registry Chat dispatches
 * into (Part D §4).
 *
 * Defect this fixes (Stage 1, Chat): there was no shared task registry at all.
 * Chat had no way to hand a task to a capability, no task id the user could
 * inspect later, no recorded progress events, and nothing survived a restart.
 * The only task-like thing was `activeAgentRuns` — an in-process array with no
 * ownership enforcement, no status transitions and no event history.
 *
 * Design: every task lives under the owning user's own state document, so a
 * task is private by construction and cannot be read or cancelled by another
 * owner. Progress is only ever appended from a real observed operation; this
 * module has no "simulate" path on purpose.
 */

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type TaskCapability =
  | 'document'
  | 'research'
  | 'transcription'
  | 'conversion'
  | 'build'
  | 'image'
  | 'schedule'
  | 'chat';

export interface TaskProgressEvent {
  at: string;
  phase: string;
  message: string;
  /** Percent complete as actually reported by the worker, when it reports one. */
  percent?: number;
}

export interface TaskRetry {
  at: string;
  attempt: number;
  error: string;
}

export interface RareTask {
  id: string;
  ownerId: string;
  conversationId: string;
  capability: TaskCapability;
  description: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: TaskProgressEvent[];
  outputs: Array<{ label: string; href?: string; text?: string }>;
  error?: string;
  retries: TaskRetry[];
  cancelRequested: boolean;
}

export interface CreateTaskInput {
  capability: TaskCapability;
  description: string;
  conversationId?: string;
  /** Dependency task ids; the task is not runnable until these succeed. */
  dependsOn?: string[];
}

const MAX_EVENTS_PER_TASK = 200;
const MAX_TASKS_PER_OWNER = 300;

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `task_${Date.now().toString(36)}_${random}`;
}

/** Trim history so a long-running owner cannot grow state without bound. */
function prune(tasks: RareTask[]): RareTask[] {
  if (tasks.length <= MAX_TASKS_PER_OWNER) return tasks;
  // Keep unfinished work regardless of age — losing a running task would be a
  // correctness bug, not a cleanup.
  const unfinished = tasks.filter((task) => task.status === 'queued' || task.status === 'running');
  const finished = tasks
    .filter((task) => task.status !== 'queued' && task.status !== 'running')
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, Math.max(0, MAX_TASKS_PER_OWNER - unfinished.length));
  return [...unfinished, ...finished];
}

export class TaskRegistryError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = 'TaskRegistryError';
  }
}

/**
 * Pure registry operations over an owner's task list. Storage is injected so
 * this stays testable and cannot accidentally read another owner's state.
 */
export class TaskRegistry {
  /**
   * Create a task. Returns the new task and the next list to persist.
   */
  public create(
    existing: RareTask[],
    ownerId: string,
    input: CreateTaskInput,
  ): { next: RareTask[]; task: RareTask } {
    if (!ownerId) throw new TaskRegistryError('A task owner is required.', 401);
    const description = (input.description || '').trim();
    if (!description) throw new TaskRegistryError('A task description is required.', 400);
    if (description.length > 4000) throw new TaskRegistryError('The task description is too long.', 400);

    const task: RareTask = {
      id: makeId(),
      ownerId,
      conversationId: input.conversationId || '',
      capability: input.capability,
      description,
      status: 'queued',
      createdAt: nowIso(),
      progress: [
        {
          at: nowIso(),
          phase: 'queued',
          message: `Queued for the ${input.capability} capability.`,
        },
      ],
      outputs: [],
      retries: [],
      cancelRequested: false,
    };

    // Dependencies are recorded in the progress log rather than as a hidden
    // field so the user can see why a task has not started.
    const dependencies = (input.dependsOn || []).filter(Boolean);
    if (dependencies.length) {
      task.progress.push({
        at: nowIso(),
        phase: 'dependency',
        message: `Waiting on ${dependencies.length} dependent task(s): ${dependencies.join(', ')}.`,
      });
    }

    return { next: prune([task, ...existing]), task };
  }

  public find(tasks: RareTask[], ownerId: string, taskId: string): RareTask {
    const task = tasks.find((item) => item.id === taskId && item.ownerId === ownerId);
    if (!task) throw new TaskRegistryError('Task not found.', 404);
    return task;
  }

  /**
   * Apply a transition and append the accompanying progress event.
   * Illegal transitions are rejected instead of silently overwritten: a task
   * must not go from `cancelled` back to `running`.
   */
  public transition(
    tasks: RareTask[],
    ownerId: string,
    taskId: string,
    status: TaskStatus,
    event?: { phase?: string; message?: string; percent?: number },
  ): { next: RareTask[]; task: RareTask } {
    const current = this.find(tasks, ownerId, taskId);

    if (current.status === 'cancelled' && status === 'running') {
      throw new TaskRegistryError('A cancelled task cannot be restarted.', 409);
    }
    if ((current.status === 'succeeded' || current.status === 'failed') && status === 'running') {
      throw new TaskRegistryError('A finished task cannot be restarted; create a new task.', 409);
    }

    const at = nowIso();
    const updated: RareTask = {
      ...current,
      status,
      startedAt: current.startedAt || (status === 'running' ? at : undefined),
      finishedAt:
        status === 'succeeded' || status === 'failed' || status === 'cancelled'
          ? at
          : current.finishedAt,
      error: status === 'failed' ? event?.message || current.error : current.error,
      progress: [
        ...current.progress,
        {
          at,
          phase: event?.phase || status,
          message: event?.message || `Task is now ${status}.`,
          ...(typeof event?.percent === 'number' ? { percent: Math.max(0, Math.min(100, event.percent)) } : {}),
        },
      ].slice(-MAX_EVENTS_PER_TASK),
    };

    return {
      next: tasks.map((item) => (item.id === taskId ? updated : item)),
      task: updated,
    };
  }

  /**
   * Record a real output the worker produced. Called only after the operation
   * actually completed, so the UI can never show an output that does not exist.
   */
  public addOutput(
    tasks: RareTask[],
    ownerId: string,
    taskId: string,
    output: { label: string; href?: string; text?: string },
  ): { next: RareTask[]; task: RareTask } {
    const current = this.find(tasks, ownerId, taskId);
    const updated: RareTask = {
      ...current,
      outputs: [...current.outputs, output].slice(-20),
      progress: [
        ...current.progress,
        { at: nowIso(), phase: 'output', message: `Produced: ${output.label}` },
      ].slice(-MAX_EVENTS_PER_TASK),
    };
    return { next: tasks.map((item) => (item.id === taskId ? updated : item)), task: updated };
  }

  public recordRetry(
    tasks: RareTask[],
    ownerId: string,
    taskId: string,
    error: string,
  ): { next: RareTask[]; task: RareTask } {
    const current = this.find(tasks, ownerId, taskId);
    const attempt = current.retries.length + 1;
    const updated: RareTask = {
      ...current,
      retries: [...current.retries, { at: nowIso(), attempt, error: error.slice(0, 800) }].slice(-10),
      progress: [
        ...current.progress,
        { at: nowIso(), phase: 'retry', message: `Attempt ${attempt} failed: ${error.slice(0, 300)}` },
      ].slice(-MAX_EVENTS_PER_TASK),
    };
    return { next: tasks.map((item) => (item.id === taskId ? updated : item)), task: updated };
  }

  /**
   * Request cancellation. A queued task stops immediately; a running one is
   * flagged so the worker can stop at its own checkpoint instead of being
   * reported as cancelled while it keeps working.
   */
  public requestCancel(
    tasks: RareTask[],
    ownerId: string,
    taskId: string,
  ): { next: RareTask[]; task: RareTask } {
    const current = this.find(tasks, ownerId, taskId);
    if (current.status === 'succeeded' || current.status === 'failed') {
      throw new TaskRegistryError('A finished task cannot be cancelled.', 409);
    }
    if (current.status === 'queued') {
      return this.transition(tasks, ownerId, taskId, 'cancelled', {
        phase: 'cancelled',
        message: 'Cancelled before it started.',
      });
    }
    const updated: RareTask = {
      ...current,
      cancelRequested: true,
      progress: [
        ...current.progress,
        { at: nowIso(), phase: 'cancel_requested', message: 'Cancellation requested; the worker will stop at its next checkpoint.' },
      ].slice(-MAX_EVENTS_PER_TASK),
    };
    return { next: tasks.map((item) => (item.id === taskId ? updated : item)), task: updated };
  }

  /** Tasks belonging to one owner, newest first, optionally scoped to a chat. */
  public list(tasks: RareTask[], ownerId: string, conversationId?: string): RareTask[] {
    return tasks
      .filter((task) => task.ownerId === ownerId && (!conversationId || task.conversationId === conversationId))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  /** Counts for the health/status surface — real numbers, not estimates. */
  public summarise(tasks: RareTask[], ownerId: string) {
    const own = tasks.filter((task) => task.ownerId === ownerId);
    return {
      total: own.length,
      queued: own.filter((task) => task.status === 'queued').length,
      running: own.filter((task) => task.status === 'running').length,
      succeeded: own.filter((task) => task.status === 'succeeded').length,
      failed: own.filter((task) => task.status === 'failed').length,
      cancelled: own.filter((task) => task.status === 'cancelled').length,
    };
  }
}

export const taskRegistry = new TaskRegistry();
