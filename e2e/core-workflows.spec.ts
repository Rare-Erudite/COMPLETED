import { expect, test } from '@playwright/test';

test('local account registration persists through reload and opens core workspaces', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chrome', 'Account and workspace journey is covered on desktop; mobile gets a viewport-specific smoke test.');
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `e2e-${suffix}@example.test`;

  await page.goto('/');
  await expect(page.getByText('RARE').first()).toBeVisible();
  await page.getByRole('button', { name: /Login \/ Sign Up/i }).click();
  await page.getByRole('button', { name: 'Create Account' }).click();
  await page.getByPlaceholder('Enter your name...').fill('Browser Test User');
  await page.getByPlaceholder('you@example.com or any email').fill(email);
  await page.getByPlaceholder('Enter your password...').fill('LocalOnly-Test-Pass-839!');
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();

  await expect(page.getByText('Browser Test User').first()).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByText('Browser Test User').first()).toBeVisible({ timeout: 15_000 });

  for (const workspace of ['Assistant', 'Documents', 'Research', 'Projects']) {
    const navButton = page.locator('aside').getByRole('button').filter({ hasText: workspace }).first();
    await navButton.click();
    await expect(navButton).toBeVisible();
  }

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Preferences & Settings')).toBeVisible();
});

test('mobile layout keeps the app within the viewport and exposes the account entry point', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('RARE').first()).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  await expect(page.getByRole('button', { name: /Login \/ Sign Up/i })).toBeVisible();
});
