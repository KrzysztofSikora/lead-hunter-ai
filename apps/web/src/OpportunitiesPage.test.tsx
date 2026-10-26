import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { OpportunitiesPage } from './OpportunitiesPage.js';
import { strings } from './strings.pl.js';

const t = strings.opportunities;

const status = {
  configured: false,
  provider: null,
  model: null,
  paid: false,
  blocked: null,
  budget: {
    capMicroUsd: null,
    spentMicroUsd: 0,
    unknownCostCount: 0,
    monthStart: '2026-01-01T00:00:00.000Z',
  },
  demo: false,
  dailyLimit: 10,
  analysedToday: 0,
  waiting: 0,
  limitReached: false,
  paused: false,
};
const list = { items: [], page: 1, pageSize: 20, total: 0, sources: { checked: 0, errors: [] } };

function stubApi(override: Record<string, unknown> = {}) {
  const listUrls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.startsWith('/api/opportunities')) {
      listUrls.push(url);
      return new Response(JSON.stringify(list));
    }
    return new Response(JSON.stringify({ ...status, ...override }));
  });
  return listUrls;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/okazje" element={<OpportunitiesPage />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('sends a lowercase country and a decimal amount from the URL, in upper case and minor units', async () => {
  const urls = stubApi();
  renderAt('/okazje?country=pl&minAmount=1500.50&currency=PLN');
  await screen.findByText(t.empty);
  const query = new URL(urls.at(-1)!, 'http://x').searchParams;
  expect(query.get('country')).toBe('PL');
  expect(query.get('minAmount')).toBe('150050');
});

it('ignores a maxAgeDays above the contract limit instead of sending it', async () => {
  const urls = stubApi();
  renderAt('/okazje?maxAgeDays=4000');
  await screen.findByText(t.empty);
  expect(new URL(urls.at(-1)!, 'http://x').searchParams.has('maxAgeDays')).toBe(false);
});

it('explains a minimum amount without a currency and does not apply it', async () => {
  const urls = stubApi();
  renderAt('/okazje');
  await screen.findByText(t.empty);
  const before = urls.length;
  fireEvent.change(screen.getByLabelText(t.minAmount), { target: { value: '500' } });
  fireEvent.submit(screen.getByRole('form', { name: t.filters }));
  expect((await screen.findByRole('alert')).textContent).toBe(t.amountNeedsCurrency);
  expect(urls.length).toBe(before);
});

const paid = { configured: true, provider: 'anthropic', model: 'claude-haiku-5-5', paid: true };

it('tells how to set the cap when a paid provider has none (FR-09 AC1)', async () => {
  stubApi({ ...paid, blocked: 'budget_missing', waiting: 2 });
  renderAt('/okazje');
  expect(await screen.findByText(t.analysisBlockedMissing)).toBeTruthy();
});

it('names the spent amount and the cap once the budget is reached (FR-09 AC2)', async () => {
  stubApi({
    ...paid,
    blocked: 'budget_reached',
    budget: { ...status.budget, capMicroUsd: 10_000, spentMicroUsd: 12_345 },
  });
  renderAt('/okazje');
  expect(await screen.findByText(/wydano 0,012345 z limitu 0,0100 USD/)).toBeTruthy();
});

it('says how many analyses have no cost data (FR-09 AC4)', async () => {
  stubApi({ ...paid, budget: { ...status.budget, unknownCostCount: 3 } });
  renderAt('/okazje');
  expect(await screen.findByText(t.analysisUnknownCost(3))).toBeTruthy();
});
