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

// Third and last login of the run: the throttle allows 5 attempts per 15 minutes, the first test
// uses 2, this one 1.
test('the operator edits the example profile and it survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Hasło').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj' }).click();
  await page.getByRole('link', { name: 'Profil' }).click();

  await expect(page.getByRole('heading', { name: /Profil operatora/ })).toBeVisible();
  await expect(page.getByText('PRZYKŁAD', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'context/changes/operator-profile/evidence/profile-360.png' });

  await page.getByLabel('Godziny tygodniowo').fill('35');
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByText('Zapisano', { exact: true })).toBeVisible();
  await expect(page.getByText('PRZYKŁAD', { exact: true })).toBeHidden();

  await page.reload();
  await expect(page.getByLabel('Godziny tygodniowo')).toHaveValue('35');
  await expect(page.getByText('PRZYKŁAD', { exact: true })).toBeHidden();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
