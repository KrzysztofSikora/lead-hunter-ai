import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SourcesPage } from './SourcesPage.js';
import { strings } from './strings.pl.js';

const t = strings.sources;

const base = {
  presetId: null,
  accessNote: 'Publiczne API.',
  termsUrl: null,
  enabled: true,
  filter: { enabled: false, include: [], exclude: [] },
  presetWithdrawn: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  nextAllowedAt: null,
};
const bzp = {
  ...base,
  id: 1,
  type: 'bzp',
  name: 'DEMO BZP',
  url: 'https://ezamowienia.gov.pl/mo-board/api/v1/notice',
  tender: { cpvPrefixes: ['72', '48', '73'], countries: null },
};
const ted = {
  ...base,
  id: 2,
  type: 'ted',
  name: 'DEMO TED',
  url: 'https://api.ted.europa.eu/v3/notices/search',
  tender: { cpvPrefixes: ['72'], countries: ['PL'] },
};
const feed = {
  ...base,
  id: 3,
  type: 'rss',
  name: 'DEMO RSS',
  url: 'https://example.com/feed',
  tender: null,
};

function stubApi(
  items: unknown[],
  patch: (body: unknown) => Response = () => new Response('{}', { status: 500 }),
) {
  const patches: { url: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      patches.push({ url, body });
      return patch(body);
    }
    if (url.startsWith('/api/jobs'))
      return new Response(
        JSON.stringify({
          schedule: { times: ['08:00'], nextRunAt: null },
          running: false,
          items: [],
        }),
      );
    return new Response(JSON.stringify({ items, presets: [] }));
  });
  return patches;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows the tender editor only on tender sources, with the API endpoint', async () => {
  stubApi([bzp, ted, feed]);
  render(<SourcesPage />);
  await screen.findByText('DEMO BZP');
  expect(screen.getAllByLabelText(t.tender.cpvLabel)).toHaveLength(2);
  expect(screen.getAllByLabelText(t.tender.countriesLabel)).toHaveLength(1);
  expect(screen.getByText(bzp.url)).toBeTruthy();
  expect(screen.queryByText(feed.url)).toBeNull();
});

it('sends PATCH { tender } with the edited prefixes and no countries for BZP', async () => {
  const patches = stubApi([bzp], (body) => {
    const tender = (body as { tender: { cpvPrefixes: string[] } }).tender;
    return new Response(
      JSON.stringify({ ...bzp, tender: { cpvPrefixes: tender.cpvPrefixes, countries: null } }),
    );
  });
  render(<SourcesPage />);
  const field = await screen.findByLabelText(t.tender.cpvLabel);
  fireEvent.change(field, { target: { value: '72, 48\n' } });
  fireEvent.click(screen.getByText(t.tender.save));
  await screen.findByText(t.tender.saved);
  expect(patches).toEqual([
    { url: '/api/sources/1', body: { tender: { cpvPrefixes: ['72', '48'] } } },
  ]);
});

it('sends upper-case countries for TED', async () => {
  const patches = stubApi([ted], () => new Response(JSON.stringify(ted)));
  render(<SourcesPage />);
  fireEvent.change(await screen.findByLabelText(t.tender.countriesLabel), {
    target: { value: 'pl; de' },
  });
  fireEvent.click(screen.getByText(t.tender.save));
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0]?.body).toEqual({ tender: { cpvPrefixes: ['72'], countries: ['PL', 'DE'] } });
});

it('shows the server issues and keeps what was typed', async () => {
  stubApi(
    [bzp],
    () =>
      new Response(
        JSON.stringify({
          error: 'validation_failed',
          fields: [{ path: 'tender', code: 'invalid', message: 'Kod CPV: od 2 do 8 cyfr.' }],
        }),
        { status: 400 },
      ),
  );
  render(<SourcesPage />);
  const field = await screen.findByLabelText(t.tender.cpvLabel);
  fireEvent.change(field, { target: { value: '7' } });
  fireEvent.click(screen.getByText(t.tender.save));
  await screen.findByText('Kod CPV: od 2 do 8 cyfr.');
  expect((field as HTMLTextAreaElement).value).toBe('7');
});

it('shows a generic error when the save fails', async () => {
  stubApi([bzp]);
  render(<SourcesPage />);
  fireEvent.click(await screen.findByText(t.tender.save));
  await screen.findByText(t.tender.saveFailed);
});
