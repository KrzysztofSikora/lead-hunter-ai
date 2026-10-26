import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { DeleteOpportunity } from './OpportunityPage.js';
import { strings } from './strings.pl.js';

const t = strings.opportunity;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCard() {
  return render(
    <MemoryRouter initialEntries={['/okazje/7']}>
      <Routes>
        <Route path="/okazje/7" element={<DeleteOpportunity id={7} />} />
        <Route path="/okazje" element={<p>lista okazji</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

it('does not delete on the first click', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  renderCard();
  fireEvent.click(screen.getByRole('button', { name: t.deleteOpportunity }));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: t.deleteConfirm })).toBeTruthy();
});

it('deletes after the confirmation and goes back to the list', async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  renderCard();
  fireEvent.click(screen.getByRole('button', { name: t.deleteOpportunity }));
  fireEvent.click(screen.getByRole('button', { name: t.deleteConfirm }));
  expect(await screen.findByText('lista okazji')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/opportunities/7',
    expect.objectContaining({ method: 'DELETE' }),
  );
});

it('cancel restores the button and sends nothing', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  renderCard();
  fireEvent.click(screen.getByRole('button', { name: t.deleteOpportunity }));
  fireEvent.click(screen.getByRole('button', { name: t.deleteCancel }));
  expect(screen.getByRole('button', { name: t.deleteOpportunity })).toBeTruthy();
  expect(screen.queryByRole('button', { name: t.deleteConfirm })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('shows an error and stays on the card when the delete fails', async () => {
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
  renderCard();
  fireEvent.click(screen.getByRole('button', { name: t.deleteOpportunity }));
  fireEvent.click(screen.getByRole('button', { name: t.deleteConfirm }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(t.deleteFailed));
  expect(screen.queryByText('lista okazji')).toBeNull();
});
