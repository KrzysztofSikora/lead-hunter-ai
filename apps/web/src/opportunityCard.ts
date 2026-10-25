import type { ActivityEvent, OpportunityDetail, PrefilterRule } from '@lead-hunter/contracts';
import { formatMinor, strings } from './strings.pl.js';
import { formatCalendarDate, formatWarsaw } from './warsawTime.js';

const t = strings.opportunity;
const list = strings.opportunities;

/** S-06 D-9: where a value comes from. `unknown` is the only tag a missing value may carry. */
export type Provenance = 'source' | 'inference' | 'estimate' | 'rules' | 'unknown';

/** §8 order. */
export const CARD_ELEMENTS = [
  'overview',
  'origin',
  'excerpt',
  'score',
  'problem',
  'offer',
  'skills',
  'pricing',
  'risks',
  'nextStep',
  'actions',
  'history',
] as const;
export type CardElement = (typeof CARD_ELEMENTS)[number];

export type CardItem = {
  id: string;
  label: string;
  /** `null` means there is nothing to show; the tag is then always `unknown`. */
  value: string | string[] | null;
  /** App records (status, detection date) carry no tag. */
  tag: Provenance | null;
  /** D-10: the rest of a long text, offered behind "Pokaż całość". */
  more?: string;
  href?: string;
};

export type CardSection = {
  key: CardElement;
  title: string;
  items: CardItem[];
  /** Why the analysis-dependent part is empty; absent when there is an analysis. */
  emptyReason?: string;
  events?: ActivityEvent[];
};

const EXCERPT_CHARS = 600;

const isEmpty = (value: string | string[] | null | undefined) =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);

function item(
  id: string,
  label: string,
  value: string | string[] | null | undefined,
  tag: Provenance | null,
  extra: Pick<CardItem, 'more' | 'href'> = {},
): CardItem {
  if (isEmpty(value)) return { id, label, value: null, tag: 'unknown' };
  return { id, label, value: value as string | string[], tag, ...extra };
}

function money(minMinor: number, maxMinor: number, currency: string) {
  const fmt = (minor: number) => (minor / 100).toLocaleString('pl-PL');
  return `${fmt(minMinor)}–${fmt(maxMinor)} ${currency}`;
}

/** D-15: the rule's label; a source filter adds the matched phrase or "brak frazy". */
export function prefilterReason(rule: PrefilterRule, phrase: string | null): string {
  return rule === 'source_filter' ? t.history.sourceFilter(phrase) : strings.prefilterRules[rule];
}

function emptyReason(data: OpportunityDetail): string | undefined {
  const latest = data.latestAnalysis;
  const prefilter = data.prefilter;
  if (prefilter?.rule) {
    const why = prefilterReason(prefilter.rule, prefilter.phrase);
    return data.analysisStatus === 'SKIPPED' ? list.skippedBecause(why) : why;
  }
  if (latest?.result?.verdict === 'ANALYSED') return undefined;
  if (latest?.result?.verdict === 'INSUFFICIENT_DATA') return t.empty.insufficient;
  if (latest) return `${t.empty.failed}${latest.error ? ` ${latest.error}` : ''}`;
  return data.analysisStatus === 'PENDING' ? t.empty.pending : list.analysisFailed;
}

/** The twelve elements of brief §8, in order, with a provenance tag on every value. */
export function buildCard(data: OpportunityDetail): CardSection[] {
  const { source } = data;
  const latest = data.latestAnalysis;
  const skipped = Boolean(data.prefilter?.rule);
  const result = skipped ? null : (latest?.result ?? null);
  const analysed = result?.verdict === 'ANALYSED' ? result : null;
  const breakdown = skipped ? null : (latest?.breakdown ?? null);
  const score = skipped ? null : (data.analysis?.score ?? null);
  const reason = emptyReason(data);
  const component = (key: string) => breakdown?.components.find((c) => c.key === key);
  const skillFit = component('skillFit');

  const chars = Array.from(source.snippet);
  const excerpt = chars.slice(0, EXCERPT_CHARS).join('');
  const rest = chars.length > EXCERPT_CHARS;

  const scoreItems: CardItem[] = [
    item('score', t.items.scoreTotal, score === null ? null : String(score), 'rules'),
    item(
      'confidence',
      t.confidence,
      breakdown ? t.confidences[breakdown.confidence] : null,
      'rules',
    ),
    ...(breakdown
      ? breakdown.components.map((c) =>
          item(
            `component:${c.key}`,
            `${t.components[c.key]} ${t.scoreOf(c.points, c.max)}`,
            c.justification,
            'rules',
          ),
        )
      : []),
    ...(result?.verdict === 'INSUFFICIENT_DATA'
      ? [item('reason', t.items.reason, result.reason, 'inference')]
      : []),
    item('guardNotes', t.items.guardNotes, skipped ? [] : (latest?.guardNotes ?? []), 'rules'),
  ];

  const sections: Record<CardElement, Omit<CardSection, 'key' | 'title'>> = {
    overview: {
      items: [
        item('title', t.items.title, source.title, 'source'),
        item(
          'category',
          t.category,
          analysed ? list.categories[analysed.category] : null,
          'inference',
        ),
        item(
          'businessStatus',
          t.items.businessStatus,
          list.businessStatus[data.businessStatus],
          null,
        ),
      ],
    },
    origin: {
      items: [
        ...(source.name === null
          ? []
          : [item('sourceName', t.items.sourceName, source.name, 'source')]),
        source.url
          ? item('link', t.items.sourceLink, source.url, 'source', { href: source.url })
          : item('link', t.items.sourceLink, t.pastedText, null),
        source.publishedAt
          ? item('publishedAt', t.publishedAt, formatWarsaw(source.publishedAt), 'source')
          : { id: 'publishedAt', label: t.publishedAt, value: t.unknown, tag: 'unknown' },
        item('detectedAt', t.items.detectedAt, formatWarsaw(data.createdAt), null),
      ],
    },
    excerpt: {
      items: [
        item('excerpt', t.items.excerpt, excerpt, 'source', rest ? { more: source.snippet } : {}),
        item(
          'evidenceLevel',
          t.evidenceLevel,
          analysed ? t.evidenceLevels[analysed.evidenceLevel] : null,
          'inference',
        ),
        item('sourceFacts', t.sourceFactsTitle, result?.sourceFacts, 'source'),
      ],
    },
    score: { items: scoreItems },
    problem: {
      items: [
        item('buyer', t.buyer, analysed?.buyerOrAudience, 'inference'),
        item(
          'buyerConfirmed',
          t.items.buyerConfirmed,
          analysed ? (analysed.buyerConfirmed ? t.items.yes : t.items.no) : null,
          'inference',
        ),
        item('problem', t.problem, analysed?.problem, 'inference'),
      ],
    },
    offer: {
      items: [
        item('deliverable', t.items.deliverable, analysed?.suggestedDeliverable, 'inference'),
        item('approach', t.items.approach, analysed?.solutionApproach, 'inference'),
        item('mvpScope', t.items.mvpScope, analysed?.mvpScope, 'inference'),
        item('exclusions', t.items.exclusions, analysed?.exclusions, 'inference'),
      ],
    },
    skills: {
      items: [
        item('skills', t.items.skills, analysed?.relevantSkills, 'inference'),
        item('skillFit', t.items.skillFit, skillFit?.justification, 'rules'),
      ],
    },
    pricing: {
      items: [
        item(
          'billingModel',
          t.items.billingModel,
          analysed && analysed.monetizationModel !== 'UNKNOWN'
            ? t.billingModels[analysed.monetizationModel]
            : null,
          'inference',
        ),
        item(
          'price',
          t.items.price,
          analysed?.proposedPrice
            ? money(
                analysed.proposedPrice.minMinor,
                analysed.proposedPrice.maxMinor,
                analysed.proposedPrice.currency,
              )
            : null,
          'estimate',
        ),
        item(
          'hours',
          t.items.hours,
          analysed?.estimatedHours
            ? t.hours(analysed.estimatedHours.min, analysed.estimatedHours.max)
            : null,
          'estimate',
        ),
        item('assumptions', t.items.assumptions, analysed?.pricingAssumptions, 'inference'),
        item(
          'sourceBudget',
          t.items.sourceBudget,
          analysed?.sourceBudget
            ? `${money(
                analysed.sourceBudget.minMinor,
                analysed.sourceBudget.maxMinor,
                analysed.sourceBudget.currency,
              )} — ${t.sourceBudget(analysed.sourceBudget.quote)}`
            : null,
          'source',
        ),
      ],
    },
    risks: {
      items: [
        item('risks', t.items.risks, analysed?.uncertainties, 'inference'),
        item('missing', t.items.missing, result?.unknowns, 'inference'),
        item('questions', t.items.questions, analysed?.requiredClarifications, 'inference'),
      ],
    },
    nextStep: {
      items: [item('nextAction', t.items.nextAction, analysed?.nextAction, 'inference')],
    },
    actions: { items: [] },
    history: {
      items: [
        source.url
          ? item('goToSource', t.items.goToSource, source.url, null, { href: source.url })
          : item('goToSource', t.items.goToSource, t.items.pastedNoLink, null),
      ],
      events: data.activity,
    },
  };

  const analysisBound: CardElement[] = [
    'score',
    'problem',
    'offer',
    'skills',
    'pricing',
    'risks',
    'nextStep',
  ];
  return CARD_ELEMENTS.map((key) => ({
    key,
    title: t.sections[key],
    ...sections[key],
    ...(reason && analysisBound.includes(key) ? { emptyReason: reason } : {}),
  }));
}

/** S-08 D-2/D-3/D-7: what a history entry adds beyond its status line, as stored on the event. */
export function eventDetails(event: ActivityEvent): string[] {
  const h = t.history;
  const parts: string[] = [];
  if (event.skipped.length) {
    parts.push(h.skipped(event.skipped.map((stage) => list.businessStatus[stage]).join(', ')));
  }
  if (event.contract) {
    const { valueMinor, currency, expectedStartOn, expectedEndOn } = event.contract;
    const dates =
      expectedStartOn || expectedEndOn
        ? ` (${h.contractDates(
            expectedStartOn ? formatCalendarDate(expectedStartOn) : null,
            expectedEndOn ? formatCalendarDate(expectedEndOn) : null,
          )})`
        : '';
    parts.push(h.contract(`${formatMinor(valueMinor, currency)}${dates}`));
  }
  if (event.followUpCleared) parts.push(h.followUpDropped);
  if (event.type === 'FOLLOW_UP') {
    parts.push(
      event.followUpOn ? h.followUpSet(formatCalendarDate(event.followUpOn)) : h.followUpCleared,
    );
  }
  return parts;
}
