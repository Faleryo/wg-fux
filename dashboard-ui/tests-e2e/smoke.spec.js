import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');
  // Attendre que l'application soit chargée
  await expect(page).toHaveTitle(/WG Shield|WG-FUX/i);
});

test('login page has login button', async ({ page }) => {
  await page.goto('/');
  const loginButton = page.getByRole('button', { name: /Se connecter|Login/i });
  await expect(loginButton).toBeVisible();
});
