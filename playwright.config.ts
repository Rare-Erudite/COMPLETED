import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const port = Number(process.env.RARE_E2E_PORT || 4179);
const baseURL = `http://127.0.0.1:${port}`;
const systemChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chromePath = process.env.PLAYWRIGHT_CHROME_PATH || (process.platform === 'win32' && existsSync(systemChrome) ? systemChrome : undefined);
const requestedEngines = new Set((process.env.RARE_E2E_ENGINES || 'chromium').split(',').map((engine) => engine.trim()));
const projects = [];
if (requestedEngines.has('chromium')) {
  projects.push(
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], browserName: 'chromium' as const, launchOptions: chromePath ? { executablePath: chromePath } : {} } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium', launchOptions: chromePath ? { executablePath: chromePath } : {} } },
  );
}
if (requestedEngines.has('firefox')) projects.push({ name: 'desktop-firefox', use: { browserName: 'firefox' as const } });
if (requestedEngines.has('webkit')) projects.push({ name: 'desktop-webkit', use: { browserName: 'webkit' as const } });

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects,
  webServer: {
    command: `npm run dev`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      RARE_APP_ROOT: process.env.RARE_E2E_DATA_ROOT || process.cwd(),
      RARE_ALLOW_LOCAL_STORAGE_FALLBACK: 'true',
      RARE_ALLOWED_ORIGINS: baseURL,
    },
  },
});
