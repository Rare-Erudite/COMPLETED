#!/usr/bin/env node
/**
 * Live preview verification against a real deployed URL.
 *
 * Drives real Chromium, records console errors and failed network requests,
 * and exercises the API the way the app does (guest session -> authenticated
 * calls). This is deliberately NOT a bundle-string check: it proves the
 * deployed preview can actually talk to its own backend.
 *
 * Usage: node scripts/verify_preview_live.mjs <url>
 */
import { chromium } from 'playwright';

const URL = process.argv[2];
if (!URL) {
  console.error('usage: node scripts/verify_preview_live.mjs <url>');
  process.exit(2);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// Use the Chromium already present in this image rather than downloading a
// second copy; the bundled revision does not always match the installed one.
const CHROME = process.env.CHROME_PATH || '/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();

const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('requestfailed', (r) => {
  const err = r.failure()?.errorText || '';
  // ERR_ABORTED is the client cancelling its own request (unmount, superseded
  // fetch, cold-start retry). Normal on Vercel; recorded but not fatal.
  failedRequests.push({ url: r.url(), err, fatal: !err.includes('ERR_ABORTED') });
});

try {
  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  check('root responds 200', resp?.status() === 200, `status=${resp?.status()}`);

  await page.waitForTimeout(4000);

  const title = await page.title();
  check('app title rendered', /RARE/i.test(title), title);

  const bodyText = await page.evaluate(() => document.body.innerText);
  check('app shell has real content', bodyText.length > 200, `${bodyText.length} chars`);

  const buttons = await page.locator('button').count();
  check('interactive controls present', buttons > 10, `${buttons} buttons`);

  // The decisive test: can the deployed preview create a session against its
  // own backend? Before the origin fix this returned 403 and the app was dead.
  const session = await page.evaluate(async () => {
    const r = await fetch('/api/user/guest-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}',
    });
    return { status: r.status, body: await r.text() };
  });
  check('preview can create a guest session', session.status === 200, `status=${session.status}`);

  const health = await page.evaluate(async () => {
    const r = await fetch('/api/health');
    return { status: r.status, body: await r.json().catch(() => ({})) };
  });
  check('health endpoint healthy', health.status === 200 && health.body?.status === 'healthy',
    `commit=${String(health.body?.commit_sha || '').slice(0, 9)}`);

  const convs = await page.evaluate(async () => {
    const r = await fetch('/api/conversations', { credentials: 'include' });
    return r.status;
  });
  check('authenticated API reachable', convs === 200, `status=${convs}`);

  // SPA deep link must serve the shell, not a 404.
  const deep = await page.goto(`${URL}/settings`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  check('SPA deep link serves shell', deep?.status() === 200, `status=${deep?.status()}`);

  const fatal = failedRequests.filter((r) => r.fatal);
  check('no fatal network failures', fatal.length === 0, `${fatal.length} fatal, ${failedRequests.length - fatal.length} aborted`);

  const realConsoleErrors = consoleErrors.filter((e) => !/ERR_ABORTED|Failed to fetch|net::/i.test(e));
  check('no unexpected console errors', realConsoleErrors.length === 0, `${realConsoleErrors.length}`);
  if (realConsoleErrors.length) {
    for (const e of realConsoleErrors) console.log(`        console: ${e.slice(0, 300)}`);
  }

  await page.screenshot({ path: '/tmp/preview-live.png', fullPage: false });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
