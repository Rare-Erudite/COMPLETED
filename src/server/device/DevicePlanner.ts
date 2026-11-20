/**
 * RARE — Device task planner (server side).
 *
 * This is the "model plans" half of the plan → act → observe loop. Given a
 * natural-language objective, the current screen state and the history of what
 * has already been tried, it asks RARE's intelligence layer for the SINGLE next
 * action to take, validates that action against the canonical catalogue
 * (src/device/deviceActions.ts) and returns it.
 *
 * IMPORTANT — this planner does NOT talk to a model provider directly. It calls
 * the RARE orchestrator (src/engine/orchestrator/orchestrator.ts), which owns:
 *
 *   • model orchestration and routing,
 *   • selection of a model according to the task ("device_planning"),
 *   • tool calling and execution,
 *   • memory and context management,
 *   • planning and autonomous workflows,
 *   • provider configuration and health checks,
 *   • model evaluation and fallback handling.
 *
 * So when a provider fails or is unhealthy, the orchestrator — not this file —
 * decides what to try next, and the decision it returns names the provider that
 * actually answered. The device loop keeps its plan → act → observe cycle: the
 * client performs the action, reads the real screen, and calls back with the
 * result, which is fed into the next planning turn.
 *
 * The loop itself lives on the client (src/device/deviceAgent.ts) because only
 * the device can actually perform an action and read the resulting screen. The
 * server never pretends to have touched the phone: it only decides the next
 * step and hands it back.
 *
 * If no real language model is reachable, the planner says so and returns no
 * action rather than inventing one — the caller surfaces that honestly.
 */

import type { RareOrchestrator } from '../../engine/orchestrator/orchestrator.js';
import {
  describeDeviceActionsForModel,
  validateDeviceAction,
  getDeviceAction,
  type DeviceAction,
} from '../../device/deviceActions.js';

export interface DeviceObservation {
  /** The action that was attempted, or null for the initial observation. */
  action: DeviceAction | null;
  /** The device's own result for that action (ok/message/error). */
  result: { ok: boolean; message?: string; error?: string } | null;
  /** A bounded description of the screen after the action, when it was read. */
  screen?: string;
}

export interface DevicePlanRequest {
  objective: string;
  /** Bounded description of the current screen (from describe_screen). */
  screen: string;
  /** What has already been tried, oldest first. */
  history: DeviceObservation[];
  /** True when the user has already approved mutating actions for this task. */
  approved: boolean;
  /** Hard cap on steps, enforced by the caller as well. */
  step: number;
  maxSteps: number;
}

export interface DevicePlanDecision {
  /** The next action to perform, or null when the model could not decide. */
  action: DeviceAction | null;
  /** The model's short reasoning, surfaced to the user. */
  reasoning: string;
  /** True when the model declared the task finished. */
  done: boolean;
  /** Final summary when done. */
  summary?: string;
  /** Which provider answered, for honest reporting. */
  provider: string;
  /** Which orchestrator task profile routed this decision. */
  taskKind?: string;
  /** Every provider the orchestrator tried, in order, with its outcome. */
  attempts?: Array<{ provider: string; ok: boolean; error?: string }>;
  /** Set when no action could be produced. */
  error?: string;
}

const SYSTEM_PROMPT = `You are RARE's on-device task planner. You control an Android phone through a fixed set of actions and you must accomplish the user's objective one step at a time.

You will be shown:
- the objective,
- the current screen as a bounded tree of visible elements,
- the history of actions already taken and their results.

Rules:
1. Reply with EXACTLY ONE JSON object and nothing else, of the form {"tool":"<name>","args":{...},"reasoning":"<one short sentence>"}.
2. "tool" MUST be one of the actions listed below. Never invent an action.
3. Read the screen before acting, and read it again after each action to confirm the result. If the screen did not change as expected, try a different approach.
4. Prefer tap_text over tap_at. Only use coordinates when no element matches.
5. When the objective is achieved, or is genuinely impossible, reply with {"tool":"finish","args":{"summary":"..."},"reasoning":"..."}.
6. Never type passwords, payment details, or other secrets. If the objective requires them, finish and explain that the user must do that step.
7. Do not repeat an action that already failed in the same way; change your approach.

Available actions:
${describeDeviceActionsForModel()}`;

function renderHistory(history: DeviceObservation[]): string {
  if (history.length === 0) return '(no actions taken yet)';
  return history
    .map((entry, index) => {
      const action = entry.action ? `${entry.action.tool}(${JSON.stringify(entry.action.args)})` : 'observe';
      const result = entry.result
        ? entry.result.ok
          ? `ok: ${entry.result.message || 'done'}`
          : `FAILED: ${entry.result.error || 'unknown error'}`
        : 'no result';
      const screen = entry.screen ? `\n    screen after: ${entry.screen.slice(0, 1200)}` : '';
      return `  ${index + 1}. ${action} -> ${result}${screen}`;
    })
    .join('\n');
}

/** Extracts the first balanced JSON object from a model reply. */
function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export class DevicePlanner {
  constructor(private orchestrator: RareOrchestrator) {}

  public async planNextAction(request: DevicePlanRequest): Promise<DevicePlanDecision> {
    const { objective, screen, history, step, maxSteps } = request;

    const userPrompt = [
      `Objective: ${objective}`,
      `Step ${step} of at most ${maxSteps}.`,
      '',
      'Current screen:',
      screen.slice(0, 4000) || '(the screen could not be read)',
      '',
      'History:',
      renderHistory(history),
      '',
      'Decide the single next action. Reply with one JSON object only.',
    ].join('\n');

    let text: string;
    let provider: string;
    let attempts: Array<{ provider: string; ok: boolean; error?: string }> = [];
    try {
      // Route through RARE's intelligence layer, not a bare provider. The
      // orchestrator picks the model for "device_planning", applies fallback
      // when a provider fails or is unhealthy, and reports which one answered.
      const result = await this.orchestrator.run({
        taskKind: 'device_planning',
        systemInstruction: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.2,
        maxOutputTokens: 700,
        maxToolRounds: 1,
        // A device plan must be a JSON action; anything else is a failed attempt
        // and the orchestrator falls back to the next provider.
        validate: (reply) => (extractJsonObject(reply) ? null : 'reply was not a JSON action'),
      });
      text = result.text;
      provider = result.provider;
      attempts = result.attempts.map((a) => ({ provider: a.provider, ok: a.ok, error: a.error }));
    } catch (error) {
      return {
        action: null,
        reasoning: '',
        done: false,
        provider: 'none',
        taskKind: 'device_planning',
        error:
          error instanceof Error
            ? `No language model is available to plan the task: ${error.message}`
            : 'No language model is available to plan the task.',
      };
    }

    const parsed = extractJsonObject(text);
    if (!parsed) {
      return {
        action: null,
        reasoning: '',
        done: false,
        provider,
        taskKind: 'device_planning',
        attempts,
        error: 'The planner did not return a usable action. It replied with text that was not a JSON action.',
      };
    }

    const validation = validateDeviceAction(parsed);
    if (!validation.valid || !validation.action) {
      return {
        action: null,
        reasoning: '',
        done: false,
        provider,
        taskKind: 'device_planning',
        attempts,
        error: validation.error || 'The planner proposed an action that is not permitted.',
      };
    }

    const reasoning =
      typeof (parsed as { reasoning?: unknown }).reasoning === 'string'
        ? String((parsed as { reasoning: string }).reasoning).slice(0, 400)
        : '';

    if (validation.action.tool === 'finish') {
      const summary = String(validation.action.args.summary || 'Task finished.');
      return { action: null, reasoning, done: true, summary, provider, taskKind: 'device_planning', attempts };
    }

    // A mutating action that the user has not approved is returned but flagged
    // by the caller, which is responsible for asking. The planner itself never
    // performs anything.
    const spec = getDeviceAction(validation.action.tool);
    if (spec?.sensitive && !request.approved) {
      return {
        action: validation.action,
        reasoning,
        done: false,
        provider,
        taskKind: 'device_planning',
        attempts,
        error: 'This action is sensitive and needs explicit user confirmation before it runs.',
      };
    }

    return { action: validation.action, reasoning, done: false, provider, taskKind: 'device_planning', attempts };
  }
}
