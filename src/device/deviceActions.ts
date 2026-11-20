/**
 * RARE — Canonical device-action catalogue.
 *
 * This is the single source of truth for what the assistant is allowed to ask
 * the phone to do. It is deliberately pure TypeScript with no Node or browser
 * imports, so the SAME catalogue is used by:
 *
 *   - the server-side LLM planner (src/server/device/DevicePlanner.ts), which
 *     shows it to the model as the tool list and validates every action the
 *     model returns against it, and
 *   - the client-side agent loop (src/device/deviceAgent.ts), which executes the
 *     validated action through the native bridge (window.RareDevice).
 *
 * Nothing here performs an action. It only describes actions, so a model can
 * never invent a capability that the native layer does not implement: an action
 * that is not in this list is rejected before it reaches the device.
 */

export type DeviceActionName =
  | 'describe_screen'
  | 'list_apps'
  | 'notifications'
  | 'tap_text'
  | 'tap_id'
  | 'tap_at'
  | 'swipe'
  | 'type_text'
  | 'scroll'
  | 'global_action'
  | 'open_app'
  | 'show_overlay'
  | 'hide_overlay'
  | 'wait'
  | 'finish';

export interface DeviceActionParam {
  name: string;
  type: 'string' | 'number';
  description: string;
  required: boolean;
  enum?: string[];
}

export interface DeviceActionSpec {
  name: DeviceActionName;
  description: string;
  params: DeviceActionParam[];
  /**
   * True when the action changes device state in a way the user should confirm
   * before it runs (typing, tapping, launching, navigating). Read-only actions
   * (reading the screen, listing apps, reading notifications) are not sensitive.
   */
  mutating: boolean;
  /**
   * True when the action could be destructive or hard to undo and therefore
   * always requires an explicit user confirmation, even inside an approved task.
   */
  sensitive: boolean;
}

export const DEVICE_ACTIONS: DeviceActionSpec[] = [
  {
    name: 'describe_screen',
    description:
      'Read the current screen as a bounded tree of visible elements (text, ids, bounds). Use this first, and again after every action, to see what changed.',
    params: [],
    mutating: false,
    sensitive: false,
  },
  {
    name: 'list_apps',
    description: 'List the launchable apps installed on the device (label and package name).',
    params: [],
    mutating: false,
    sensitive: false,
  },
  {
    name: 'notifications',
    description: 'Read the current notifications from the shade (title, text, package).',
    params: [
      { name: 'limit', type: 'number', description: 'Maximum notifications to return (1-50).', required: false },
    ],
    mutating: false,
    sensitive: false,
  },
  {
    name: 'tap_text',
    description: 'Tap the first visible element whose text or content description matches the given string.',
    params: [
      { name: 'text', type: 'string', description: 'Exact or partial visible text of the element to tap.', required: true },
    ],
    mutating: true,
    sensitive: false,
  },
  {
    name: 'tap_id',
    description: 'Tap the first visible element whose view id (resource name) matches the given string.',
    params: [
      { name: 'viewId', type: 'string', description: 'View id / resource name of the element to tap.', required: true },
    ],
    mutating: true,
    sensitive: false,
  },
  {
    name: 'tap_at',
    description: 'Tap at absolute screen coordinates. Prefer tap_text/tap_id; use this only when no element matches.',
    params: [
      { name: 'x', type: 'number', description: 'X coordinate in pixels.', required: true },
      { name: 'y', type: 'number', description: 'Y coordinate in pixels.', required: true },
    ],
    mutating: true,
    sensitive: false,
  },
  {
    name: 'swipe',
    description: 'Swipe from one point to another (e.g. to scroll a list or dismiss a card).',
    params: [
      { name: 'x1', type: 'number', description: 'Start X.', required: true },
      { name: 'y1', type: 'number', description: 'Start Y.', required: true },
      { name: 'x2', type: 'number', description: 'End X.', required: true },
      { name: 'y2', type: 'number', description: 'End Y.', required: true },
      { name: 'durationMs', type: 'number', description: 'Swipe duration in milliseconds (default 300).', required: false },
    ],
    mutating: true,
    sensitive: false,
  },
  {
    name: 'type_text',
    description: 'Type text into the currently focused editable field.',
    params: [
      { name: 'text', type: 'string', description: 'The text to type.', required: true },
    ],
    mutating: true,
    sensitive: false,
  },
  {
    name: 'scroll',
    description: 'Scroll the primary scrollable container in a direction.',
    params: [
      { name: 'direction', type: 'string', description: 'Direction to scroll.', required: true, enum: ['up', 'down', 'left', 'right'] },
    ],
    mutating: true,
    sensitive: false,
  },
  {
    name: 'global_action',
    description: 'Perform a system navigation action.',
    params: [
      { name: 'name', type: 'string', description: 'The system action.', required: true, enum: ['back', 'home', 'recents', 'notifications', 'quick_settings', 'lock'] },
    ],
    mutating: true,
    sensitive: false,
  },
  {
    name: 'open_app',
    description: 'Launch an installed app by its package name (use list_apps to find it).',
    params: [
      { name: 'packageName', type: 'string', description: 'Android package name, e.g. com.android.settings.', required: true },
    ],
    mutating: true,
    sensitive: false,
  },
  {
    name: 'show_overlay',
    description: 'Show the floating status pill with a short message, so the user can see what RARE is doing.',
    params: [
      { name: 'text', type: 'string', description: 'Short status text (max ~80 chars).', required: true },
    ],
    mutating: true,
    sensitive: false,
  },
  {
    name: 'hide_overlay',
    description: 'Hide the floating status pill.',
    params: [],
    mutating: true,
    sensitive: false,
  },
  {
    name: 'wait',
    description: 'Pause briefly to let the screen settle before reading it again.',
    params: [
      { name: 'ms', type: 'number', description: 'Milliseconds to wait (100-5000).', required: false },
    ],
    mutating: false,
    sensitive: false,
  },
  {
    name: 'finish',
    description: 'Declare the task complete (or impossible) and stop. Always end with this.',
    params: [
      { name: 'summary', type: 'string', description: 'What was accomplished, or why it could not be done.', required: true },
    ],
    mutating: false,
    sensitive: false,
  },
];

const ACTION_BY_NAME = new Map<string, DeviceActionSpec>(DEVICE_ACTIONS.map((a) => [a.name, a]));

export function getDeviceAction(name: string): DeviceActionSpec | undefined {
  return ACTION_BY_NAME.get(name);
}

export interface DeviceAction {
  tool: DeviceActionName;
  args: Record<string, unknown>;
}

export interface DeviceActionValidation {
  valid: boolean;
  error?: string;
  action?: DeviceAction;
}

/**
 * Validates a model-proposed action against the catalogue. This is the security
 * boundary: an action that is not in the catalogue, or whose arguments do not
 * match the declared schema, is rejected here and never reaches the device.
 */
export function validateDeviceAction(raw: unknown): DeviceActionValidation {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'The action must be an object.' };
  }
  const candidate = raw as { tool?: unknown; args?: unknown };
  if (typeof candidate.tool !== 'string') {
    return { valid: false, error: 'The action must name a tool.' };
  }
  const spec = getDeviceAction(candidate.tool);
  if (!spec) {
    return { valid: false, error: `Unknown device action "${candidate.tool}".` };
  }
  const args = (candidate.args && typeof candidate.args === 'object' ? candidate.args : {}) as Record<string, unknown>;

  for (const param of spec.params) {
    const value = args[param.name];
    if (value === undefined || value === null || value === '') {
      if (param.required) {
        return { valid: false, error: `Action "${spec.name}" requires the "${param.name}" argument.` };
      }
      continue;
    }
    if (param.type === 'number') {
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num)) {
        return { valid: false, error: `Argument "${param.name}" of "${spec.name}" must be a number.` };
      }
      args[param.name] = num;
    } else {
      if (typeof value !== 'string') {
        return { valid: false, error: `Argument "${param.name}" of "${spec.name}" must be a string.` };
      }
      if (param.enum && !param.enum.includes(value)) {
        return { valid: false, error: `Argument "${param.name}" of "${spec.name}" must be one of: ${param.enum.join(', ')}.` };
      }
    }
  }

  return { valid: true, action: { tool: spec.name, args } };
}

/** A compact, model-facing description of the catalogue. */
export function describeDeviceActionsForModel(): string {
  return DEVICE_ACTIONS.map((action) => {
    const params = action.params.length
      ? action.params
          .map((p) => `${p.name}${p.required ? '' : '?'}:${p.type}${p.enum ? `(${p.enum.join('|')})` : ''}`)
          .join(', ')
      : 'no arguments';
    return `- ${action.name}(${params}) — ${action.description}`;
  }).join('\n');
}
