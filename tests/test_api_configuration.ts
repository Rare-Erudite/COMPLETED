import assert from 'node:assert/strict';
import {
  getBackendUrl,
  normalizeBackendUrl,
  resolveApiUrl,
  setBackendUrl,
  testBackendConnection,
} from '../src/api.js';

export async function runApiConfigurationTests() {
  console.log('--- Testing backend URL configuration and health checks ---');

  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
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
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      delete (globalThis as any).window;
    }
  }

  console.log('✓ Backend URL configuration and health-check tests passed.');
}
