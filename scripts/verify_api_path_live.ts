/**
 * Live verification through the REAL conversation API path.
 *
 * Proves the selected mode reaches the live Gemini provider via
 * POST /api/conversations/:id/messages — not just a direct provider call —
 * and that a mode switch on an existing conversation takes effect on the
 * next message.
 *
 * Handles the app's real CSRF scheme: the token is an HMAC of the session
 * cookie, sent both as a cookie and an X-CSRF-Token header.
 */
import crypto from 'node:crypto';

const BASE = process.env.BASE || 'http://localhost:3000';
const PROMPT = 'I need to add offline support to a React web app. How should I approach it?';

const jar: Record<string, string> = {};

function absorbCookies(res: Response) {
  const raw = (res.headers as any).getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}

function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function csrfToken() {
  const session = jar['rare_session'];
  if (!session) return '';
  return crypto.createHmac('sha256', session).update('rare-csrf-v1').digest('base64url');
}

async function call(path: string, init: RequestInit = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: BASE,
    ...(cookieHeader() ? { cookie: cookieHeader() } : {}),
    ...((init.headers as any) || {}),
  };
  if (method !== 'GET' && method !== 'HEAD') {
    const t = csrfToken();
    if (t) headers['x-csrf-token'] = t;
  }
  const res = await fetch(BASE + path, { ...init, headers });
  absorbCookies(res);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

async function main() {
  console.log('=== 1. GUEST SESSION ===');
  const sess = await call('/api/user/guest-session', { method: 'POST', body: '{}' });
  console.log('status:', sess.status, 'cookies:', Object.keys(jar).join(','));

  console.log('\n=== 2. CREATE CONVERSATION (persona=professional) ===');
  const created = await call('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ persona: 'professional' }),
  });
  const convId = created.json?.id;
  console.log('status:', created.status, 'convId:', convId);
  console.log('stored persona:', created.json?.persona);
  if (!convId) { console.log('RAW:', created.text.slice(0, 400)); return; }

  console.log('\n=== 3. SEND MESSAGE (no persona in body -> must use conversation persona) ===');
  const msg1 = await call(`/api/conversations/${convId}`, {
    method: 'POST',
    body: JSON.stringify({ message: PROMPT }),
  });
  const reply1 = msg1.json?.assistant_message?.content || msg1.json?.reply?.content || '';
  console.log('status:', msg1.status, 'reply chars:', reply1.length);
  console.log('--- REPLY (professional, via conversation default) ---');
  console.log(reply1.slice(0, 1500));

  console.log('\n=== 4. SWITCH MODE ON EXISTING CONVERSATION -> concise ===');
  const patched = await call(`/api/conversations/${convId}/persona`, {
    method: 'PATCH',
    body: JSON.stringify({ persona: 'concise' }),
  });
  console.log('status:', patched.status, JSON.stringify(patched.json));

  console.log('\n=== 5. SEND SAME PROMPT AGAIN (must now be concise) ===');
  const msg2 = await call(`/api/conversations/${convId}`, {
    method: 'POST',
    body: JSON.stringify({ message: PROMPT }),
  });
  const reply2 = msg2.json?.assistant_message?.content || msg2.json?.reply?.content || '';
  console.log('status:', msg2.status, 'reply chars:', reply2.length);
  console.log('--- REPLY (concise, after switch) ---');
  console.log(reply2.slice(0, 1500));

  console.log('\n=== 6. READ BACK CONVERSATION ===');
  const read = await call(`/api/conversations/${convId}`);
  console.log('status:', read.status, 'persona:', read.json?.persona);

  console.log('\n=== SUMMARY ===');
  console.log('professional reply chars:', reply1.length);
  console.log('concise reply chars     :', reply2.length);
  console.log('concise shorter?        :', reply2.length > 0 && reply2.length < reply1.length);
  console.log('persona persisted       :', read.json?.persona);

  const fs = await import('node:fs');
  fs.writeFileSync('gemini_api_path_results.json', JSON.stringify({
    convId, professional: reply1, concise: reply2,
    persistedPersona: read.json?.persona,
  }, null, 2));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
