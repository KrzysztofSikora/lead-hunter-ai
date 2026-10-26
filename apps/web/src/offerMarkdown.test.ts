import { expect, it } from 'vitest';
import type { OfferDraft } from '@lead-hunter/contracts';
import { draftFileName, draftToMarkdown } from './offerMarkdown.js';

const draft: OfferDraft = {
  id: 3,
  opportunityId: 12,
  status: 'REVIEWED',
  language: 'pl',
  subject: 'DEMO: Integracja z API',
  message: 'DEMO: Dzień dobry, chętnie pomogę.',
  proposal: 'DEMO: Pełna propozycja.',
  content: {
    language: 'pl',
    problem: 'DEMO problem',
    plan: ['krok 1'],
    valueProposition: 'DEMO wartość',
    mvpScope: ['zakres A'],
    exclusions: [],
    timeline: { minDays: 5, maxDays: 10, assumptions: ['założenie czasu'] },
    pricing: {
      model: 'FIXED_PRICE',
      range: { minMinor: 600000, maxMinor: 900000, currency: 'PLN' },
      assumptions: ['założenie ceny'],
    },
    questions: ['pytanie 1', 'pytanie 2', 'pytanie 3'],
    message: { subject: 'x', body: 'y' },
    proposal: { body: 'z' },
  },
  guardNotes: [],
  provider: 'mock',
  model: 'mock',
  promptVersion: 'offer-1',
  demo: true,
  analysed: true,
  inputTokens: null,
  outputTokens: null,
  costMicroUsd: null,
  createdAt: '2026-10-25T10:00:00.000Z',
  updatedAt: '2026-10-25T10:00:00.000Z',
  statusChangedAt: '2026-10-25T10:00:00.000Z',
};

it('exports the saved text first and labels the working notes as model draft and estimate', () => {
  const md = draftToMarkdown(draft, 'DEMO: tytuł');
  expect(md.startsWith('# DEMO: tytuł\n')).toBe(true);
  expect(md.indexOf(draft.message)).toBeLessThan(md.indexOf('szkic modelu'));
  expect(md).toContain('szkic modelu');
  expect(md).toContain('szacunek (hipoteza)');
  expect(md).toContain('5–10 dni roboczych');
  expect(md).toContain('6 000,00 PLN – 9 000,00 PLN');
  expect(md).not.toContain('### Poza zakresem');
  expect(md.endsWith('\n')).toBe(true);
});

it('exports only the saved text when the stored plan no longer parses', () => {
  const md = draftToMarkdown({ ...draft, content: null }, 'T');
  expect(md).toContain(draft.proposal);
  expect(md).not.toContain('szkic modelu');
});

it('names the file with the Warsaw date', () => {
  expect(draftFileName(12, Date.parse('2026-10-25T23:30:00Z'))).toBe('oferta-12-2026-10-26.md');
});
