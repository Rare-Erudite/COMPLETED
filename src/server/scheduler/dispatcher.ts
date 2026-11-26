/**
 * RARE — Scheduler action dispatcher.
 *
 * Turns a scheduled task into a REAL action. This is the part that makes the
 * difference between "a timer fired" and "the work happened".
 *
 * Action kinds
 * ------------
 *   notification_check — enqueue a `notifications` command for the owner's
 *                        Android device, wait for the device to answer, then
 *                        diff against the task's checkpoint so only genuinely
 *                        new notifications are reported. This is the WhatsApp
 *                        monitoring path.
 *   device             — enqueue any other device action and wait for its result.
 *   mcp_tool           — call a tool on a connected MCP server.
 *   tool               — run a RARE tool through the ToolExecutor.
 *   agent              — start a multi-agent run.
 *   report             — produce a text report from the task's own state.
 *
 * Honesty rules baked in
 * ----------------------
 * • If no device is connected, the action FAILS with a clear reason. It never
 *   reports "checked successfully" when nothing was checked.
 * • If the device answers with an error (permission revoked, accessibility off),
 *   that error is surfaced verbatim.
 * • Consequential actions (sending, deleting) are refused unless the task
 *   explicitly carries `allowConsequential: true`.
 */

import type { DispatchRequest, DispatchResult, ScheduledTask } from './ScheduleEngine.js';

/** A command queued for the owner's Android device. */
export interface DeviceCommand {
  id: string;
  owner_id: string;
  action: string;
  args: Record<string, unknown>;
  created_at: string;
  status: 'pending' | 'claimed' | 'done' | 'failed' | 'expired';
  claimed_at?: string | null;
  completed_at?: string | null;
  result?: unknown;
  error?: string | null;
  /** Set when the command came from a scheduled task, for traceability. */
  task_id?: string | null;
}

export interface DeviceCommandQueue {
  enqueue(ownerId: string, action: string, args: Record<string, unknown>, taskId?: string): Promise<DeviceCommand>;
  /** Wait for a specific command to reach a terminal state. */
  awaitResult(commandId: string, timeoutMs: number): Promise<DeviceCommand | null>;
  /** True when the owner has polled recently — i.e. a device is actually online. */
  isDeviceOnline(ownerId: string, withinMs?: number): Promise<boolean>;
}

export interface DispatcherDeps {
  deviceQueue: DeviceCommandQueue;
  /** Call a qualified MCP tool. */
  callMcpTool?: (qualifiedName: string, args: Record<string, unknown>) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
  /** Run a RARE tool. */
  runTool?: (name: string, inputs: Record<string, unknown>, ownerId: string) => Promise<{ success: boolean; output?: unknown; error?: string }>;
  /** Start an agent run. */
  startAgentRun?: (ownerId: string, title: string, objective: string) => Promise<{ id: string }>;
  /** How long to wait for a device to answer a command. */
  deviceTimeoutMs?: number;
}

const DEFAULT_DEVICE_TIMEOUT_MS = 45_000;

/** Actions that change the world and therefore need explicit authorisation. */
const CONSEQUENTIAL_ACTIONS = new Set([
  'send_message',
  'send_whatsapp',
  'delete',
  'delete_message',
  'purchase',
  'submit',
  'call',
]);

export function createDispatcher(deps: DispatcherDeps) {
  const deviceTimeoutMs = deps.deviceTimeoutMs ?? DEFAULT_DEVICE_TIMEOUT_MS;

  return async function dispatch({ task, manual }: DispatchRequest): Promise<DispatchResult> {
    const kind = task.action_kind ?? 'report';
    const config = task.action_config ?? {};
    const ownerId = (task as ScheduledTask & { owner_id?: string }).owner_id ?? '';

    if (!ownerId) {
      return { ok: false, summary: 'Task has no owner; refusing to execute.', error: 'missing owner_id' };
    }

    switch (kind) {
      case 'notification_check':
        return runNotificationCheck(task, ownerId, config, deps, deviceTimeoutMs, manual);

      case 'device':
        return runDeviceAction(task, ownerId, config, deps, deviceTimeoutMs);

      case 'mcp_tool':
        return runMcpTool(task, config, deps);

      case 'tool':
        return runRareTool(task, ownerId, config, deps);

      case 'agent':
        return runAgent(task, ownerId, config, deps);

      case 'report':
        return runReport(task);

      default:
        return {
          ok: false,
          summary: `Unknown action kind "${kind}".`,
          error: `unsupported action_kind: ${kind}`,
        };
    }
  };
}

// ---------------------------------------------------------------------------
// notification_check — the WhatsApp monitoring path
// ---------------------------------------------------------------------------

async function runNotificationCheck(
  task: ScheduledTask,
  ownerId: string,
  config: Record<string, unknown>,
  deps: DispatcherDeps,
  timeoutMs: number,
  manual: boolean,
): Promise<DispatchResult> {
  const packageFilter = typeof config.package === 'string' ? config.package : undefined;
  const limit = Number.isFinite(config.limit) ? Number(config.limit) : 50;

  const online = await deps.deviceQueue.isDeviceOnline(ownerId);
  if (!online) {
    return {
      ok: false,
      summary:
        'No Android device is connected, so notifications could not be read. ' +
        'The task did not check anything and is reporting that honestly.',
      error: 'device_offline: no device has polled for commands recently',
    };
  }

  const command = await deps.deviceQueue.enqueue(
    ownerId,
    'notifications',
    { limit, ...(packageFilter ? { package: packageFilter } : {}) },
    task.id,
  );

  const finished = await deps.deviceQueue.awaitResult(command.id, timeoutMs);
  if (!finished) {
    return {
      ok: false,
      summary: `The device did not answer the notification request within ${Math.round(timeoutMs / 1000)}s.`,
      error: 'device_timeout',
    };
  }
  if (finished.status !== 'done') {
    return {
      ok: false,
      summary: `The device refused or failed the notification request: ${finished.error ?? finished.status}`,
      error: finished.error ?? finished.status,
    };
  }

  // The device returns { ok, data: { notifications: [...] } } or similar.
  const payload = finished.result as any;
  const rawList: any[] =
    payload?.data?.notifications ??
    payload?.notifications ??
    (Array.isArray(payload?.data) ? payload.data : []) ??
    [];

  if (!Array.isArray(rawList)) {
    return {
      ok: false,
      summary: 'The device answered but the notification payload was not a list.',
      error: 'malformed_device_payload',
      result: payload,
    };
  }

  // Stable identity for a notification: package + posted time + title + text.
  const identity = (n: any): string => {
    const pkg = String(n?.package ?? n?.packageName ?? '');
    const when = String(n?.postedAt ?? n?.when ?? n?.time ?? '');
    const title = String(n?.title ?? '');
    const text = String(n?.text ?? n?.body ?? '');
    return `${pkg}|${when}|${title}|${text}`;
  };

  const seen: string[] = Array.isArray(task.checkpoint?.seenNotificationIds)
    ? (task.checkpoint!.seenNotificationIds as string[])
    : [];
  const seenSet = new Set(seen);

  const fresh = rawList.filter((n) => {
    if (packageFilter) {
      const pkg = String(n?.package ?? n?.packageName ?? '');
      if (pkg !== packageFilter) return false;
    }
    return !seenSet.has(identity(n));
  });

  // Keep the checkpoint bounded so it cannot grow without limit.
  const nextSeen = [...seen, ...fresh.map(identity)].slice(-500);

  if (fresh.length === 0) {
    return {
      ok: true,
      summary: `Checked ${rawList.length} notification(s); no new ones since the last run.`,
      result: { checked: rawList.length, new: 0 },
      checkpoint: { seenNotificationIds: nextSeen, lastCheckedAt: new Date().toISOString() },
    };
  }

  const lines = fresh.slice(0, 20).map((n) => {
    const title = String(n?.title ?? '(no title)');
    const text = String(n?.text ?? n?.body ?? '');
    return `• ${title}${text ? `: ${text}` : ''}`;
  });

  return {
    ok: true,
    summary: `${fresh.length} new notification(s):\n${lines.join('\n')}`,
    result: {
      checked: rawList.length,
      new: fresh.length,
      items: fresh.slice(0, 20).map((n) => ({
        package: n?.package ?? n?.packageName ?? null,
        title: n?.title ?? null,
        text: n?.text ?? n?.body ?? null,
        postedAt: n?.postedAt ?? n?.when ?? null,
      })),
      manual,
    },
    checkpoint: { seenNotificationIds: nextSeen, lastCheckedAt: new Date().toISOString() },
  };
}

// ---------------------------------------------------------------------------
// device — any other device action
// ---------------------------------------------------------------------------

async function runDeviceAction(
  task: ScheduledTask,
  ownerId: string,
  config: Record<string, unknown>,
  deps: DispatcherDeps,
  timeoutMs: number,
): Promise<DispatchResult> {
  const action = typeof config.action === 'string' ? config.action : '';
  if (!action) {
    return { ok: false, summary: 'Device task has no action configured.', error: 'missing action' };
  }

  if (CONSEQUENTIAL_ACTIONS.has(action) && config.allowConsequential !== true) {
    return {
      ok: false,
      summary: `Refused "${action}": it is a consequential action and this task has not been authorised for it.`,
      error: 'consequential_action_not_authorised',
    };
  }

  const online = await deps.deviceQueue.isDeviceOnline(ownerId);
  if (!online) {
    return {
      ok: false,
      summary: `No Android device is connected, so "${action}" could not be performed.`,
      error: 'device_offline',
    };
  }

  const args = (config.args && typeof config.args === 'object' ? config.args : {}) as Record<string, unknown>;
  const command = await deps.deviceQueue.enqueue(ownerId, action, args, task.id);
  const finished = await deps.deviceQueue.awaitResult(command.id, timeoutMs);

  if (!finished) {
    return { ok: false, summary: `Device did not answer "${action}" in time.`, error: 'device_timeout' };
  }
  if (finished.status !== 'done') {
    return {
      ok: false,
      summary: `Device action "${action}" failed: ${finished.error ?? finished.status}`,
      error: finished.error ?? finished.status,
    };
  }
  return {
    ok: true,
    summary: `Device action "${action}" completed.`,
    result: finished.result,
  };
}

// ---------------------------------------------------------------------------
// mcp_tool
// ---------------------------------------------------------------------------

async function runMcpTool(
  task: ScheduledTask,
  config: Record<string, unknown>,
  deps: DispatcherDeps,
): Promise<DispatchResult> {
  const tool = typeof config.tool === 'string' ? config.tool : '';
  if (!tool) return { ok: false, summary: 'MCP task has no tool configured.', error: 'missing tool' };
  if (!deps.callMcpTool) {
    return { ok: false, summary: 'MCP is not available in this process.', error: 'mcp_unavailable' };
  }
  const args = (config.args && typeof config.args === 'object' ? config.args : {}) as Record<string, unknown>;
  const result = await deps.callMcpTool(tool, args);
  if (!result.ok) {
    return { ok: false, summary: `MCP tool "${tool}" failed: ${result.error ?? 'unknown error'}`, error: result.error, result: result.result };
  }
  return { ok: true, summary: `MCP tool "${tool}" returned a result.`, result: result.result };
}

// ---------------------------------------------------------------------------
// tool
// ---------------------------------------------------------------------------

async function runRareTool(
  task: ScheduledTask,
  ownerId: string,
  config: Record<string, unknown>,
  deps: DispatcherDeps,
): Promise<DispatchResult> {
  const name = typeof config.tool === 'string' ? config.tool : '';
  if (!name) return { ok: false, summary: 'Tool task has no tool configured.', error: 'missing tool' };
  if (!deps.runTool) {
    return { ok: false, summary: 'The tool executor is not available in this process.', error: 'tool_executor_unavailable' };
  }
  const inputs = (config.args && typeof config.args === 'object' ? config.args : {}) as Record<string, unknown>;
  const result = await deps.runTool(name, inputs, ownerId);
  if (!result.success) {
    return { ok: false, summary: `Tool "${name}" failed: ${result.error ?? 'unknown error'}`, error: result.error };
  }
  return { ok: true, summary: `Tool "${name}" completed.`, result: result.output };
}

// ---------------------------------------------------------------------------
// agent
// ---------------------------------------------------------------------------

async function runAgent(
  task: ScheduledTask,
  ownerId: string,
  config: Record<string, unknown>,
  deps: DispatcherDeps,
): Promise<DispatchResult> {
  if (!deps.startAgentRun) {
    return { ok: false, summary: 'The agent runtime is not available in this process.', error: 'agent_runtime_unavailable' };
  }
  const objective = typeof config.objective === 'string' ? config.objective : task.action;
  const run = await deps.startAgentRun(ownerId, task.title, objective);
  return { ok: true, summary: `Started agent run ${run.id}.`, result: { runId: run.id } };
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

async function runReport(task: ScheduledTask): Promise<DispatchResult> {
  const lines = [
    `Task: ${task.title}`,
    `Instruction: ${task.action}`,
    `Runs so far: ${task.run_count ?? 0}`,
    `Last status: ${task.last_status ?? 'never run'}`,
  ];
  return {
    ok: true,
    summary: lines.join('\n'),
    result: { title: task.title, action: task.action, runCount: task.run_count ?? 0 },
  };
}
