/**
 * Run the same prompt through all four modes via the LIVE production
 * conversation API, capturing the actual returned text for each.
 */
import crypto from 'node:crypto';

const BASE = process.env.BASE || 'https://rareproject.vercel.app';
const PROMPT = 'I need to add offline support to a React web app. How should I approach it?';
const MODES = ['casual', 'professional', 'creative', 'concise'];

const jar: Record<string, string> = {};
function absorb(res: Response) {
  for (const c of ((res.headers as any).getSetCookie?.() ?? [])) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const csrf = () => crypto.createHmac('sha256', jar['rare_session'] || '').update('rare-csrf-v1').digest('base64url');

async function call(path: string, init: RequestInit = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    'content-type': 'application/json', origin: BASE,
    ...(cookieHeader() ? { cookie: cookieHeader() } : {}),
  };
  if (method !== 'GET' && method !== 'HEAD') headers['x-csrf-token'] = csrf();
  const res = await fetch(BASE + path, { ...init, headers });
  absorb(res);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function main() {
  await call('/api/user/guest-session', { method: 'POST', body: '{}' });
  const out: Record<string, any> = {};

  for (const mode of MODES) {
    const created = await call('/api/conversations', { method: 'POST', body: JSON.stringify({ persona: mode }) });
    const id = created.json?.id;
    const t0 = Date.now();
    const msg = await call(`/api/conversations/${id}`, { method: 'POST', body: JSON.stringify({ message: PROMPT }) });
    const reply = msg.json?.assistant_message?.content || '';
    const ms = Date.now() - t0;
    const sentences = reply ? reply.split(/(?<=[.!?])\s+/).filter(Boolean).length : 0;
    out[mode] = { chars: reply.length, sentences, ms, reply };
    console.log(`\n########## ${mode.toUpperCase()} ##########`);
    console.log(`chars=${reply.length} sentences=${sentences} ms=${ms}`);
    console.log(reply);
  }

  console.log('\n\n=== SUMMARY (live production) ===');
  for (const m of MODES) {
    console.log(`${m.padEnd(13)} chars=${String(out[m].chars).padStart(5)} sentences=${String(out[m].sentences).padStart(3)} ms=${out[m].ms}`);
  }
  const fs = await import('node:fs');
  fs.writeFileSync('gemini_prod_modes.json', JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
