/**
 * RARE API client. Backend availability is only updated after an HTTP request
 * has produced evidence; a configured URL alone is never treated as connected.
 */

const BACKEND_URL_KEY = 'rare_backend_url';

export interface BackendConnectionState {
  reachable: boolean;
  lastChecked: number;
  lastError?: string;
  configuredUrl: string;
}

export interface BackendHealthTestResult {
  success: boolean;
  message: string;
  httpStatus?: number;
  latencyMs?: number;
  responseDetails?: string;
}

let connectionState: BackendConnectionState = {
  reachable: false,
  lastChecked: 0,
  configuredUrl: '',
};

type ConnectionListener = (state: BackendConnectionState) => void;
const listeners = new Set<ConnectionListener>();

export function subscribeConnectionState(listener: ConnectionListener): () => void {
  listeners.add(listener);
  listener(connectionState);
  return () => listeners.delete(listener);
}

function updateConnectionState(reachable: boolean, error?: string) {
  connectionState = {
    reachable,
    lastChecked: Date.now(),
    lastError: error,
    configuredUrl: getBackendUrl(),
  };
  listeners.forEach((fn) => fn(connectionState));
}

/**
 * Validate and normalize an HTTP(S) backend base URL.
 * Plain HTTP is limited to loopback addresses for local development.
 */
export function normalizeBackendUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter a complete backend URL, including https://.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Backend URLs must use HTTPS (HTTP is allowed only for localhost development).');
  }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Enter a backend URL without credentials, query parameters, or a fragment.');
  }
  if (
    isStandaloneMobileApp() &&
    ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase())
  ) {
    throw new Error('Android must use the public backend URL; localhost and loopback addresses refer to the phone.');
  }
  if (
    parsed.protocol === 'http:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase())
  ) {
    throw new Error('Use HTTPS for remote backends. Plain HTTP is allowed only on localhost.');
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

function getStoredBackendUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(BACKEND_URL_KEY) || '';
  } catch {
    return '';
  }
}

function getConfiguredDefault(): string {
  if (typeof window !== 'undefined') {
    const injected = (window as any).__RARE_BACKEND_URL__;
    if (typeof injected === 'string' && injected.trim()) {
      try {
        return normalizeBackendUrl(injected);
      } catch {
        return injected.trim();
      }
    }
  }

  const envUrl = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_BACKEND_URL : undefined;
  if (typeof envUrl === 'string' && envUrl.trim()) {
    try {
      return normalizeBackendUrl(envUrl);
    } catch {
      return envUrl.trim();
    }
  }

  // The bundled Android WebView uses rare.local as its virtual asset origin.
  // It is not a backend, so never use it as the remote API endpoint.
  if (typeof window !== 'undefined' && !isStandaloneMobileApp()) {
    const origin = window.location?.origin;
    if (origin && origin !== 'null') {
      try {
        return normalizeBackendUrl(origin);
      } catch {
        // Non-HTTP origins (for example file://) do not identify an API host.
      }
    }
  }

  return '';
}

/** The configured manual URL, otherwise the default app origin/build URL. */
export function getBackendUrl(): string {
  const saved = getStoredBackendUrl();
  if (saved.trim()) {
    try {
      return normalizeBackendUrl(saved);
    } catch {
      // Keep legacy invalid values visible in Settings so the user can repair them.
      return saved.trim();
    }
  }
  return getConfiguredDefault();
}

/** Default URL without consulting the manually saved override. */
export function getDefaultBackendUrl(): string {
  return getConfiguredDefault();
}

/** Save a validated override, or clear it to restore the default URL. */
export function setBackendUrl(url: string) {
  const normalized = normalizeBackendUrl(url);
  if (typeof window === 'undefined') return;

  try {
    if (!normalized) {
      window.localStorage.removeItem(BACKEND_URL_KEY);
    } else {
      window.localStorage.setItem(BACKEND_URL_KEY, normalized);
    }
  } catch {
    throw new Error('This browser could not save the backend URL. Check its storage settings and try again.');
  }

  connectionState = {
    reachable: false,
    lastChecked: 0,
    configuredUrl: getBackendUrl(),
  };
  listeners.forEach((fn) => fn(connectionState));
}

export function isStandaloneMobileApp(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.hostname === 'rare.local' ||
    window.location.protocol === 'file:' ||
    (window as any).__IS_RARE_APK__ === true
  );
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = getBackendUrl();
  if (!base) return path;
  const normalizedBase = normalizeBackendUrl(base);
  return `${normalizedBase}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Call the real health route and validate the response instead of trusting a URL. */
export async function testBackendConnection(url: string): Promise<BackendHealthTestResult> {
  let target: string;
  try {
    target = normalizeBackendUrl(url);
  } catch (err: any) {
    const message = err?.message || 'Invalid backend URL.';
    updateConnectionState(false, message);
    return { success: false, message };
  }
  if (!target) {
    const message = 'No backend URL is configured. Set one or reset to the default.';
    updateConnectionState(false, message);
    return { success: false, message };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${target}/api/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const contentType = response.headers.get('content-type') || '';
    const base = {
      httpStatus: response.status,
      latencyMs,
    };

    if (!response.ok) {
      const message = `Backend returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`;
      updateConnectionState(true, message);
      return { ...base, success: false, message };
    }
    if (!/\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) {
      const message = `Backend responded with HTTP ${response.status}, but the health route did not return JSON.`;
      updateConnectionState(true, message);
      return { ...base, success: false, message };
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      const message = 'Backend returned invalid JSON from its health route.';
      updateConnectionState(true, message);
      return { ...base, success: false, message };
    }

    const timestamp = typeof data?.timestamp === 'string' ? Date.parse(data.timestamp) : Number.NaN;
    if (data?.ok !== true || data?.status !== 'healthy' || !Number.isFinite(timestamp)) {
      const message = 'Backend health response is missing a valid healthy status or timestamp.';
      updateConnectionState(true, message);
      return { ...base, success: false, message };
    }

    updateConnectionState(true);
    return {
      ...base,
      success: true,
      message: `${data.name || 'RARE backend'} is healthy.`,
      responseDetails: `HTTP ${response.status} · Latency: ${latencyMs} ms · Status: ${data.status} · Checked: ${new Date(timestamp).toLocaleString()}`,
    };
  } catch (err: any) {
    const message = err?.name === 'AbortError'
      ? 'Backend health check timed out after 8 seconds.'
      : `Could not reach the backend: ${err?.message || 'network request failed'}.`;
    updateConnectionState(false, message);
    return { success: false, message, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function safeFetch<T>(
  url: string,
  options?: RequestInit,
  fallback?: T,
  retries = 1
): Promise<T | null> {
  if (isStandaloneMobileApp() && !getBackendUrl()) {
    updateConnectionState(false, 'No backend URL is configured; this Android app is in offline mode.');
    return fallback !== undefined ? fallback : null;
  }

  for (let i = 0; i <= retries; i++) {
    try {
      const fullUrl = resolveApiUrl(url);
      const res = await fetch(fullUrl, options);
      const contentType = res.headers.get('content-type') || '';

      // Any HTTP response proves that the host is reachable, even if this
      // particular API request failed or returned an unexpected body.
      if (!res.ok) {
        updateConnectionState(true, `HTTP ${res.status}: ${res.statusText || 'request failed'}`);
        return fallback !== undefined ? fallback : null;
      }
      if (!/\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) {
        updateConnectionState(true, 'Server responded, but the API response was not JSON.');
        return fallback !== undefined ? fallback : null;
      }

      try {
        const data = (await res.json()) as T;
        updateConnectionState(true);
        return data;
      } catch {
        updateConnectionState(true, 'Server responded with invalid JSON.');
        return fallback !== undefined ? fallback : null;
      }
    } catch (err: any) {
      if (i === retries) {
        updateConnectionState(false, err?.message || 'Network unreachable');
      } else {
        await new Promise((resolve) => setTimeout(resolve, 300 * (i + 1)));
      }
    }
  }

  return fallback !== undefined ? fallback : null;
}

export async function safePost<T>(
  url: string,
  body?: any,
  fallback?: T
): Promise<T | null> {
  return safeFetch<T>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    },
    fallback,
    1
  );
}
