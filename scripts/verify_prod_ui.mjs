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
// APK link in developer space
const apkLink = await page.evaluate(() => {
  const links = [...document.querySelectorAll('a')].filter(a => /apk|download/i.test(a.textContent||''));
  return links.map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href') }));
});
check('APK download link present', apkLink.length>=1, JSON.stringify(apkLink.slice(0,3)));
check('no console errors', consoleErrors.length===0, consoleErrors.slice(0,3).join(' | '));
console.log(`\n${results.filter(r=>r.ok).length}/${results.length} passed`);
await browser.close();