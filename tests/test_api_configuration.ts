import assert from 'node:assert/strict';
import {
  getBackendUrl,
  normalizeBackendUrl,
  apiFetch,
  resolveApiUrl,
  safeFetch,
  safePost,
  setBackendUrl,
  storeUserSessionToken,
  testBackendConnection,
} from '../src/api.js';

export async function runApiConfigurationTests() {
  console.log('--- Testing backend URL configuration and health checks ---');

  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalFetch = globalThis.fetch;
  const stored = new Map<string, string>();
  const fakeWindow: any = {
    location: {
      hostname: 'rare.example',
      protocol: 'https:',
      origin: 'https://rare.example',
    },
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  };

  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeWindow.localStorage });

  try {
    assert.equal(getBackendUrl(), 'https://rare.example', 'Web client defaults to its current origin');
    assert.equal(normalizeBackendUrl(' https://api.rare.example/base/// '), 'https://api.rare.example/base');
    assert.equal(resolveApiUrl('/api/health'), 'https://rare.example/api/health');

    setBackendUrl('https://api.rare.example///');
    assert.equal(stored.get('rare_backend_url'), 'https://api.rare.example');
    assert.equal(getBackendUrl(), 'https://api.rare.example', 'Manual endpoint is restored from local storage');
    assert.throws(() => setBackendUrl('not a URL'), /complete backend URL/i);
    assert.throws(() => normalizeBackendUrl('http://api.rare.example'), /Use HTTPS/i);
    assert.equal(getBackendUrl(), 'https://api.rare.example', 'Rejected values do not overwrite a valid saved URL');

    fakeWindow.location.hostname = 'rare.local';
    fakeWindow.location.origin = 'https://rare.local';
    setBackendUrl('');
    assert.equal(getBackendUrl(), '', 'Android virtual asset origin is not mistaken for an API server');
    assert.throws(() => normalizeBackendUrl('http://localhost:5000'), /Android must use the public backend/i);
    fakeWindow.__RARE_BACKEND_URL__ = 'https://api.rare.example/';
    assert.equal(getBackendUrl(), 'https://api.rare.example', 'Android accepts an explicit build-time backend URL');
    delete fakeWindow.__RARE_BACKEND_URL__;

    fakeWindow.location.hostname = 'rare.local';
    fakeWindow.location.origin = 'https://rare.local';
    fakeWindow.__IS_RARE_APK__ = true;
    fakeWindow.__RARE_BACKEND_URL__ = 'https://api.rare.example';
    stored.delete('rare_backend_url');
    assert.equal(getBackendUrl(), 'https://api.rare.example');
    const standaloneUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      standaloneUrls.push(String(input));
      return new Response(JSON.stringify({ online: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    assert.deepEqual(await safeFetch('/api/health'), { online: true });
    assert.equal(standaloneUrls[0], 'https://api.rare.example/api/health');
    globalThis.fetch = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    assert.equal(await safeFetch('/api/health'), null, 'Configured backend failures must not produce the local mock response');

    delete fakeWindow.__RARE_BACKEND_URL__;
    globalThis.fetch = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    assert.equal(getBackendUrl(), '', 'Standalone mode stays unconfigured when no service URL is supplied');
    assert.equal((await safeFetch<any>('/api/health'))?.name, 'RARE Standalone Intelligence Core', 'Unconfigured standalone mode keeps its offline route');
    fakeWindow.__IS_RARE_APK__ = false;
    fakeWindow.location.hostname = 'rare.example';
    fakeWindow.location.origin = 'https://rare.example';

    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({
        ok: true,
        name: 'RARE Server',
        status: 'healthy',
        timestamp: new Date().toISOString(),
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const healthy = await testBackendConnection('https://api.rare.example/');
    assert.equal(healthy.success, true, 'Connection check accepts a valid real health response');
    assert.equal(healthy.httpStatus, 200);
    assert.ok(Number.isFinite(healthy.latencyMs), 'Connection result includes measured latency');
    assert.match(requestedUrls[0], /\/api\/health$/);

    globalThis.fetch = (async () => new Response('<html>not an API</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as typeof fetch;
    const htmlResponse = await testBackendConnection('https://api.rare.example');
    assert.equal(htmlResponse.success, false, 'HTML is not accepted as a healthy API response');
    assert.match(htmlResponse.message, /did not return JSON/i);

    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
    const unavailable = await testBackendConnection('https://api.rare.example');
    assert.equal(unavailable.success, false);
    assert.equal(unavailable.httpStatus, 503);

    globalThis.fetch = (async () => {
      throw new TypeError('network unavailable');
    }) as typeof fetch;
    const unreachable = await testBackendConnection('https://api.rare.example');
    assert.equal(unreachable.success, false);
    assert.match(unreachable.message, /Could not reach the backend/i);
    globalThis.fetch = (async () => { throw new TypeError('network unavailable'); }) as typeof fetch;
    assert.equal(await safeFetch('/api/schedules'), null, 'Web requests must not be replaced by local mock schedule data when the backend is offline');

    fakeWindow.location.hostname = 'rare.example';
    fakeWindow.location.origin = 'https://rare.example';
    setBackendUrl('');
    storeUserSessionToken();
    let capturedOptions: RequestInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
      capturedOptions = options;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-csrf-token': 'signed-csrf-token' },
      });
    }) as typeof fetch;
    await apiFetch('/api/user/me');
    await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify({ theme: 'blue' }) });
    assert.equal(capturedOptions?.credentials, 'include', 'Browser API requests must send the HttpOnly session cookie');
    assert.equal(new Headers(capturedOptions?.headers).get('X-CSRF-Token'), 'signed-csrf-token', 'Unsafe API requests must send the CSRF token received from the server');

    let fetchSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
      fetchSignal = options?.signal as AbortSignal;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 45);
        fetchSignal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
      return new Response(JSON.stringify({ waited: true }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    assert.deepEqual(await safeFetch('/api/health', undefined, undefined, 0, 100), { waited: true });
    assert.equal(fetchSignal?.aborted, false, 'A custom timeout longer than the request is honored');
    await safePost('/api/health', {}, undefined, 20);
    assert.equal(fetchSignal?.aborted, true, 'safePost forwards its custom timeout to safeFetch');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      delete (globalThis as any).window;
    }
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
    } else {
      delete (globalThis as any).localStorage;
    }
  }

  console.log('✓ Backend URL configuration and health-check tests passed.');
}
