import type { ActivityEvent, OpportunityDetail } from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import {
  CARD_ELEMENTS,
  buildCard,
  eventDetails,
  prefilterReason,
  type CardItem,
  type CardSection,
} from './opportunityCard.js';
import { strings } from './strings.pl.js';
import { formatWarsaw } from './warsawTime.js';

const NOW = '2026-01-01T10:00:00.000Z';

const analysed = {
  verdict: 'ANALYSED',
  category: 'DIRECT_GIG',
  evidenceLevel: 'DIRECT_REQUEST',
  problem: 'DEMO problem',
  buyerOrAudience: 'DEMO buyer',
  buyerConfirmed: true,
  relevantSkills: ['DEMO skill'],
  solutionApproach: 'DEMO approach',
  suggestedDeliverable: 'DEMO deliverable',
  mvpScope: ['DEMO scope'],
  exclusions: ['DEMO exclusion'],
  monetizationModel: 'FIXED_PRICE',
  estimatedHours: { min: 10, max: 20 },
  proposedPrice: { minMinor: 100000, maxMinor: 200000, currency: 'PLN' },
  pricingAssumptions: ['DEMO assumption'],
  requiredClarifications: ['DEMO question'],
  nextAction: 'DEMO next',
  uncertainties: ['DEMO risk'],
  rationale: 'DEMO',
  sourceFacts: ['DEMO fact'],
  inferences: [],
  unknowns: ['DEMO unknown'],
  sourceBudget: { minMinor: 100000, maxMinor: 150000, currency: 'PLN', quote: 'DEMO quote' },
  industry: null,
  workMode: 'UNKNOWN',
  countries: [],
} as const;

const components = [
  ['demand', 30],
  ['skillFit', 25],
  ['speed', 20],
  ['profitability', 15],
  ['repeatability', 10],
] as const;

const breakdown = {
  version: 1,
  total: 50,
  confidence: 'MEDIUM',
  components: components.map(([key, max]) => ({
    key,
    points: max / 2,
    max,
    justification: `DEMO ${key}`,
  })),
} as const;

const latest = (result: unknown, withBreakdown: boolean) =>
  ({
    status: 'COMPLETE',
    provider: 'mock',
    model: 'mock',
    promptVersion: '1',
    schemaVersion: 2,
    demo: true,
    createdAt: NOW,
    inputTokens: null,
    outputTokens: null,
    result,
    breakdown: withBreakdown ? breakdown : null,
    guardNotes: withBreakdown ? ['DEMO guard note'] : [],
    error: null,
  }) as unknown as OpportunityDetail['latestAnalysis'];

const detail = (overrides: Partial<OpportunityDetail>): OpportunityDetail => ({
  id: 1,
  businessStatus: 'NEW',
  analysisStatus: 'COMPLETE',
  createdAt: NOW,
  updatedAt: NOW,
  analysis: null,
  prefilter: null,
  source: {
    type: 'manual_text',
    name: null,
    url: null,
    canonicalUrl: null,
    title: 'DEMO title',
    publishedAt: null,
    fetchedAt: NOW,
    availability: 'NOT_CHECKED',
    lastVerifiedAt: null,
    tender: null,
    snippet: 'DEMO text',
  },
  evidence: [],
  latestAnalysis: null,
  activity: [],
  followUpOn: null,
  payments: [],
  offerDraft: null,
  offerDraftHistory: [],
  ...overrides,
});

const states: Record<string, OpportunityDetail> = {
  analysed: detail({
    analysis: {
      category: 'DIRECT_GIG',
      evidenceLevel: 'DIRECT_REQUEST',
      score: 50,
      confidence: 'MEDIUM',
      demo: true,
    },
    latestAnalysis: latest(analysed, true),
  }),
  insufficient: detail({
    latestAnalysis: latest(
      {
        verdict: 'INSUFFICIENT_DATA',
        reason: 'DEMO reason',
        unknowns: ['DEMO u'],
        sourceFacts: [],
      },
      false,
    ),
  }),
  pending: detail({ analysisStatus: 'PENDING' }),
  skipped: detail({
    analysisStatus: 'SKIPPED',
    businessStatus: 'NEEDS_VERIFICATION',
    prefilter: { rule: 'spam', matches: 1, language: null, phrase: null },
  }),
};

const flat = (sections: CardSection[]) => sections.flatMap((s) => s.items);
const byId = (sections: CardSection[], id: string): CardItem => {
  const found = flat(sections).find((i) => i.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

describe('buildCard', () => {
  it.each(Object.keys(states))('has the twelve sections in §8 order (%s)', (name) => {
    const card = buildCard(states[name]!);
    expect(card.map((s) => s.key)).toEqual([...CARD_ELEMENTS]);
    expect(CARD_ELEMENTS).toHaveLength(12);
    expect(new Set(card.map((s) => s.title)).size).toBe(12);
  });

  it.each(Object.keys(states))('never pairs a missing value with a real tag (%s)', (name) => {
    for (const i of flat(buildCard(states[name]!))) {
      if (i.value === null) expect(i.tag).toBe('unknown');
      if (i.tag === 'unknown' && i.id !== 'publishedAt') expect(i.value).toBeNull();
    }
  });

  it('tags every analysed value by where it comes from', () => {
    const card = buildCard(states.analysed!);
    const tag = (id: string) => byId(card, id).tag;
    for (const id of [
      'category',
      'evidenceLevel',
      'buyer',
      'buyerConfirmed',
      'problem',
      'deliverable',
      'approach',
      'mvpScope',
      'exclusions',
      'skills',
      'billingModel',
      'risks',
      'missing',
      'questions',
      'nextAction',
      'assumptions',
    ]) {
      expect(tag(id), id).toBe('inference');
    }
    for (const id of ['title', 'excerpt', 'sourceFacts', 'sourceBudget'])
      expect(tag(id), id).toBe('source');
    for (const id of ['price', 'hours']) expect(tag(id), id).toBe('estimate');
    for (const id of [
      'score',
      'confidence',
      'skillFit',
      'guardNotes',
      'component:demand',
      'component:repeatability',
    ]) {
      expect(tag(id), id).toBe('rules');
    }
    expect(byId(card, 'skillFit').value).toBe('DEMO skillFit');
    expect(byId(card, 'sourceBudget').value).toContain('DEMO quote');
    expect(byId(card, 'score').value).toBe('50');
    expect(card.find((s) => s.key === 'score')?.emptyReason).toBeUndefined();
  });

  it('keeps app records untagged and the source link honest', () => {
    const card = buildCard(states.analysed!);
    expect(byId(card, 'businessStatus').tag).toBeNull();
    expect(byId(card, 'detectedAt').tag).toBeNull();
    expect(byId(card, 'link').value).toBe('wklejony tekst');
    expect(byId(card, 'goToSource').value).toBe('wklejony tekst — brak linku');
    expect(byId(card, 'publishedAt')).toMatchObject({ value: 'nieznana', tag: 'unknown' });
  });

  it('links the source when there is a URL and splits long text', () => {
    const long = detail({
      source: {
        ...states.analysed!.source,
        url: 'https://example.test/x',
        snippet: 'a'.repeat(700),
      },
    });
    const card = buildCard(long);
    expect(byId(card, 'link')).toMatchObject({ href: 'https://example.test/x', tag: 'source' });
    expect(byId(card, 'goToSource').href).toBe('https://example.test/x');
    const excerpt = byId(card, 'excerpt');
    expect((excerpt.value as string).length).toBe(600);
    expect(excerpt.more).toHaveLength(700);
  });

  it('cuts the excerpt by code point, never inside an emoji', () => {
    const emoji = detail({
      source: {
        ...states.analysed!.source,
        snippet: `${'a'.repeat(599)}😀${'b'.repeat(50)}`,
      },
    });
    const value = byId(buildCard(emoji), 'excerpt').value as string;
    expect(value.isWellFormed()).toBe(true);
    expect(Array.from(value)).toHaveLength(600);
  });

  it.each(['pending', 'skipped'])('invents nothing without an analysis (%s)', (name) => {
    const card = buildCard(states[name]!);
    for (const key of ['score', 'problem', 'offer', 'skills', 'pricing', 'nextStep'] as const) {
      const section = card.find((s) => s.key === key)!;
      expect(section.emptyReason, key).toBeTruthy();
      expect(
        section.items.every((i) => i.value === null),
        key,
      ).toBe(true);
    }
  });

  it('says why: skipped names the rule, insufficient data keeps the model reason and unknowns', () => {
    expect(buildCard(states.skipped!).find((s) => s.key === 'score')?.emptyReason).toContain(
      'spam',
    );
    const card = buildCard(states.insufficient!);
    expect(byId(card, 'reason')).toMatchObject({ value: 'DEMO reason', tag: 'inference' });
    expect(byId(card, 'missing')).toMatchObject({ value: ['DEMO u'], tag: 'inference' });
  });
});

describe('eventDetails', () => {
  const event: ActivityEvent = {
    id: 1,
    type: 'STATUS_CHANGE',
    actor: 'operator',
    fromStatus: 'SAVED',
    toStatus: 'CONTACTED',
    reason: null,
    note: null,
    cause: null,
    skipped: [],
    contract: null,
    followUpOn: null,
    followUpCleared: false,
    work: null,
    occurredAt: NOW,
  };

  it('says when a move dropped the follow-up', () => {
    expect(eventDetails({ ...event, followUpCleared: true })).toEqual([
      'follow-up usunięty przy zmianie statusu',
    ]);
  });

  it('shows the stages a forward move skipped', () => {
    expect(eventDetails({ ...event, skipped: ['OFFER_DRAFTED'] })).toEqual([
      'pominięto: Szkic oferty',
    ]);
  });

  it('shows nothing extra for a plain move', () => {
    expect(eventDetails(event)).toEqual([]);
  });

  it('shows the contract of a win with its dates', () => {
    expect(
      eventDetails({
        ...event,
        toStatus: 'WON',
        contract: {
          valueMinor: 150000,
          currency: 'PLN',
          expectedStartOn: '2026-11-01',
        },
      }),
    ).toEqual(['umowa: 1\u00a0500,00 PLN (01.11.2026 – ?)']);
  });

  it('shows a follow-up set and cleared', () => {
    const followUp: ActivityEvent = {
      ...event,
      type: 'FOLLOW_UP',
      fromStatus: null,
      toStatus: null,
    };
    expect(eventDetails({ ...followUp, followUpOn: '2026-10-30' })).toEqual([
      'ustawiono na 30.10.2026',
    ]);
    expect(eventDetails(followUp)).toEqual(['usunięto']);
  });
});

describe('prefilterReason', () => {
  it('names the matched phrase of a source filter (D-15)', () => {
    expect(prefilterReason('source_filter', '[FOR HIRE]')).toBe('filtr źródła: [FOR HIRE]');
  });

  it('says "brak frazy" when no include phrase matched', () => {
    expect(prefilterReason('source_filter', null)).toBe('filtr źródła: brak frazy');
  });

  it('keeps the plain label for an ordinary rule', () => {
    expect(prefilterReason('spam', null)).toBe('wygląda na spam');
  });
});

describe('buildCard: public tender (S-18 D-15)', () => {
  const tenderDetail = (tender: Partial<NonNullable<OpportunityDetail['source']['tender']>>) => {
    const base = detail({});
    return detail({
      source: {
        ...base.source,
        type: 'bzp',
        tender: {
          noticeId: 'DEMO-2026/001',
          buyer: 'DEMO Urząd Miasta',
          deadlineAt: '2026-11-20T09:00:00.000Z',
          estimatedValue: null,
          cpvCodes: [],
          procedure: null,
          country: 'PL',
          ...tender,
        },
      },
    });
  };

  it('shows buyer, deadline in Warsaw time and notice number tagged "ze źródła"', () => {
    const card = buildCard(tenderDetail({}));
    expect(byId(card, 'tender')).toMatchObject({ value: 'Przetarg publiczny', tag: 'source' });
    expect(byId(card, 'tenderBuyer')).toMatchObject({ value: 'DEMO Urząd Miasta', tag: 'source' });
    expect(byId(card, 'tenderDeadline')).toMatchObject({
      value: formatWarsaw('2026-11-20T09:00:00.000Z'),
      tag: 'source',
    });
    expect(String(byId(card, 'tenderDeadline').value)).toContain('10:00');
    expect(byId(card, 'tenderNotice')).toMatchObject({ value: 'DEMO-2026/001', tag: 'source' });
  });

  it('shows the stated value, "nie podano" only when the source reports none, else unknown', () => {
    const stated = buildCard(
      tenderDetail({ estimatedValue: { amountMinor: 12_300_000, currency: 'PLN', quote: 'DEMO' } }),
    );
    expect(byId(stated, 'tenderValue')).toMatchObject({
      value: '123\u00a0000,00 PLN',
      tag: 'source',
    });
    const absent = buildCard(tenderDetail({ valueState: 'absent' }));
    expect(byId(absent, 'tenderValue')).toMatchObject({ value: 'nie podano', tag: 'source' });
    const missed = buildCard(tenderDetail({}));
    expect(byId(missed, 'tenderValue')).toMatchObject({ value: null, tag: 'unknown' });
    const noDeadline = buildCard(tenderDetail({ deadlineAt: null }));
    expect(byId(noDeadline, 'tenderDeadline')).toMatchObject({ value: null, tag: 'unknown' });
  });

  it('adds nothing for a source without tender facts, and labels the evidence level', () => {
    expect(flat(buildCard(states.analysed!)).some((i) => i.id.startsWith('tender'))).toBe(false);
    expect(strings.opportunity.evidenceLevels.PUBLIC_TENDER).toBe('przetarg publiczny');
  });
});
