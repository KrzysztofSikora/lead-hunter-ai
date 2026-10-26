import {
  BusinessStatus,
  Category,
  SourceType,
  type Currency,
  type Insights,
  type InsightsMetrics,
} from '@lead-hunter/contracts';
import type { Attribution, PaymentFact, SentDraftFact, StatusEventFact } from './ports.js';

export interface InsightsFacts {
  /** `[from, to)` in UTC epoch ms. */
  from: number;
  to: number;
  /** Every operator status change, oldest first. */
  events: StatusEventFact[];
  sentDrafts: SentDraftFact[];
  payments: PaymentFact[];
}

type Calculated = Pick<Insights, 'totals' | 'transitionsTo' | 'bySource' | 'byCategory' | 'work'>;

/** S-08 D-9: moving to one of these, or past `CONTACTED`, records a contact. */
const CONTACT_REACHED: BusinessStatus[] = ['CONTACTED', 'REPLIED', 'MEETING', 'WON', 'LOST'];
const REPLY_REACHED: BusinessStatus[] = ['REPLIED', 'MEETING', 'WON'];
/** D-4: a contact that ended without an answer. */
const NO_REPLY_STATUSES: BusinessStatus[] = ['LOST', 'REJECTED', 'EXPIRED'];

const reaches = (event: StatusEventFact, targets: BusinessStatus[], stage: BusinessStatus) =>
  targets.includes(event.toStatus) || event.skipped.includes(stage);

/** What the events of one opportunity say about it, over all time. */
interface OpportunityFacts extends Attribution {
  businessStatus: BusinessStatus;
  firstContactAt: number | null;
  replied: boolean;
  lastWonAt: number | null;
}

const byCurrency = <T extends { currency: Currency }>(rows: T[], amount: (row: T) => number) => {
  const totals = new Map<Currency, number>();
  for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? 0) + amount(row));
  return [...totals]
    .map(([currency, totalMinor]) => ({ currency, totalMinor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
};

export function calculateInsights(facts: InsightsFacts): Calculated {
  const inRange = (at: number) => at >= facts.from && at < facts.to;

  const opportunities = new Map<number, OpportunityFacts>();
  for (const event of facts.events) {
    const known = opportunities.get(event.opportunityId) ?? {
      source: event.source,
      category: event.category,
      businessStatus: event.businessStatus,
      firstContactAt: null,
      replied: false,
      lastWonAt: null,
    };
    if (known.firstContactAt === null && reaches(event, CONTACT_REACHED, 'CONTACTED')) {
      known.firstContactAt = event.occurredAt;
    }
    if (reaches(event, REPLY_REACHED, 'REPLIED')) known.replied = true;
    if (event.toStatus === 'WON') known.lastWonAt = event.occurredAt;
    opportunities.set(event.opportunityId, known);
  }

  const metrics = (include: (a: Attribution) => boolean): InsightsMetrics => {
    const events = facts.events.filter((e) => inRange(e.occurredAt) && include(e));
    const cohort = [...opportunities.values()].filter(
      (o) => o.firstContactAt !== null && inRange(o.firstContactAt) && include(o),
    );
    const replied = cohort.filter((o) => o.replied).length;
    const noReply = cohort.filter(
      (o) => !o.replied && NO_REPLY_STATUSES.includes(o.businessStatus),
    ).length;
    const meetingIds = new Set(
      events.filter((e) => reaches(e, ['MEETING'], 'MEETING')).map((e) => e.opportunityId),
    );
    const payments = facts.payments.filter(include);
    return {
      transitions: events.length,
      offersSent: facts.sentDrafts.filter(include).length,
      contacted: cohort.length,
      replies: {
        replied,
        noReply,
        awaiting: cohort.length - replied - noReply,
        rate: replied + noReply === 0 ? null : replied / (replied + noReply),
      },
      meetings: meetingIds.size,
      // D-5: the latest WON event decides the week, and a later correction removes the win.
      wins: [...opportunities.values()].filter(
        (o) =>
          o.businessStatus === 'WON' && o.lastWonAt !== null && inRange(o.lastWonAt) && include(o),
      ).length,
      payments: {
        count: payments.length,
        sums: byCurrency(payments, (p) => p.amountMinor),
      },
    };
  };

  const hasData = (m: InsightsMetrics) =>
    m.transitions + m.offersSent + m.contacted + m.meetings + m.wins + m.payments.count > 0;

  const transitions = new Map<BusinessStatus, number>();
  for (const event of facts.events) {
    if (inRange(event.occurredAt)) {
      transitions.set(event.toStatus, (transitions.get(event.toStatus) ?? 0) + 1);
    }
  }

  const sources = new Map<number, { id: number; name: string; type: string }>();
  for (const a of [...facts.events, ...facts.sentDrafts, ...facts.payments]) {
    if (a.source) sources.set(a.source.id, a.source);
  }
  const sourceGroups = [...sources.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
    .map((s) => ({
      source: { kind: 'source' as const, id: s.id, name: s.name, type: SourceType.parse(s.type) },
      metrics: metrics((a) => a.source?.id === s.id),
    }));
  const manual = {
    source: { kind: 'manual' as const },
    metrics: metrics((a) => a.source === null),
  };

  const categories: (Category | null)[] = [...Category.options, null];
  return {
    totals: metrics(() => true),
    transitionsTo: BusinessStatus.options.flatMap((status) => {
      const n = transitions.get(status) ?? 0;
      return n > 0 ? [{ status, count: n }] : [];
    }),
    bySource: [...sourceGroups, manual].filter((g) => hasData(g.metrics)),
    byCategory: categories
      .map((category) => ({ category, metrics: metrics((a) => a.category === category) }))
      .filter((g) => hasData(g.metrics)),
    work: { minutes: null, costs: [], net: [] },
  };
}
