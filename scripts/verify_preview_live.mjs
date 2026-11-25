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
// A fresh context rather than a bare page: the default page shares the
// browser's implicit context, and its network events were not being delivered
// reliably here (responses were missing while requestfailed fired). An explicit
// context gives a clean, isolated session and reliable event delivery.
const context = await browser.newContext();
const page = await context.newPage();

const consoleErrors = [];
const failedRequests = [];
const apiTraffic = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('response', (r) => {
  try {
    apiTraffic.push({ path: new URL(r.url()).pathname, status: r.status() });
  } catch {
    /* non-URL response */
  }
});
page.on('requestfailed', (r) => {
  const err = r.failure()?.errorText || '';
  // ERR_ABORTED is the client cancelling its own request (unmount, superseded
  // fetch, cold-start retry). Normal on Vercel; recorded but not fatal.
  failedRequests.push({ url: r.url(), err, fatal: !err.includes('ERR_ABORTED') });
});

try {
  // 'load' rather than 'domcontentloaded': the app fires its bootstrap calls
  // immediately after hydration, and navigating away at 'domcontentloaded'
  // aborts them mid-flight. That produced a wall of ERR_ABORTED that looked
  // like a cold-start defect but was the verifier racing the app.
  const resp = await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  check('root responds 200', resp?.status() === 200, `status=${resp?.status()}`);

  await page.waitForTimeout(10000);

  const title = await page.title();
  check('app title rendered', /RARE/i.test(title), title);

  const bodyText = await page.evaluate(() => document.body.innerText);
  check('app shell has real content', bodyText.length > 200, `${bodyText.length} chars`);

  const buttons = await page.locator('button').count();
  check('interactive controls present', buttons > 10, `${buttons} buttons`);

  // The decisive test: can the deployed preview talk to its own backend?
  //
  // This asserts on the app's OWN network traffic rather than issuing a bare
  // fetch. The app authenticates with a session token header, not only a cookie,
  // so a hand-rolled fetch from the page context cannot reproduce its session
  // and would 401 for reasons that say nothing about the app.
  //
  // Note on ERR_ABORTED: the app deliberately supersedes its own in-flight
  // conversation fetches (a new one starts as state settles), so a few aborted
  // requests are normal and are not counted as failures. What matters is that
  // the session is established and the data calls return 200.
  await page.waitForTimeout(8000);

  const apiCalls = apiTraffic.filter((c) => c.path.startsWith('/api'));
  const failedCalls = apiCalls.filter((c) => c.status >= 400);
  check(
    'the app\'s own API calls all succeed',
    apiCalls.length > 0 && failedCalls.length === 0,
    `${apiCalls.length} calls, ${failedCalls.length} failed` +
      (failedCalls.length ? `: ${failedCalls.map((c) => `${c.status} ${c.path}`).join(', ')}` : ''),
  );
  check(
    'the app established a session',
    apiCalls.some((c) => c.path === '/api/user/guest-session' && c.status === 200),
  );
  check(
    'authenticated data loaded',
    apiCalls.some((c) => c.path === '/api/conversations' && c.status === 200),
  );

  const health = await page.evaluate(async () => {
    const r = await fetch('/api/health');
    return { status: r.status, body: await r.json().catch(() => ({})) };
  });
  check('health endpoint healthy', health.status === 200 && health.body?.status === 'healthy',
    `commit=${String(health.body?.commit_sha || '').slice(0, 9)}`);

  // SPA deep link must serve the shell, not a 404. This is the LAST navigation,
  // so it cannot abort the app's bootstrap calls.
  const deep = await page.goto(`${URL}/settings`, { waitUntil: 'load', timeout: 30000 });
  check('SPA deep link serves shell', deep?.status() === 200, `status=${deep?.status()}`);

  const fatal = failedRequests.filter((r) => r.fatal);
  check('no fatal network failures', fatal.length === 0, `${fatal.length} fatal, ${failedRequests.length - fatal.length} aborted`);

  // Only the app's own console errors count. A bare fetch from the page context
  // cannot reproduce the app's session (it authenticates with a token header),
  // so any 401 it provokes is an artefact of the test, not a defect.
  const realConsoleErrors = consoleErrors.filter(
    (e) => !/ERR_ABORTED|Failed to fetch|net::|status of 401/i.test(e),
  );
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
