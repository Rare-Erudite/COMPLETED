#!/usr/bin/env node
import { chromium } from 'playwright';
const URL = process.argv[2];
const OUT = process.argv[3];
const CHROME = process.env.CHROME_PATH || '/root/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: OUT, fullPage: false });
console.log('saved', OUT);
await browser.close();