import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD } from './env.js';

test.use({ viewport: { width: 360, height: 740 } });

const EVIDENCE = 'context/changes/pipeline-and-payments/evidence';
const TITLE = 'DEMO: Potrzebujemy integracji panelu sprzedaży z systemem księgowym przez API.';
const TEXT = `${TITLE}
Praca zdalna, budżet 6000-9000 PLN, start od zaraz. Zapłacimy za wykonanie integracji.`;

// Evidence screenshots are written only on request (`E2E_EVIDENCE=1 pnpm e2e`), so a plain
// gate run never rewrites committed evidence.
async function evidence(page: Page, name: string, directory = EVIDENCE) {
  if (process.env.E2E_EVIDENCE === '1') {
    await page.screenshot({
      path: `${directory}/${name}`,
      fullPage: true,
      type: 'jpeg',
      quality: 55,
    });
  }
}

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

// Fifth and last login of the run: the throttle allows 5 attempts per 15 minutes, the smoke spec
// uses 4.
test('main path: import, analysis, card, contact with follow-up, payment, pipeline', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Hasło').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj' }).click();

  await page.getByRole('link', { name: 'Import' }).click();
  await page.getByLabel('Treść ogłoszenia').fill(TEXT);
  await page.getByRole('button', { name: 'Importuj' }).click();
  await expect(page.getByText(/Zaimportowano/)).toBeVisible();

  await page.getByRole('link', { name: 'Okazje' }).click();
  await expect(page.getByRole('link', { name: TITLE })).toBeVisible();
  // The mock analyses right after the import, in the background: reload until it is done.
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByRole('listitem').filter({ hasText: TITLE }).getByText('Analiza: gotowa'),
    ).toBeVisible({ timeout: 1_000 });
  }).toPass();

  await page.getByRole('link', { name: TITLE }).click();
  await expect(page.getByText('DEMO / MOCK — wynik reguł, nie analiza AI')).toBeVisible();
  // S-07 is not done: the draft step is not part of the path yet (D-13).
  await expect(page.getByRole('button', { name: 'Przygotuj ofertę' })).toBeDisabled();

  await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await expect(page.getByText(/Zmiana statusu \(operator\): Nowa → Zapisana/)).toBeVisible();

  await page.getByRole('button', { name: 'Oznacz jako kontakt' }).click();
  await expect(
    page.getByText(/Zmiana statusu \(operator\): Zapisana → Skontaktowano się/),
  ).toBeVisible();
  await expect(page.getByText(/pominięto: Szkic oferty/)).toBeVisible();

  await page.getByRole('button', { name: 'Ustaw follow-up' }).click();
  await expect(page.getByText(/Zaplanowany: \d{2}\.\d{2}\.\d{4}/)).toBeVisible();
  await assertNoOverflow(page);
  await evidence(page, 'card-contacted-360.jpg');

  await page.getByLabel('Kwota').fill('1500');
  await page.getByRole('button', { name: 'Zapisz płatność' }).click();
  await expect(page.getByText(/1\s500,00 PLN/)).toBeVisible();
  await assertNoOverflow(page);

  await page.getByRole('link', { name: 'Dziś' }).click();
  await expect(page.getByText(/Nowe sygnały: \d+/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Na dziś: follow-up' })).toBeVisible();
  await expect(page.getByRole('link', { name: TITLE })).toBeVisible();
  await assertNoOverflow(page);
  await evidence(page, 'today-360.jpg', 'context/changes/today-brief/evidence');

  await page.getByRole('link', { name: 'Lejek' }).click();
  const totals = page.getByRole('term').filter({ hasText: /./ });
  await expect(totals.first()).toBeVisible();
  const total = (name: string) =>
    page.locator('dt', { hasText: name }).locator('xpath=following-sibling::dd[1]');
  await expect(total('Kontakt (wysłane)')).toHaveText('1');
  await expect(total('Wygrane')).toHaveText('0');
  // count "1" then the sum "1 500,00 PLN", exactly
  await expect(total('Opłacone')).toHaveText(/^1\s*1\s500,00\sPLN$/);
  await expect(page.getByRole('heading', { name: 'Skontaktowano się (1)' })).toBeVisible();
  await assertNoOverflow(page);
  await evidence(page, 'pipeline-360.jpg');
});
