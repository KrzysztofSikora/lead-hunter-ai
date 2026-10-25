import { expect, test } from '@playwright/test';
import { E2E_PASSWORD } from './env.js';

test.use({ viewport: { width: 360, height: 740 } });

test('the operator logs in, keeps the session over a reload and logs out on a phone-width screen', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Lead Hunter AI' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Zaloguj się' })).toBeVisible();
  await expect(page.getByText('Serwer działa')).toBeHidden();
  await page.screenshot({ path: 'context/changes/operator-login/evidence/login-360.png' });

  await page.getByLabel('Hasło').fill('zle-haslo-12345');
  await page.getByRole('button', { name: 'Zaloguj' }).click();
  await expect(page.getByRole('alert')).toHaveText('Nieprawidłowe hasło.');

  await page.getByLabel('Hasło').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj' }).click();
  await expect(page.getByText('Serwer działa')).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'context/changes/operator-login/evidence/shell-360.png' });

  await page.reload();
  await expect(page.getByText('Serwer działa')).toBeVisible();

  await page.getByRole('button', { name: 'Wyloguj' }).click();
  await expect(page.getByRole('heading', { name: 'Zaloguj się' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Zaloguj się' })).toBeVisible();
});

test('health answers over HTTP', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect((await response.json()).status).toBe('ok');
});
