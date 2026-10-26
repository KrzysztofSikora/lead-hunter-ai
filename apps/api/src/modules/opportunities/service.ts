import {
  ActivityCause,
  ActivityMetadata,
  OfferDraftContent,
  OpportunityAnalysis,
  checkMove,
  ScoreBreakdown,
  TenderFacts,
  upgradeStoredAnalysis,
  type FollowUpRequest,
  type NoteRequest,
  type OfferDraftStatus,
  type PaymentRequest,
  type WorkRequest,
  type OpportunityDetail,
  type OpportunityList,
  type OpportunityListQuery,
  type OpportunitySummary,
  type StatusChangeRequest,
} from '@lead-hunter/contracts';
import type { OfferDraftRow } from '../offers/ports.js';
import type { Clock } from '../shared/clock.js';
import { isDemo } from '../shared/demo.js';
import { instantToWarsawDate, warsawDateToInstant } from '../shared/warsaw-day.js';
import type {
  ActivityRepository,
  ActivityRow,
  AnalysisAttemptRow,
  EvidenceRow,
  OpportunityRepository,
  OpportunityRow,
  PaymentRepository,
  PaymentRow,
  SourceStatusReader,
} from './ports.js';

export interface OpportunityDeps {
  repository: OpportunityRepository;
  activity: ActivityRepository;
  payments: PaymentRepository;
  sourceStatus: SourceStatusReader;
  clock: Clock;
}

export interface OpportunityService {
  list(query: OpportunityListQuery): OpportunityList;
  get(id: number): OpportunityDetail | undefined;
  changeStatus(id: number, request: StatusChangeRequest): ActionResult;
  addNote(id: number, request: NoteRequest): ActionResult;
  setFollowUp(id: number, request: FollowUpRequest): ActionResult;
  addPayment(id: number, request: PaymentRequest): ActionResult;
  addWork(id: number, request: WorkRequest): ActionResult;
}

export type ActionResult =
  | { result: 'ok'; detail: OpportunityDetail }
  | { result: 'not_found' | 'not_allowed' | 'note_required' }
  /** A rule that needs the clock, so the body schema cannot state it. */
  | { result: 'invalid'; path: string; message: string };

const EXCERPT_CHARS = 280;

const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));

/** S-18 D-2: stored facts are parsed on read; invalid ones read as absent. */
function tenderOf(row: OpportunityRow): TenderFacts | null {
  if (row.tenderJson === null) return null;
  try {
    const parsed = TenderFacts.safeParse(JSON.parse(row.tenderJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function sourceFacts(row: OpportunityRow) {
  return {
    type: row.sourceType,
    name: row.sourceName,
    url: row.sourceUrl,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    publishedAt: isoOrNull(row.publishedAt),
    fetchedAt: iso(row.fetchedAt),
    availability: row.availability,
    lastVerifiedAt: isoOrNull(row.lastVerifiedAt),
    tender: tenderOf(row),
  };
}

/**
 * D-8: null while every analysis column is empty and nothing was analysed. A completed
 * INSUFFICIENT_DATA result has empty columns too, but still carries its provider (and DEMO label).
 */
function analysisOf(row: OpportunityRow): OpportunitySummary['analysis'] {
  const { category, evidenceLevel, score, confidence } = row;
  const analysed = row.analysisStatus === 'COMPLETE' && row.analysisProvider !== null;
  if (
    !analysed &&
    category === null &&
    evidenceLevel === null &&
    score === null &&
    confidence === null
  ) {
    return null;
  }
  return { category, evidenceLevel, score, confidence, demo: isDemo(row.analysisProvider) };
}

function base(row: OpportunityRow) {
  return {
    id: row.id,
    businessStatus: row.businessStatus,
    analysisStatus: row.analysisStatus,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    analysis: analysisOf(row),
    prefilter:
      row.prefilterAt === null
        ? null
        : {
            rule: row.prefilterRule,
            matches: row.prefilterMatches ?? 0,
            language: row.language,
            phrase: row.prefilterPhrase,
          },
  };
}

const toSummary = (row: OpportunityRow): OpportunitySummary => ({
  ...base(row),
  source: {
    ...sourceFacts(row),
    excerpt: Array.from(row.snippet).slice(0, EXCERPT_CHARS).join(''),
  },
});

const toEvidence = (row: EvidenceRow): OpportunityDetail['evidence'][number] => ({
  id: row.id,
  type: row.evidenceType,
  sourceFact: row.sourceFact,
  url: row.sourceUrl,
  extractedAt: iso(row.extractedAt),
});

/** Stored JSON was written by this service's own schema; a row that no longer parses reads as absent. */
function parseStored<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  json: string | null,
  upgrade: (value: unknown) => unknown = (value) => value,
): T | null {
  if (json === null) return null;
  try {
    const parsed = schema.safeParse(upgrade(JSON.parse(json)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toActivity(row: ActivityRow): OpportunityDetail['activity'][number] {
  const system = row.actor === 'system';
  const meta = system ? null : parseStored(ActivityMetadata, row.metadataJson);
  return {
    id: row.id,
    type: row.type,
    actor: row.actor,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    reason: row.reason,
    note: row.note,
    cause: system ? parseStored(ActivityCause, row.metadataJson) : null,
    skipped: meta?.skipped ?? [],
    contract: meta?.contract ?? null,
    followUpOn: row.type === 'FOLLOW_UP' ? (meta?.on ?? null) : null,
    followUpCleared: meta?.followUpCleared === true,
    work: row.type === 'WORK' ? { minutes: meta?.minutes ?? null, cost: meta?.cost ?? null } : null,
    occurredAt: iso(row.occurredAt),
  };
}

const toPayment = (row: PaymentRow): OpportunityDetail['payments'][number] => ({
  id: row.id,
  amountMinor: row.amountMinor,
  currency: row.currency,
  paidOn: instantToWarsawDate(new Date(row.paidAt)),
  note: row.note,
  createdAt: iso(row.createdAt),
});

function toLatestAnalysis(row: AnalysisAttemptRow): OpportunityDetail['latestAnalysis'] {
  return {
    status: row.status,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    schemaVersion: row.schemaVersion,
    demo: isDemo(row.provider),
    createdAt: iso(row.createdAt),
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costMicroUsd: row.costMicroUsd,
    reusedFromAnalysisId: row.reusedFromAnalysisId,
    result: parseStored(OpportunityAnalysis, row.resultJson, (value) =>
      upgradeStoredAnalysis(value, row.schemaVersion),
    ),
    breakdown: parseStored(ScoreBreakdown, row.breakdownJson),
    guardNotes: row.guardNotesJson === null ? [] : parseNotes(row.guardNotesJson),
    error: row.error,
  };
}

function parseNotes(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

const toOfferDraft = (row: OfferDraftRow): NonNullable<OpportunityDetail['offerDraft']> => ({
  id: row.id,
  opportunityId: row.opportunityId,
  status: row.status as NonNullable<OpportunityDetail['offerDraft']>['status'],
  language: row.language,
  subject: row.subject,
  message: row.messageMarkdown,
  proposal: row.proposalMarkdown,
  content: parseStored(OfferDraftContent, row.contentJson),
  guardNotes: row.guardNotesJson === null ? [] : parseNotes(row.guardNotesJson),
  provider: row.provider,
  model: row.model,
  promptVersion: row.promptVersion,
  demo: isDemo(row.provider),
  analysed: row.analysed,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  costMicroUsd: row.costMicroUsd,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  statusChangedAt: iso(row.statusChangedAt),
});

const toOfferHistory = (row: OfferDraftRow): OpportunityDetail['offerDraftHistory'][number] => ({
  id: row.id,
  status: row.status as OfferDraftStatus,
  language: row.language,
  subject: row.subject,
  message: row.messageMarkdown,
  proposal: row.proposalMarkdown,
  createdAt: iso(row.createdAt),
  statusChangedAt: iso(row.statusChangedAt),
});

const DAY_MS = 86_400_000;

export function createOpportunityService({
  repository,
  activity,
  payments,
  sourceStatus,
  clock,
}: OpportunityDeps): OpportunityService {
  function detailOf(id: number): OpportunityDetail | undefined {
    const found = repository.get(id);
    if (!found) return undefined;
    return {
      ...base(found.row),
      source: { ...sourceFacts(found.row), snippet: found.row.snippet },
      evidence: found.evidence.map(toEvidence),
      latestAnalysis: found.latestAnalysis ? toLatestAnalysis(found.latestAnalysis) : null,
      followUpOn:
        found.followUpAt === null ? null : instantToWarsawDate(new Date(found.followUpAt)),
      payments: found.payments.map(toPayment),
      activity: found.activity.map(toActivity),
      offerDraft: found.offerDrafts[0] ? toOfferDraft(found.offerDrafts[0]) : null,
      offerDraftHistory: found.offerDrafts.slice(1).map(toOfferHistory),
    };
  }

  function withDetail(id: number): ActionResult {
    const detail = detailOf(id);
    return detail ? { result: 'ok', detail } : { result: 'not_found' };
  }

  return {
    list({ from, to, maxAgeDays, ...rest }) {
      const { rows, total } = repository.list({
        ...rest,
        ...(maxAgeDays !== undefined
          ? { notOlderThan: clock.now().getTime() - maxAgeDays * DAY_MS }
          : {}),
        ...(from !== undefined ? { from: Date.parse(from) } : {}),
        ...(to !== undefined ? { to: Date.parse(to) } : {}),
      });
      return {
        items: rows.map(toSummary),
        page: rest.page,
        pageSize: rest.pageSize,
        total,
        sources: sourceStatus.summary(),
      };
    },
    get: detailOf,
    changeStatus(id, request) {
      const outcome = activity.changeStatus(
        id,
        request.status,
        (from) => checkMove(from, request.status),
        {
          reason: request.status === 'REJECTED' ? request.reason : null,
          note: request.note ?? null,
          metadata: (check, followUpCleared) => {
            const metadata = ActivityMetadata.parse({
              ...(check.skipped.length > 0 ? { skipped: check.skipped } : {}),
              ...(request.status === 'WON' && request.contract
                ? { contract: request.contract }
                : {}),
              ...(followUpCleared ? { followUpCleared: true } : {}),
            });
            return Object.keys(metadata).length === 0 ? null : JSON.stringify(metadata);
          },
          at: clock.now().getTime(),
        },
      );
      return outcome === 'changed' ? withDetail(id) : { result: outcome };
    },
    setFollowUp(id, request) {
      if (request.on !== null && request.on < instantToWarsawDate(clock.now())) {
        return {
          result: 'invalid',
          path: 'on',
          message: 'data follow-upu nie może być z przeszłości',
        };
      }
      const outcome = activity.setFollowUp(
        id,
        request.on === null ? null : warsawDateToInstant(request.on).getTime(),
        {
          metadata: JSON.stringify(ActivityMetadata.parse({ on: request.on })),
          at: clock.now().getTime(),
        },
      );
      return outcome === 'changed' ? withDetail(id) : { result: outcome };
    },
    addPayment(id, request) {
      if (request.paidOn > instantToWarsawDate(clock.now())) {
        return {
          result: 'invalid',
          path: 'paidOn',
          message: 'data wpłaty nie może być z przyszłości',
        };
      }
      const added = payments.add(
        id,
        {
          amountMinor: request.amountMinor,
          currency: request.currency,
          paidAt: warsawDateToInstant(request.paidOn).getTime(),
          note: request.note ?? null,
        },
        clock.now().getTime(),
      );
      return added ? withDetail(id) : { result: 'not_found' };
    },
    addWork(id, request) {
      const metadata = ActivityMetadata.parse({
        ...(request.minutes !== undefined ? { minutes: request.minutes } : {}),
        ...(request.cost !== undefined ? { cost: request.cost } : {}),
      });
      return activity.addWork(
        id,
        JSON.stringify(metadata),
        request.note ?? null,
        clock.now().getTime(),
      )
        ? withDetail(id)
        : { result: 'not_found' };
    },
    addNote(id, request) {
      return activity.addNote(id, request.text, clock.now().getTime())
        ? withDetail(id)
        : { result: 'not_found' };
    },
  };
}
