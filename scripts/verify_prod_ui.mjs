#!/usr/bin/env node
// Targeted production UI verification: guest state, mode selector, APK link.
import { chromium } from 'playwright';
const URL = process.argv[2];
if (!URL) { console.error('usage: node scripts/verify_prod_ui.mjs <url>'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/root/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const context = await browser.newContext();
const page = await context.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type()==='error') consoleErrors.push(m.text()); });
const results = [];
function check(name, ok, detail=''){ results.push({name,ok}); console.log(`  ${ok?'PASS':'FAIL'}  ${name}${detail?` — ${detail}`:''}`); }
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);
const body = await page.evaluate(() => document.body.innerText);
const html = await page.content();
// Guest state
check('Login / Sign Up control present', /log\s*\/\s*sign\s*up|sign\s*in/i.test(body), 'guest sees it');
check('Guest Account shown', /guest\s*account/i.test(body));
check('Click to Sign In shown', /click\s*to\s*sign\s*in/i.test(body));
// Mode selector
const modeNames = ['casual','professional','creative','concise'];
const modeFound = modeNames.filter(m => new RegExp(m,'i').test(body));
check('four conversation modes present', modeFound.length>=4, modeFound.join(','));
// APK link lives in Developer Space, which is gated behind developer auth.
// A guest must therefore NOT see it. Asserting its presence for a guest was
// wrong: it reported the correct gating as a failure. Assert the gate instead,
// and assert the endpoint itself refuses an unauthenticated request.
const apkLink = await page.evaluate(() => {
  const links = [...document.querySelectorAll('a')].filter(a => /apk|download/i.test(a.textContent||''));
  return links.map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href') }));
});
check('APK link hidden from guest (developer-gated)', apkLink.length === 0, JSON.stringify(apkLink.slice(0,3)));
const apkStatus = await page.evaluate(async () => {
  const r = await fetch('/api/download/apk/info', { credentials: 'include' });
  return r.status;
});
check('APK endpoint refuses unauthenticated request', apkStatus === 401 || apkStatus === 403, `status ${apkStatus}`);
// The deliberate 403 probe above logs a resource error of its own; exclude it so
// this assertion measures the app, not the test.
const appErrors = consoleErrors.filter(e => !/status of 403/.test(e));
check('no console errors', appErrors.length===0, appErrors.slice(0,3).join(' | '));
console.log(`\n${results.filter(r=>r.ok).length}/${results.length} passed`);
await browser.close();