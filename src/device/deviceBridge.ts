/**
 * Typed wrapper around the Android device bridge (`window.RareDevice`).
 *
 * The bridge is injected by the native shell (see android/device/DeviceBridge.java).
 * In a browser it is absent, and every call here reports that honestly instead
 * of pretending the capability exists.
 *
 * Every method returns the bridge's own JSON, parsed. Nothing is inferred: if
 * the native side said `ok:false`, the caller sees `ok:false` and the reason.
 */

export interface DeviceCapabilities {
  ok: boolean;
  platform: string;
  sdk?: number;
  accessibility: boolean;
  notifications: boolean;
  overlay: boolean;
  foregroundService: boolean;
  foregroundPackage?: string;
  notificationCount?: number;
}

export interface DeviceResult {
  ok: boolean;
  message?: string;
  error?: string;
  data?: unknown;
}

interface RareDeviceBridge {
  capabilities(): string;
  requestAccessibility(): string;
  requestNotificationAccess(): string;
  requestOverlay(): string;
  describeScreen(): string;
  listApps(): string;
  notifications(limit: number): string;
  tapText(text: string): string;
  tapId(viewId: string): string;
  tapAt(x: number, y: number): string;
  swipe(x1: number, y1: number, x2: number, y2: number, durationMs: number): string;
  typeText(text: string): string;
  scroll(direction: string): string;
  globalAction(name: string): string;
  openApp(packageName: string): string;
  showOverlay(text: string): string;
  hideOverlay(): string;
  startBackgroundService(): string;
  stopBackgroundService(): string;
}

function bridge(): RareDeviceBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { RareDevice?: RareDeviceBridge }).RareDevice;
  return candidate && typeof candidate.capabilities === 'function' ? candidate : null;
}

/** True only inside the RARE Android shell, not in a browser tab. */
export function isDeviceBridgeAvailable(): boolean {
  return bridge() !== null;
}

function parse(raw: string | undefined): DeviceResult {
  if (!raw) return { ok: false, error: 'The device bridge returned no response.' };
  try {
    return JSON.parse(raw) as DeviceResult;
  } catch {
    return { ok: false, error: 'The device bridge returned malformed JSON.' };
  }
}

function call(method: keyof RareDeviceBridge, ...args: unknown[]): DeviceResult {
  const api = bridge();
  if (!api) {
    return {
      ok: false,
      error: 'Device control is only available in the RARE Android app, not in a browser tab.',
    };
  }
  try {
    const fn = api[method] as (...a: unknown[]) => string;
    return parse(fn.apply(api, args));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function getDeviceCapabilities(): DeviceCapabilities | null {
  const api = bridge();
  if (!api) return null;
  try {
    return JSON.parse(api.capabilities()) as DeviceCapabilities;
  } catch {
    return null;
  }
}

export const device = {
  requestAccessibility: () => call('requestAccessibility'),
  requestNotificationAccess: () => call('requestNotificationAccess'),
  requestOverlay: () => call('requestOverlay'),
  describeScreen: () => call('describeScreen'),
  listApps: () => call('listApps'),
  notifications: (limit = 20) => call('notifications', limit),
  tapText: (text: string) => call('tapText', text),
  tapId: (viewId: string) => call('tapId', viewId),
  tapAt: (x: number, y: number) => call('tapAt', x, y),
  swipe: (x1: number, y1: number, x2: number, y2: number, durationMs = 300) =>
    call('swipe', x1, y1, x2, y2, durationMs),
  typeText: (text: string) => call('typeText', text),
  scroll: (direction: 'up' | 'down' | 'left' | 'right') => call('scroll', direction),
  globalAction: (name: 'back' | 'home' | 'recents' | 'notifications' | 'quick_settings' | 'lock') =>
    call('globalAction', name),
  openApp: (packageName: string) => call('openApp', packageName),
  showOverlay: (text: string) => call('showOverlay', text),
  hideOverlay: () => call('hideOverlay'),
  startBackgroundService: () => call('startBackgroundService'),
  stopBackgroundService: () => call('stopBackgroundService'),
};
