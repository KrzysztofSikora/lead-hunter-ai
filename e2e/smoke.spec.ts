import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD } from './env.js';

test.use({ viewport: { width: 360, height: 740 } });

// Evidence screenshots are written only on request (`E2E_EVIDENCE=1 pnpm e2e`), so a plain
// gate run never rewrites committed evidence of other changes.
async function evidence(page: Page, options: { path: string; fullPage?: boolean }) {
  if (process.env.E2E_EVIDENCE === '1') await page.screenshot(options);
}

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('the operator logs in, keeps the session over a reload and logs out on a phone-width screen', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Lead Hunter AI' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Zaloguj się' })).toBeVisible();
  await expect(page.getByText('Serwer działa')).toBeHidden();
  await evidence(page, { path: 'context/changes/operator-login/evidence/login-360.png' });

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
  await evidence(page, { path: 'context/changes/operator-login/evidence/shell-360.png' });

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
  await evidence(page, { path: 'context/changes/operator-profile/evidence/profile-360.png' });

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

const IMPORT_EVIDENCE = 'context/changes/manual-text-import/evidence';
const ANALYSIS_EVIDENCE = 'context/changes/analysis-and-scoring/evidence';
const POST_TITLE =
  'DEMO: Szukamy programisty TypeScript do zbudowania integracji API z systemem magazynowym.';
const POST_TEXT = `${POST_TITLE}
Praca zdalna, budżet 8000-12000 PLN, start od następnego tygodnia. Zapłacimy za wykonanie prototypu.`;

// Fourth of five logins of the run: the throttle allows 5 attempts per 15 minutes, the tests above
// use 3.
test('the operator imports a pasted post, sees it in the list and the repeat is recognised', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Hasło').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj' }).click();

  await page.getByRole('link', { name: 'Okazje' }).click();
  await expect(page.getByText('Brak zweryfikowanych okazji dla tego okresu')).toBeVisible();
  await expect(page.getByText('Sprawdzone źródła: 0')).toBeVisible();
  await expect(page.getByText('Błędy źródeł: brak')).toBeVisible();
  await assertNoOverflow(page);
  await evidence(page, { path: `${IMPORT_EVIDENCE}/empty-360.png` });

  await page.getByRole('link', { name: 'Import' }).click();
  await assertNoOverflow(page);
  await page.getByLabel('Treść ogłoszenia').fill(POST_TEXT);
  await page
    .getByLabel('Adres URL (opcjonalnie)')
    .fill('https://example.com/oferta/1?utm_source=x#frag');
  await page.getByRole('button', { name: 'Importuj' }).click();
  await expect(page.getByText(/Zaimportowano/)).toBeVisible();

  await page.getByRole('link', { name: 'Okazje' }).click();
  await expect(page.getByRole('link', { name: POST_TITLE })).toBeVisible();
  // The mock analyses right after the import, in the background: reload until it is done.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText('Analiza: gotowa')).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(page.getByText('DEMO / MOCK').first()).toBeVisible();
  await expect(page.getByText(/Ocena: \d+/)).toBeVisible();
  await assertNoOverflow(page);
  await evidence(page, { path: `${ANALYSIS_EVIDENCE}/list-360.png` });

  await page.getByRole('link', { name: POST_TITLE }).click();
  await expect(page.getByText('DEMO / MOCK — wynik reguł, nie analiza AI')).toBeVisible();
  for (const component of [
    'Popyt',
    'Dopasowanie kompetencji',
    'Szybkość realizacji',
    'Opłacalność',
    'Powtarzalność',
  ]) {
    await expect(page.getByText(component, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('szacunek (hipoteza)').first()).toBeVisible();
  await expect(page.getByText(/ze źródła: „.*8000-12000 PLN.*”/)).toBeVisible();
  await assertNoOverflow(page);
  await evidence(page, { path: `${ANALYSIS_EVIDENCE}/detail-360.png`, fullPage: true });
  await page.getByRole('link', { name: 'Wróć do listy' }).click();

  await page.getByRole('link', { name: 'Import' }).click();
  await page.getByLabel('Adres URL (opcjonalnie)').fill('https://EXAMPLE.com/oferta/1/');
  await page.getByRole('button', { name: 'Importuj' }).click();
  await expect(page.getByText(/Już zaimportowane/)).toBeVisible();
  await evidence(page, { path: `${IMPORT_EVIDENCE}/duplicate-360.png` });

  await page.getByRole('link', { name: 'Zobacz istniejącą okazję' }).click();
  await expect(page).toHaveURL(/\/okazje\/\d+$/);
  await expect(
    page.locator('dl').getByText('https://example.com/oferta/1?utm_source=x#frag'),
  ).toBeVisible();
  await assertNoOverflow(page);
});
