import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const targetUrl = 'http://10.0.2.2:3000';
let browser;
try {
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 45_000 });
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.getByText('RARE').first().waitFor({ state: 'visible', timeout: 30_000 });
  assert.match(page.url(), /^http:\/\/10\.0\.2\.2:3000\//, 'Android Chrome must stay on the emulator-to-host development URL');
  assert.equal(await page.getByRole('button', { name: /Login \/ Sign Up/i }).isVisible(), true, 'account entry should render in Android Chrome');
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.content <= dimensions.viewport + 1, `Android browser content overflows: ${JSON.stringify(dimensions)}`);
  console.log(`Android Chrome smoke passed at ${dimensions.viewport}px viewport; app rendered from ${targetUrl}.`);
} finally {
  if (browser) await browser.close();
}
