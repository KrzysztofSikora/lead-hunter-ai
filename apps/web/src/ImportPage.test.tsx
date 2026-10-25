import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { ImportPage } from './ImportPage.js';
import { strings } from './strings.pl.js';

const t = strings.import;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub(status: number, body: unknown) {
  const calls: RequestInit[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    calls.push(init);
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <ImportPage />
    </MemoryRouter>,
  );

const submitWith = (text: string, url = '') => {
  fireEvent.change(screen.getByLabelText(t.textLabel), { target: { value: text } });
  fireEvent.change(screen.getByLabelText(t.urlLabel), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: t.submit }));
};

it('sends only the filled fields and links to the created opportunity', async () => {
  const calls = stub(201, { result: 'created', opportunityId: 7, signalId: 3 });
  renderPage();
  submitWith('Szukam programisty', '  https://example.com/a?utm_source=x  ');
  const link = await screen.findByRole('link', { name: t.openCreated });
  expect(link.getAttribute('href')).toBe('/okazje/7');
  expect(JSON.parse(calls[0]?.body as string)).toEqual({
    text: 'Szukam programisty',
    url: 'https://example.com/a?utm_source=x',
  });
});

it('says "już zaimportowane" with a link to the existing opportunity', async () => {
  stub(200, {
    result: 'duplicate',
    opportunityId: 4,
    matchedBy: 'canonical_url',
    evidenceAdded: false,
  });
  renderPage();
  submitWith('', 'https://example.com/a');
  expect(await screen.findByText(new RegExp(t.duplicate))).toBeTruthy();
  expect(screen.getByRole('link', { name: t.openDuplicate }).getAttribute('href')).toBe(
    '/okazje/4',
  );
});

it('shows the Polish message of a rejected field next to it', async () => {
  stub(400, {
    error: 'validation_failed',
    fields: [{ path: 'text', code: 'custom', message: 'wklej treść lub podaj adres URL' }],
  });
  renderPage();
  submitWith('   ');
  expect(await screen.findByText('wklej treść lub podaj adres URL')).toBeTruthy();
  expect(screen.getByLabelText(t.textLabel).getAttribute('aria-invalid')).toBe('true');
});

it('shows a failure line when the server errors', async () => {
  stub(500, { error: 'x' });
  renderPage();
  submitWith('tekst');
  expect((await screen.findByRole('alert')).textContent).toBe(t.failed);
});
