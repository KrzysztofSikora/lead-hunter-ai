import { describe, expect, it } from 'vitest';
import {
  nextDraftStatus,
  OfferDraftAction,
  OfferDraftContent,
  OfferDraftStatus,
} from './offer-drafts.js';

const content = {
  language: 'pl',
  problem: 'DEMO problem',
  plan: ['krok'],
  valueProposition: 'wartość',
  mvpScope: ['zakres'],
  exclusions: [],
  timeline: { minDays: 5, maxDays: 10, assumptions: ['założenie'] },
  pricing: {
    model: 'DAILY',
    range: { minMinor: 600000, maxMinor: 900000, currency: 'PLN' },
    assumptions: ['szacunek'],
  },
  questions: ['a', 'b', 'c'],
  message: { subject: 'temat', body: 'treść' },
  proposal: { body: 'propozycja' },
};

describe('OfferDraftContent', () => {
  it('accepts a complete draft, including a billing model of the profile', () => {
    expect(OfferDraftContent.safeParse(content).success).toBe(true);
  });

  it.each([
    ['2 questions', { questions: ['a', 'b'] }],
    ['7 questions', { questions: ['1', '2', '3', '4', '5', '6', '7'] }],
    ['inverted timeline', { timeline: { minDays: 9, maxDays: 2, assumptions: ['x'] } }],
    ['unknown billing model', { pricing: { ...content.pricing, model: 'HOURLY_B2B' } }],
    ['extra key', { extra: 1 }],
  ])('rejects %s', (_name, patch) => {
    expect(OfferDraftContent.safeParse({ ...content, ...patch }).success).toBe(false);
  });
});

describe('nextDraftStatus', () => {
  const walk = (start: OfferDraftStatus, actions: [OfferDraftAction, boolean?][]) => {
    let status: OfferDraftStatus | null = start;
    for (const [action, changed] of actions) {
      if (status === null) return null;
      status = nextDraftStatus(status, action, changed);
    }
    return status;
  };

  it('walks DRAFT → REVIEWED → COPIED_OR_EXPORTED → SENT_MANUALLY', () => {
    expect(walk('DRAFT', [['save'], ['copied'], ['exported'], ['sent']])).toBe('SENT_MANUALLY');
  });

  it('refuses to skip a step', () => {
    expect(nextDraftStatus('DRAFT', 'copied')).toBeNull();
    expect(nextDraftStatus('DRAFT', 'exported')).toBeNull();
    expect(nextDraftStatus('DRAFT', 'sent')).toBeNull();
    expect(nextDraftStatus('REVIEWED', 'sent')).toBeNull();
  });

  it('keeps the sent text: nothing is allowed after SENT_MANUALLY', () => {
    for (const action of OfferDraftAction.options) {
      expect(nextDraftStatus('SENT_MANUALLY', action)).toBeNull();
    }
  });

  it('D-16: changed text after a copy needs another copy before it can be sent', () => {
    expect(walk('COPIED_OR_EXPORTED', [['save', true], ['sent']])).toBeNull();
    expect(walk('COPIED_OR_EXPORTED', [['save', true], ['exported'], ['sent']])).toBe(
      'SENT_MANUALLY',
    );
    expect(walk('COPIED_OR_EXPORTED', [['save', false], ['sent']])).toBe('SENT_MANUALLY');
  });

  it('never moves back except through changed text (D-16)', () => {
    for (const status of OfferDraftStatus.options) {
      for (const action of OfferDraftAction.options) {
        const next = nextDraftStatus(status, action, false);
        if (next) {
          expect(OfferDraftStatus.options.indexOf(next)).toBeGreaterThanOrEqual(
            OfferDraftStatus.options.indexOf(status),
          );
        }
      }
    }
  });
});
