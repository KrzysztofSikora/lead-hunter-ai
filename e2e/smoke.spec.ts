import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 360, height: 740 } });

test('the shell shows the app name and a healthy server on a phone-width screen', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Lead Hunter AI' })).toBeVisible();
  await expect(page.getByText('Serwer działa')).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.screenshot({ path: 'context/changes/repo-skeleton/evidence/shell-360.png' });
});

test('health answers over HTTP', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect((await response.json()).status).toBe('ok');
});
