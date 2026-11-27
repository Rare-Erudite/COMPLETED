/**
 * IntentExecutor — turns a routed intent into a real action.
 *
 * IntentRouter decides *what* the user asked for. Before this file existed the
 * chat handler only branched on research/build/self_build, so a correctly
 * classified "open WhatsApp" fell through to the language model, which
 * improvised a refusal ("I can't directly open apps"). The router knew the
 * answer and the handler threw it away.
 *
 * This module is the missing half: it executes device, schedule and plugin
 * intents against the real subsystems (the device command queue, the
 * ScheduleEngine binding, the MCP manager) and returns a reply that states what
 * actually happened.
 *
 * Two rules it never breaks:
 *  1. It never reports success for something that was only queued. A device
 *     command that has not come back from the phone is reported as pending.
 *  2. A consequential action (send, call, pay, delete, submit) is never
 *     executed without an explicit confirmation from the user.
 */

import type { IntentDecision } from './IntentRouter.js';

/** Minimal shape of the device queue this module needs. */
export interface DeviceQueueLike {
  enqueue(ownerId: string, action: string, args: Record<string, unknown>, taskId?: string): Promise<{ id: string }>;
  awaitResult(commandId: string, timeoutMs: number): Promise<{
    status: string;
    result?: unknown;
    error?: string | null;
  } | null>;
  isDeviceOnline(ownerId: string): Promise<boolean>;
}

/** Minimal shape of the scheduler binding (see server.ts schedulerBinding()). */
export interface SchedulerLike {
  list(ownerId: string): Promise<Array<Record<string, unknown>>>;
  create(ownerId: string, input: { title: string; instruction: string; schedule: string }): Promise<Record<string, unknown>>;
  setEnabled(ownerId: string, id: string, enabled: boolean): Promise<boolean>;
  remove(ownerId: string, id: string): Promise<boolean>;
  runNow(ownerId: string, id: string): Promise<Record<string, unknown>>;
}

export interface PluginLike {
  list(ownerId: string): Promise<Array<{ id: string; name: string; connected: boolean; toolCount: number; error?: string }>>;
  execute(ownerId: string, tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }>;
}

export interface McpLike {
  statuses(): Array<{ id: string; name: string; connected: boolean; toolCount: number; error?: string }>;
  listTools(): Array<{ qualifiedName: string; name: string; description: string }>;
  callTool(tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }>;
}

export interface IntentExecutionDeps {
  deviceQueue: DeviceQueueLike | null;
  scheduler: SchedulerLike | undefined;
  pluginRegistry: PluginLike | null;
  mcp: McpLike | null;
  /** How long to wait for the phone to answer a command. */
  deviceTimeoutMs?: number;
  /** Documents operations, for find/convert/export requests. */
  documents?: DocumentsLike;
}

/** The slice of DocumentsService the executor needs. */
export interface DocumentsLike {
  list(ownerId: string): Promise<Array<{ path: string; title?: string; kind?: string; mimeType?: string }>>;
  export(ownerId: string, path: string, format: string): Promise<{ path: string; bytes: number; format: string }>;
}

export interface IntentExecutionResult {
  ok: boolean;
  /** The reply shown to the user. Always states what actually happened. */
  reply: string;
  /** Structured evidence, so the UI can render it rather than parse prose. */
  data?: unknown;
  /** True when the action was withheld pending confirmation. */
  needsConfirmation?: boolean;
  /** What the user must confirm, when needsConfirmation is set. */
  confirmationPrompt?: string;
  /** Machine-readable outcome for tests and the client. */
  status: 'executed' | 'queued' | 'awaiting_confirmation' | 'unavailable' | 'failed' | 'reported';
}

const DEFAULT_DEVICE_TIMEOUT_MS = 45_000;

/**
 * Consequential actions. These change the world in a way the user cannot
 * trivially undo, so they are never executed on the strength of a single
 * sentence — the user is asked first.
 */
const CONSEQUENTIAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(send|post|publish|share)\b.*\b(message|text|email|sms|tweet|post|reply)\b/i, label: 'sending a message' },
  { pattern: /\b(call|dial|phone)\b\s+(?!the\b|a\b|my\b)?\+?\d/i, label: 'placing a call' },
  { pattern: /\b(buy|purchase|pay|checkout|order|subscribe)\b/i, label: 'a purchase' },
  { pattern: /\b(delete|remove|erase|wipe|uninstall)\b/i, label: 'deleting something' },
  { pattern: /\b(submit|confirm|accept|agree)\b.*\b(form|order|payment|terms)\b/i, label: 'submitting a form' },
  { pattern: /\b(transfer|withdraw|donate)\b/i, label: 'moving money' },
];

/** True when the message asks for something that needs explicit approval. */
export function isConsequential(message: string): { consequential: boolean; label?: string } {
  for (const entry of CONSEQUENTIAL_PATTERNS) {
    if (entry.pattern.test(message)) return { consequential: true, label: entry.label };
  }
  return { consequential: false };
}

/**
 * Well-known Android packages, so "open WhatsApp" does not need the user to
 * know that WhatsApp is `com.whatsapp`. Anything not listed falls back to a
 * package-name search through list_apps on the device.
 */
const KNOWN_APPS: Record<string, string> = {
  whatsapp: 'com.whatsapp',
  'whatsapp business': 'com.whatsapp.w4b',
  telegram: 'org.telegram.messenger',
  gmail: 'com.google.android.gm',
  email: 'com.google.android.gm',
  chrome: 'com.android.chrome',
  browser: 'com.android.chrome',
  youtube: 'com.google.android.youtube',
  maps: 'com.google.android.apps.maps',
  'google maps': 'com.google.android.apps.maps',
  camera: 'com.android.camera2',
  gallery: 'com.google.android.apps.photos',
  photos: 'com.google.android.apps.photos',
  calculator: 'com.google.android.calculator',
  settings: 'com.android.settings',
  clock: 'com.google.android.deskclock',
  calendar: 'com.google.android.calendar',
  spotify: 'com.spotify.music',
  instagram: 'com.instagram.android',
  facebook: 'com.facebook.katana',
  x: 'com.twitter.android',
  twitter: 'com.twitter.android',
  tiktok: 'com.zhiliaoapp.musically',
  playstore: 'com.android.vending',
  'play store': 'com.android.vending',
  files: 'com.google.android.documentsui',
  contacts: 'com.google.android.contacts',
  phone: 'com.google.android.dialer',
  messages: 'com.google.android.apps.messaging',
};

/** Resolve an app name mentioned in the message to a package name. */
export function resolveAppPackage(message: string): { packageName?: string; appName?: string } {
  const lower = message.toLowerCase();
  // Longest name first so "google maps" wins over "maps".
  const names = Object.keys(KNOWN_APPS).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) {
      return { packageName: KNOWN_APPS[name], appName: name };
    }
  }
  // "open <something>" — pass the raw word through; the device resolves it.
  const openMatch = lower.match(/\bopen\s+(?:the\s+|my\s+)?([a-z0-9][a-z0-9 ._-]{1,30})/);
  if (openMatch) return { appName: openMatch[1].trim() };
  return {};
}

/**
 * Map a device request onto a concrete device action.
 *
 * Returns null when the message is a device intent but names no action this
 * build can perform — the caller then says so instead of guessing.
 */
export function planDeviceAction(message: string): { action: string; args: Record<string, unknown>; description: string } | null {
  const lower = message.toLowerCase();

  if (/\b(describe|read|what(?:'s| is) on)\b.*\b(screen|display)\b/.test(lower)) {
    return { action: 'describe_screen', args: {}, description: 'read the current screen' };
  }
  if (/\b(notification|notifications)\b/.test(lower)) {
    return { action: 'notifications', args: { limit: 20 }, description: 'read the notifications' };
  }
  if (/\bscroll\s+(down|up)\b/.test(lower)) {
    const direction = /scroll\s+down/.test(lower) ? 'down' : 'up';
    return { action: 'scroll', args: { direction }, description: `scroll ${direction}` };
  }
  if (/\b(go|press|navigate)\s+(back|home)\b/.test(lower)) {
    const name = /\bhome\b/.test(lower) ? 'home' : 'back';
    return { action: 'global_action', args: { name }, description: `press ${name}` };
  }
  if (/\b(list|show)\b.*\b(apps|applications)\b/.test(lower)) {
    return { action: 'list_apps', args: {}, description: 'list installed apps' };
  }
  if (/\bopen\b/.test(lower)) {
    const resolved = resolveAppPackage(message);
    if (resolved.packageName) {
      return {
        action: 'open_app',
        args: { packageName: resolved.packageName },
        description: `open ${resolved.appName}`,
      };
    }
    if (resolved.appName) {
      // No known package: ask the device to resolve the label.
      return {
        action: 'open_app',
        args: { appName: resolved.appName },
        description: `open ${resolved.appName}`,
      };
    }
  }
  return null;
}

/** Human-readable rendering of a device command result. */
function describeDeviceResult(action: string, result: unknown): string {
  if (result === null || result === undefined) return 'The device returned no data.';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (action === 'describe_screen') {
      const elements = Array.isArray(record.elements) ? record.elements : [];
      if (elements.length === 0) return 'The screen is empty or could not be read.';
      const lines = elements
        .slice(0, 40)
        .map((element: any) => {
          const text = element?.text || element?.contentDescription || element?.viewId || '(unlabelled)';
          return `- ${String(text).slice(0, 120)}`;
        });
      return `On screen now (${elements.length} element(s)):\n${lines.join('\n')}`;
    }
    if (action === 'notifications') {
      const items = Array.isArray(record.notifications) ? record.notifications : [];
      if (items.length === 0) return 'There are no notifications in the shade.';
      const lines = items.slice(0, 20).map((item: any) => {
        const pkg = item?.package ? ` [${item.package}]` : '';
        return `- ${String(item?.title || '(no title)').slice(0, 80)}${pkg}: ${String(item?.text || '').slice(0, 120)}`;
      });
      return `${items.length} notification(s):\n${lines.join('\n')}`;
    }
    if (action === 'list_apps') {
      const apps = Array.isArray(record.apps) ? record.apps : [];
      return `${apps.length} app(s) installed.`;
    }
    return JSON.stringify(result).slice(0, 1200);
  }
  return String(result);
}

/**
 * Execute a device intent.
 *
 * The phone is a client, not a server: the command is queued and the phone
 * picks it up on its next poll. So "offline" is a real, common state and is
 * reported as such rather than being papered over.
 */
async function executeDeviceIntent(
  message: string,
  ownerId: string,
  deps: IntentExecutionDeps,
): Promise<IntentExecutionResult> {
  if (!deps.deviceQueue) {
    return {
      ok: false,
      status: 'unavailable',
      reply: 'The device channel is not initialised on the server, so I cannot reach your phone right now.',
    };
  }

  const plan = planDeviceAction(message);
  if (!plan) {
    return {
      ok: false,
      status: 'unavailable',
      reply:
        'I recognised that as a phone action but could not tell which one. ' +
        'Try "describe what is on my screen", "scroll down", "check my notifications" or "open WhatsApp".',
    };
  }

  const online = await deps.deviceQueue.isDeviceOnline(ownerId);
  if (!online) {
    return {
      ok: false,
      status: 'unavailable',
      reply:
        `I can ${plan.description}, but no device is connected right now. ` +
        'Open the RARE app on your phone and make sure it is signed in to this account — ' +
        'then ask me again. Nothing was queued.',
      data: { action: plan.action, online: false },
    };
  }

  const command = await deps.deviceQueue.enqueue(ownerId, plan.action, plan.args);
  const finished = await deps.deviceQueue.awaitResult(
    command.id,
    deps.deviceTimeoutMs ?? DEFAULT_DEVICE_TIMEOUT_MS,
  );

  if (!finished) {
    return {
      ok: false,
      status: 'queued',
      reply:
        `I sent "${plan.description}" to your phone but it has not answered yet. ` +
        'The command is queued and will run when the device next polls — I will not claim it succeeded.',
      data: { commandId: command.id, action: plan.action },
    };
  }

  if (finished.status === 'failed') {
    return {
      ok: false,
      status: 'failed',
      reply: `Your phone could not ${plan.description}: ${finished.error || 'the device reported a failure'}.`,
      data: { commandId: command.id, action: plan.action, error: finished.error },
    };
  }

  if (finished.status !== 'done') {
    return {
      ok: false,
      status: 'queued',
      reply: `The command to ${plan.description} is still ${finished.status}. It has not completed.`,
      data: { commandId: command.id, action: plan.action, status: finished.status },
    };
  }

  return {
    ok: true,
    status: 'executed',
    reply: describeDeviceResult(plan.action, finished.result),
    data: { commandId: command.id, action: plan.action, result: finished.result },
  };
}

/** Turn "every morning" and friends into a schedule expression the engine parses. */
export function inferScheduleExpression(message: string): string {
  const lower = message.toLowerCase();
  const atTime = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (atTime) {
    let hour = Number(atTime[1]);
    const minute = atTime[2] ? Number(atTime[2]) : 0;
    const meridiem = atTime[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    if (/\b(week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(lower)) {
      return `every day at ${hh}:${mm}`;
    }
    return `every day at ${hh}:${mm}`;
  }
  if (/\bevery\s+morning\b/.test(lower)) return 'every day at 08:00';
  if (/\bevery\s+(evening|night)\b/.test(lower)) return 'every day at 20:00';
  if (/\bevery\s+hour\b/.test(lower)) return 'every hour';
  const everyMinutes = lower.match(/\bevery\s+(\d{1,3})\s*(?:minutes?|mins?)\b/);
  if (everyMinutes) return `every ${everyMinutes[1]} minutes`;
  const wordMinutes: Record<string, number> = { two: 2, five: 5, ten: 10, fifteen: 15, thirty: 30 };
  const everyWord = lower.match(/\bevery\s+(two|five|ten|fifteen|thirty)\s*minutes?\b/);
  if (everyWord) return `every ${wordMinutes[everyWord[1]]} minutes`;
  if (/\bevery\s+day\b/.test(lower)) return 'every day at 09:00';
  if (/\bevery\s+week\b/.test(lower)) return 'every week';
  if (/\bin\s+(\d+)\s*minutes?\b/.test(lower)) {
    const minutes = Number(lower.match(/\bin\s+(\d+)\s*minutes?\b/)![1]);
    return `in ${minutes} minutes`;
  }
  if (/\bin\s+an?\s+hour\b/.test(lower)) return 'in 60 minutes';
  return 'every day at 09:00';
}

/** Strip the scheduling phrase so the stored instruction is the actual task. */
function extractScheduleInstruction(message: string): string {
  return message
    .replace(/^\s*(please\s+)?(can you\s+|could you\s+)?/i, '')
    .replace(/\b(remind me|set a reminder|set an alarm|schedule)\b\s*(to|that|for)?\s*/i, '')
    .replace(/\b(every\s+(morning|evening|night|day|week|hour)|every\s+\d+\s*minutes?|at\s+\d{1,2}(:\d{2})?\s*(am|pm)?)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || message.trim();
}

async function executeScheduleIntent(
  message: string,
  ownerId: string,
  deps: IntentExecutionDeps,
): Promise<IntentExecutionResult> {
  if (!deps.scheduler) {
    return {
      ok: false,
      status: 'unavailable',
      reply: 'The scheduler is not initialised yet (storage is still starting). Try again in a moment.',
    };
  }
  const lower = message.toLowerCase();

  // Management of an existing task: pause / resume / cancel / list.
  const management = lower.match(/\b(pause|resume|cancel|delete|remove|stop|list|show)\b/);
  if (management) {
    const tasks = await deps.scheduler.list(ownerId);
    if (tasks.length === 0) {
      return {
        ok: false,
        status: 'reported',
        reply: 'You have no scheduled tasks, so there is nothing to ' + management[1] + '.',
        data: { tasks: [] },
      };
    }
    const verb = management[1];
    if (verb === 'list' || verb === 'show') {
      const lines = tasks.map((task) => {
        const title = String(task.title || task.instruction || '(untitled)');
        const schedule = String(task.schedule || task.time || '');
        const status = String(task.status || (task.enabled ? 'active' : 'paused'));
        return `- ${title} — ${schedule} (${status})`;
      });
      return {
        ok: true,
        status: 'reported',
        reply: `${tasks.length} scheduled task(s):\n${lines.join('\n')}`,
        data: { tasks },
      };
    }

    // Target the task the user named, else the only one, else ask.
    const named = tasks.find((task) => {
      const title = String(task.title || '').toLowerCase();
      return title && lower.includes(title);
    });
    const target = named || (tasks.length === 1 ? tasks[0] : undefined);
    if (!target) {
      const lines = tasks.map((task) => `- ${String(task.title || '(untitled)')} (id ${String(task.id)})`);
      return {
        ok: false,
        status: 'reported',
        reply: `You have ${tasks.length} scheduled tasks. Which one?\n${lines.join('\n')}`,
        data: { tasks },
      };
    }

    const id = String(target.id);
    if (verb === 'pause' || verb === 'stop') {
      const changed = await deps.scheduler.setEnabled(ownerId, id, false);
      return changed
        ? { ok: true, status: 'executed', reply: `Paused "${String(target.title || id)}". It will not run until you resume it.`, data: { id } }
        : { ok: false, status: 'failed', reply: `I could not pause "${String(target.title || id)}".`, data: { id } };
    }
    if (verb === 'resume') {
      const changed = await deps.scheduler.setEnabled(ownerId, id, true);
      return changed
        ? { ok: true, status: 'executed', reply: `Resumed "${String(target.title || id)}".`, data: { id } }
        : { ok: false, status: 'failed', reply: `I could not resume "${String(target.title || id)}".`, data: { id } };
    }
    // cancel / delete / remove
    const removed = await deps.scheduler.remove(ownerId, id);
    return removed
      ? { ok: true, status: 'executed', reply: `Deleted "${String(target.title || id)}".`, data: { id } }
      : { ok: false, status: 'failed', reply: `I could not delete "${String(target.title || id)}".`, data: { id } };
  }

  // Creation.
  const schedule = inferScheduleExpression(message);
  const instruction = extractScheduleInstruction(message);
  const task = await deps.scheduler.create(ownerId, {
    title: instruction.slice(0, 80) || 'Scheduled task',
    instruction,
    schedule,
  });
  return {
    ok: true,
    status: 'executed',
    reply:
      `Scheduled: "${String(task.title || instruction)}" — ${schedule}. ` +
      `It is stored as task ${String(task.id)} and the engine will run it on its next tick.`,
    data: task,
  };
}

async function executePluginIntent(
  message: string,
  ownerId: string,
  deps: IntentExecutionDeps,
): Promise<IntentExecutionResult> {
  const lower = message.toLowerCase();
  const statuses = deps.mcp ? deps.mcp.statuses() : [];
  const tools = deps.mcp ? deps.mcp.listTools() : [];
  const connected = statuses.filter((server) => server.connected);

  // "list my plugins" / "what mcp servers" — report the real state.
  if (/\b(list|show|what)\b/.test(lower) && !/\b(use|run|call|invoke|perform)\b/.test(lower)) {
    if (statuses.length === 0) {
      return {
        ok: false,
        status: 'reported',
        reply:
          'No MCP servers are configured on this deployment, so there are no external integrations to list. ' +
          'RARE\'s built-in capabilities (research, documents, scheduler, device control) are separate from MCP plugins.',
        data: { servers: [], tools: [] },
      };
    }
    const lines = statuses.map((server) => {
      const state = server.connected ? `connected, ${server.toolCount} tool(s)` : `not connected${server.error ? `: ${server.error}` : ''}`;
      return `- ${server.name} (${server.id}) — ${state}`;
    });
    return {
      ok: connected.length > 0,
      status: 'reported',
      reply: `${connected.length}/${statuses.length} MCP server(s) connected, ${tools.length} tool(s) discovered:\n${lines.join('\n')}`,
      data: { servers: statuses, tools },
    };
  }

  // "use the connected plugin to perform this task" — there is no tool named
  // in the message, so report what is actually callable rather than inventing
  // a call.
  if (connected.length === 0) {
    return {
      ok: false,
      status: 'unavailable',
      reply:
        'No MCP plugin is connected, so there is no tool I can call. ' +
        'Configure a server (RARE_MCP_SERVERS) or install one from the Plugins page, then ask again.',
      data: { servers: statuses },
    };
  }

  const namedTool = tools.find((tool) => lower.includes(tool.name.toLowerCase()));
  if (!namedTool) {
    const lines = tools.slice(0, 20).map((tool) => `- ${tool.qualifiedName}: ${tool.description.slice(0, 100)}`);
    return {
      ok: false,
      status: 'reported',
      reply:
        `${connected.length} plugin(s) are connected with ${tools.length} tool(s). ` +
        `Tell me which tool to run:\n${lines.join('\n')}`,
      data: { tools },
    };
  }

  const result = await deps.mcp!.callTool(namedTool.qualifiedName, {});
  return {
    ok: result.ok,
    status: result.ok ? 'executed' : 'failed',
    reply: result.ok
      ? `Ran "${namedTool.qualifiedName}". Result:\n${JSON.stringify(result.result).slice(0, 1500)}`
      : `"${namedTool.qualifiedName}" failed: ${result.error || 'unknown error'}`,
    data: result,
  };
}

/**
 * Execute a documents request: find a stored document and convert/export it.
 *
 * The router sends "find my document and convert it to PDF" here. Before this
 * branch existed the request reached the model, which described the steps
 * instead of doing them — the exact failure the directive calls out.
 */
async function executeDocumentsIntent(
  message: string,
  ownerId: string,
  deps: IntentExecutionDeps,
): Promise<IntentExecutionResult> {
  if (!deps.documents) {
    return {
      ok: false,
      status: 'unavailable',
      reply: 'Document storage is not initialised on the server, so I cannot reach your documents right now.',
    };
  }

  const lower = message.toLowerCase();
  const formatMatch = lower.match(/\b(?:to|as|into)\s+(pdf|docx|xlsx|html|md|markdown|txt|text|json|csv)\b/);
  const format = formatMatch
    ? ({ markdown: 'md', text: 'txt' } as Record<string, string>)[formatMatch[1]] || formatMatch[1]
    : null;

  const documents = await deps.documents.list(ownerId);
  if (documents.length === 0) {
    return {
      ok: false,
      status: 'reported',
      reply: 'You have no stored documents yet, so there is nothing to find or convert.',
      data: { documents: [] },
    };
  }

  // Prefer a document whose name the user actually said.
  const named = documents.find((document) => {
    const base = document.path.split('/').pop()?.toLowerCase() || '';
    const stem = base.replace(/\.[^.]+$/, '');
    return stem.length > 2 && lower.includes(stem);
  });
  const target = named || (documents.length === 1 ? documents[0] : undefined);

  if (!target) {
    const lines = documents.slice(0, 20).map((document) => `- ${document.path}`);
    return {
      ok: false,
      status: 'reported',
      reply: `You have ${documents.length} documents. Which one?\n${lines.join('\n')}`,
      data: { documents },
    };
  }

  if (!format) {
    return {
      ok: false,
      status: 'reported',
      reply: `I found "${target.path}". What format should I convert it to — PDF, DOCX, XLSX, HTML, MD, TXT, JSON or CSV?`,
      data: { document: target },
    };
  }

  const exported = await deps.documents.export(ownerId, target.path, format);
  return {
    ok: true,
    status: 'executed',
    reply: `Converted "${target.path}" to ${format.toUpperCase()} — saved as "${exported.path}" (${exported.bytes} bytes).`,
    data: exported,
  };
}

/**
 * Execute a routed intent. Returns null when the intent is not one this module
 * handles, so the caller can fall through to its existing branches.
 */
export async function executeIntent(
  decision: IntentDecision,
  message: string,
  ownerId: string,
  deps: IntentExecutionDeps,
  options: { confirmed?: boolean } = {},
): Promise<IntentExecutionResult | null> {
  if (
    decision.intent !== 'device' &&
    decision.intent !== 'schedule' &&
    decision.intent !== 'plugin' &&
    decision.intent !== 'documents'
  ) {
    return null;
  }

  // A consequential request is never executed on the first sentence.
  const risk = isConsequential(message);
  if (risk.consequential && !options.confirmed) {
    return {
      ok: false,
      status: 'awaiting_confirmation',
      needsConfirmation: true,
      confirmationPrompt:
        `This looks like ${risk.label}. I will not do that without your explicit confirmation. ` +
        'Reply "yes, do it" to proceed, or tell me what to change.',
      reply:
        `This looks like ${risk.label}. I will not do that without your explicit confirmation. ` +
        'Reply "yes, do it" to proceed, or tell me what to change.',
      data: { intent: decision.intent, risk: risk.label },
    };
  }

  switch (decision.intent) {
    case 'device':
      return executeDeviceIntent(message, ownerId, deps);
    case 'schedule':
      return executeScheduleIntent(message, ownerId, deps);
    case 'plugin':
      return executePluginIntent(message, ownerId, deps);
    case 'documents':
      return executeDocumentsIntent(message, ownerId, deps);
    default:
      return null;
  }
}
