import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const port = Number(process.env.RARE_E2E_PORT || 4179);
const baseURL = `http://127.0.0.1:${port}`;
const systemChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chromePath = process.env.PLAYWRIGHT_CHROME_PATH || (process.platform === 'win32' && existsSync(systemChrome) ? systemChrome : undefined);

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
    launchOptions: chromePath ? { executablePath: chromePath } : {},
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } },
  ],
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
