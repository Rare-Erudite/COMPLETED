#!/usr/bin/env node
/**
 * RARE — simulated Android device.
 *
 * Stands in for the phone's poll loop so the device channel can be exercised
 * without hardware. It performs exactly what the real app does:
 *   POST /api/device/poll   -> receive queued commands
 *   POST /api/device/result -> post the outcome
 *
 * It tracks the rotating CSRF token the server hands back, which is what the
 * real client must do too.
 *
 * Usage: node scripts/simulate-android-device.mjs <baseUrl> <cookie> <csrf> [seconds]
 */

const BASE = (process.argv[2] || 'http://localhost:5099').replace(/\/$/, '');
const COOKIE = process.argv[3] || '';
const INITIAL_CSRF = process.argv[4] || '';
const DURATION_S = Number(process.argv[5] || 60);

let csrf = INITIAL_CSRF;
let polls = 0;
let executed = 0;

const NOTIFICATIONS = [
  { package: 'com.whatsapp', title: 'Ada', text: 'Are we still on for 3pm?', postedAt: 1000 },
  { package: 'com.whatsapp', title: 'Team', text: 'Deploy finished', postedAt: 1001 },
  { package: 'com.android.systemui', title: 'Battery', text: '20%', postedAt: 1002 },
];

function respond(action) {
  switch (action) {
    case 'notifications':
      return { ok: true, data: { notifications: NOTIFICATIONS } };
    case 'describe_screen':
      return {
        ok: true,
        data: {
          package: 'com.whatsapp',
          nodes: [
            { text: 'Send', viewId: 'com.whatsapp:id/send', clickable: true, bounds: '900,1800,1050,1900' },
            { text: 'Message', viewId: 'com.whatsapp:id/entry', clickable: true, bounds: '60,1800,880,1900' },
          ],
        },
      };
    case 'list_apps':
      return { ok: true, data: { apps: [{ package: 'com.whatsapp', label: 'WhatsApp' }, { package: 'com.android.settings', label: 'Settings' }] } };
    default:
      return { ok: true, message: `${action} executed on device` };
  }
}

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE,
      'X-CSRF-Token': csrf,
      Cookie: COOKIE,
    },
    body: JSON.stringify(body),
  });
  const rotated = response.headers.get('x-csrf-token');
  if (rotated) csrf = rotated;
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

const deadline = Date.now() + DURATION_S * 1000;
while (Date.now() < deadline) {
  try {
    const poll = await post('/api/device/poll', {
      platform: 'android', sdk: 33, accessibility: true, notifications: true,
    });
    polls += 1;
    for (const command of poll.commands || []) {
      const result = respond(command.action);
      const posted = await post('/api/device/result', {
        commandId: command.id, ok: true, result,
      });
      if (posted.success) executed += 1;
      else console.error('[sim] result rejected:', JSON.stringify(posted).slice(0, 200));
    }
  } catch (error) {
    console.error('[sim] poll error:', error.message);
  }
  await new Promise((r) => setTimeout(r, 300));
}

console.error(`[sim] done — polls=${polls} executed=${executed}`);
