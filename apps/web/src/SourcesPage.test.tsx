import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SourcesPage } from './SourcesPage.js';
import { strings } from './strings.pl.js';

const t = strings.sources;

const github = {
  id: 7,
  type: 'github',
  name: 'GitHub — płatne zgłoszenia (bounty)',
  url: 'https://api.github.com/search/issues',
  presetId: 'github-bounties',
  accessNote: 'DEMO',
  termsUrl: null,
  enabled: true,
  filter: { enabled: false, include: [], exclude: [] },
  github: { labels: ['bounty', 'paid'], languages: ['TypeScript', 'Python'] },
  presetWithdrawn: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  nextAllowedAt: null,
};

function stubApi(patchStatus: number, patchBody: unknown) {
  const patches: { url: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patches.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(patchBody), { status: patchStatus });
    }
    if (url.startsWith('/api/jobs')) {
      return new Response(
        JSON.stringify({
          running: false,
          schedule: { times: ['08:00', '18:00'], nextRunAt: null },
          items: [],
        }),
      );
    }
    return new Response(JSON.stringify({ items: [github], presets: [] }));
  });
  return patches;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows the API endpoint and sends trimmed, deduplicated lines as PATCH { github }', async () => {
  const patches = stubApi(200, {
    ...github,
    github: { labels: ['bounty'], languages: ['TypeScript'] },
  });
  render(<SourcesPage />);
  expect(await screen.findByText(github.url)).toBeTruthy();

  fireEvent.change(screen.getByLabelText(t.github.labelsLabel), {
    target: { value: ' bounty \n\nBounty\n' },
  });
  fireEvent.change(screen.getByLabelText(t.github.languagesLabel), {
    target: { value: 'TypeScript\n' },
  });
  fireEvent.click(screen.getByRole('button', { name: t.github.save }));

  await screen.findByText(t.github.saved);
  expect(patches).toEqual([
    {
      url: '/api/sources/7',
      body: { github: { labels: ['bounty'], languages: ['TypeScript'] } },
    },
  ]);
});

it('shows the server issue of a 400 and keeps what was typed', async () => {
  stubApi(400, {
    error: 'validation_failed',
    fields: [{ path: 'languages.0', code: 'invalid', message: 'Nieznany język.' }],
  });
  render(<SourcesPage />);
  const languages = await screen.findByLabelText(t.github.languagesLabel);
  fireEvent.change(languages, { target: { value: 'Klingon' } });
  fireEvent.click(screen.getByRole('button', { name: t.github.save }));

  await waitFor(() => expect(screen.getByText(/Nieznany język\./)).toBeTruthy());
  expect((languages as HTMLTextAreaElement).value).toBe('Klingon');
});
