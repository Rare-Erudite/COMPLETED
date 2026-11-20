/**
 * RARE — On-device agent loop (client side).
 *
 * This is the "device acts, results feed back" half of the plan → act → observe
 * loop. It runs inside the RARE Android shell, where the native bridge
 * (window.RareDevice) is present. For each step it:
 *
 *   1. reads the current screen,
 *   2. asks the server planner (POST /api/device/plan) for the next action,
 *   3. performs that action through the native bridge,
 *   4. records the real result, and
 *   5. repeats until the planner says "finish" or the step budget is spent.
 *
 * Every step is reported to the caller as it happens, so the UI can show real
 * progress. Nothing is simulated: if the bridge is absent, or the planner has no
 * model, the loop stops and says so.
 */

import { apiFetch } from '../api.js';
import { device, isDeviceBridgeAvailable, type DeviceResult } from './deviceBridge.js';
import type { DeviceAction } from './deviceActions.js';

export interface AgentStep {
  index: number;
  action: DeviceAction | null;
  reasoning: string;
  result: DeviceResult | null;
  screen?: string;
  provider: string;
  error?: string;
}

export interface AgentRunResult {
  ok: boolean;
  done: boolean;
  summary: string;
  steps: AgentStep[];
  error?: string;
}

export interface AgentRunOptions {
  objective: string;
  maxSteps?: number;
  /** Called after each step so the UI can render live progress. */
  onStep?: (step: AgentStep) => void;
  /** Called before a mutating action; return false to abort. */
  confirm?: (action: DeviceAction, reasoning: string) => Promise<boolean> | boolean;
  /** Abort signal to stop the loop. */
  signal?: AbortSignal;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Performs one validated action through the native bridge. */
async function performAction(action: DeviceAction): Promise<DeviceResult> {
  const args = action.args as Record<string, any>;
  switch (action.tool) {
    case 'describe_screen':
      return device.describeScreen();
    case 'list_apps':
      return device.listApps();
    case 'notifications':
      return device.notifications(typeof args.limit === 'number' ? args.limit : 20);
    case 'tap_text':
      return device.tapText(String(args.text));
    case 'tap_id':
      return device.tapId(String(args.viewId));
    case 'tap_at':
      return device.tapAt(Number(args.x), Number(args.y));
    case 'swipe':
      return device.swipe(Number(args.x1), Number(args.y1), Number(args.x2), Number(args.y2), Number(args.durationMs) || 300);
    case 'type_text':
      return device.typeText(String(args.text));
    case 'scroll':
      return device.scroll(args.direction as 'up' | 'down' | 'left' | 'right');
    case 'global_action':
      return device.globalAction(args.name as 'back' | 'home' | 'recents' | 'notifications' | 'quick_settings' | 'lock');
    case 'open_app':
      return device.openApp(String(args.packageName));
    case 'show_overlay':
      return device.showOverlay(String(args.text));
    case 'hide_overlay':
      return device.hideOverlay();
    case 'wait':
      await sleep(Math.min(Math.max(Number(args.ms) || 500, 100), 5000));
      return { ok: true, message: 'waited' };
    default:
      return { ok: false, error: `Unsupported action "${action.tool}".` };
  }
}

/** Reads the screen, returning a bounded description or an honest error string. */
async function readScreen(): Promise<string> {
  const result = device.describeScreen();
  if (!result.ok) return `(screen unavailable: ${result.error || 'unknown error'})`;
  const data = result.data as { tree?: unknown; text?: string } | undefined;
  if (data && typeof data.text === 'string') return data.text;
  if (data && data.tree) return JSON.stringify(data.tree).slice(0, 4000);
  return JSON.stringify(result.data ?? {}).slice(0, 4000);
}

export async function runDeviceTask(options: AgentRunOptions): Promise<AgentRunResult> {
  const { objective, onStep, confirm, signal } = options;
  const maxSteps = Math.min(Math.max(options.maxSteps ?? 12, 1), 30);
  const steps: AgentStep[] = [];

  if (!isDeviceBridgeAvailable()) {
    return {
      ok: false,
      done: false,
      summary: '',
      steps,
      error: 'Device control is only available in the RARE Android app, not in a browser tab.',
    };
  }

  let screen = await readScreen();
  let history: Array<{ action: DeviceAction | null; result: DeviceResult | null; screen?: string }> = [];

  for (let index = 1; index <= maxSteps; index++) {
    if (signal?.aborted) {
      return { ok: false, done: false, summary: 'Stopped by the user.', steps, error: 'aborted' };
    }

    let decision: {
      action: DeviceAction | null;
      reasoning: string;
      done: boolean;
      summary?: string;
      provider: string;
      error?: string;
    };
    try {
      const response = await apiFetch('/api/device/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective,
          screen,
          step: index,
          maxSteps,
          history: history.map((entry) => ({
            action: entry.action,
            result: entry.result ? { ok: entry.result.ok, message: entry.result.message, error: entry.result.error } : null,
            screen: entry.screen,
          })),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Planner returned HTTP ${response.status}.`);
      }
      decision = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The planner could not be reached.';
      const step: AgentStep = { index, action: null, reasoning: '', result: null, provider: 'none', error: message };
      steps.push(step);
      onStep?.(step);
      return { ok: false, done: false, summary: '', steps, error: message };
    }

    if (decision.done) {
      const step: AgentStep = {
        index,
        action: null,
        reasoning: decision.reasoning,
        result: null,
        provider: decision.provider,
      };
      steps.push(step);
      onStep?.(step);
      return { ok: true, done: true, summary: decision.summary || 'Task finished.', steps };
    }

    if (!decision.action) {
      const message = decision.error || 'The planner did not return an action.';
      const step: AgentStep = { index, action: null, reasoning: decision.reasoning, result: null, provider: decision.provider, error: message };
      steps.push(step);
      onStep?.(step);
      return { ok: false, done: false, summary: '', steps, error: message };
    }

    // Ask before a mutating action when the caller supplied a confirm handler.
    if (confirm) {
      const approved = await confirm(decision.action, decision.reasoning);
      if (!approved) {
        const step: AgentStep = {
          index,
          action: decision.action,
          reasoning: decision.reasoning,
          result: { ok: false, error: 'The user declined this action.' },
          provider: decision.provider,
        };
        steps.push(step);
        onStep?.(step);
        return { ok: false, done: false, summary: 'Stopped: the user declined an action.', steps };
      }
    }

    const result = await performAction(decision.action);
    // Give the UI a moment to settle, then read the screen again so the next
    // decision is based on what actually happened.
    await sleep(400);
    screen = await readScreen();

    const step: AgentStep = {
      index,
      action: decision.action,
      reasoning: decision.reasoning,
      result,
      screen,
      provider: decision.provider,
    };
    steps.push(step);
    onStep?.(step);

    history = [...history, { action: decision.action, result, screen }].slice(-12);
  }

  return {
    ok: false,
    done: false,
    summary: `Reached the ${maxSteps}-step limit without finishing.`,
    steps,
    error: 'step-limit',
  };
}
