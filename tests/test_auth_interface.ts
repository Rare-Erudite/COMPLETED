/**
 * Authentication interface tests.
 *
 * Covers the avatar-initials derivation (the reported defect: name was
 * prioritised over email) and the live auth lifecycle against a real server:
 * guest state, sign-up, sign-in, session restoration, and expiry.
 */

import assert from 'node:assert/strict';
import { getUserInitials } from '../src/AuthModal.js';

const BASE = process.env.RARE_TEST_BASE_URL || 'http://127.0.0.1:3000';

export async function runAuthInterfaceTests(): Promise<{ passed: number; failed: number }> {
  // Read the base URL at call time, not at import time. The runner boots the
  // server on a free port and only then exports RARE_TEST_BASE_URL, so a
  // module-level capture would always fall back to :3000 and every request
  // would fail with ECONNREFUSED.
  const base = process.env.RARE_TEST_BASE_URL || BASE;
  let passed = 0;
  let failed = 0;

  const check = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      passed++;
      console.log(`  PASS  ${name}`);
    } catch (error) {
      failed++;
      console.error(`  FAIL  ${name}`);
      console.error(`        ${(error as Error).message}`);
    }
  };

  console.log('\n[Authentication Interface]');

  // --- Avatar initials -----------------------------------------------------
  await check('initials come from a simple email', () => {
    assert.equal(getUserInitials({ email: 'daniel@example.com' }), 'DA');
  });

  await check('initials split a dotted email username', () => {
    assert.equal(getUserInitials({ email: 'daniel.james@example.com' }), 'DJ');
  });

  await check('initials split an underscored email username', () => {
    assert.equal(getUserInitials({ email: 'john_smith@example.com' }), 'JS');
  });

  await check('initials split a hyphenated email username', () => {
    // Hyphen is a separator like dot and underscore, so the first two parts
    // are "mary" and "ann".
    assert.equal(getUserInitials({ email: 'mary-ann.lee@example.com' }), 'MA');
  });

  await check('email wins over a display name', () => {
    // The reported defect: a display name used to shadow the email.
    assert.equal(
      getUserInitials({ name: 'Zed Quux', email: 'daniel.james@example.com' }),
      'DJ',
      'email must take priority over the display name'
    );
  });

  await check('initials are uppercase', () => {
    assert.equal(getUserInitials({ email: 'daniel@example.com' }), 'DA');
    assert.equal(getUserInitials({ email: 'DANIEL@example.com' }), 'DA');
  });

  await check('phone is used when no email exists', () => {
    const initials = getUserInitials({ phone: '+234 801 234 5678' });
    assert.ok(initials.length > 0, 'phone fallback produced nothing');
    assert.notEqual(initials, 'U', 'phone fallback must not be the generic marker');
  });

  await check('display name is used when no email or phone exists', () => {
    assert.equal(getUserInitials({ name: 'Ada Lovelace' }), 'AL');
  });

  await check('generic fallback for an empty account', () => {
    assert.equal(getUserInitials({}), 'U');
    assert.equal(getUserInitials(null), 'U');
  });

  await check('single-word email username yields two letters', () => {
    assert.equal(getUserInitials({ email: 'daniel@example.com' }), 'DA');
  });

  // --- Live auth lifecycle -------------------------------------------------
  // Mirrors the real client: cookie jar, Origin header, and the CSRF token the
  // server issues on the guest-session bootstrap.
  const jar = new Map<string, string>();
  let csrf = '';
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  const request = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers || {});
    if (jar.size) headers.set('Cookie', cookieHeader());
    headers.set('Origin', base);
    if (csrf && !['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase())) {
      headers.set('X-CSRF-Token', csrf);
    }
    const res = await fetch(`${base}${path}`, { ...init, headers, redirect: 'manual' });
    const setCookie = res.headers.getSetCookie?.() || [];
    for (const raw of setCookie) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    const headerCsrf = res.headers.get('x-csrf-token');
    if (headerCsrf) csrf = headerCsrf;
    else if (jar.has('rare_csrf')) csrf = decodeURIComponent(jar.get('rare_csrf')!);
    let body: any = null;
    const ct = res.headers.get('content-type') || '';
    if (/json/i.test(ct)) body = await res.json().catch(() => null);
    return { status: res.status, body, headers: res.headers };
  };

  await check('a fresh visitor can obtain a guest session', async () => {
    const res = await request('/api/user/guest-session', { method: 'POST' });
    assert.equal(res.status, 200, `guest-session returned ${res.status}`);
    assert.ok(csrf, 'the guest session must issue a CSRF token');
  });

  await check('a guest session is not reported as a signed-in account', async () => {
    const res = await request('/api/user/me');
    // A guest has a valid session but no account. The endpoint answers 200 with
    // a null user, or 401 when the guest session carries no account at all —
    // either way it must never report an account.
    assert.ok(res.status === 200 || res.status === 401, `me returned ${res.status}`);
    assert.ok(!res.body?.user?.email, 'a guest must not be reported as a signed-in user');
  });

  const email = `persona.test.${Date.now()}@example.com`;
  const password = 'Str0ng-Passw0rd!2026';

  await check('a guest can sign up and becomes an authenticated user', async () => {
    const res = await request('/api/user/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Persona Tester' }),
    });
    assert.ok(res.status === 200 || res.status === 201, `signup returned ${res.status}`);
    assert.ok(res.body?.user?.id, 'signup did not return a user');
    assert.equal(res.body.user.email, email);
  });

  await check('the session now reports the real account', async () => {
    const res = await request('/api/user/me');
    assert.equal(res.status, 200, `me returned ${res.status}`);
    assert.equal(res.body?.user?.email, email, 'session must report the signed-in account');
  });

  await check('the account initials derive from the signed-in email', async () => {
    const res = await request('/api/user/me');
    const initials = getUserInitials(res.body.user);
    assert.equal(initials, 'PT', `expected PT for ${email}, got ${initials}`);
  });

  await check('signing out returns the session to guest', async () => {
    const res = await request('/api/user/logout', { method: 'POST' });
    assert.ok(res.status === 200 || res.status === 204, `logout returned ${res.status}`);
    const after = await request('/api/user/me');
    assert.ok(!after.body?.user?.email, 'logout must clear the account');
  });

  await check('the same account can sign back in', async () => {
    const res = await request('/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(res.status, 200, `login returned ${res.status}`);
    assert.equal(res.body?.user?.email, email);
  });

  await check('an invalid session is rejected rather than silently accepted', async () => {
    const res = await fetch(`${base}/api/conversations`, {
      headers: { Cookie: 'rare_session=forged-token-value' },
    });
    assert.equal(res.status, 401, `a forged session must be rejected, got ${res.status}`);
  });

  return { passed, failed };
}
