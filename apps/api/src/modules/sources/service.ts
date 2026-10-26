import {
  BzpConfig,
  SourceFilter,
  TedConfig,
  TenderFacts,
  type CreateSourceRequest,
  type SourceKind,
  type Source,
  type SourceHealth,
  type SourceList,
  type TenderSettings,
  type SourceRunResult,
  type UpdateSourceRequest,
} from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';
import { canonicalizeUrl, contentHash, normaliseSnippet } from '../signals/identity.js';
import { ingest } from '../signals/ingest.js';
import type { SignalRepository } from '../signals/ports.js';
import { MANUAL_ACCESS_NOTE, PRESETS, WITHDRAWN_PRESETS } from './presets.js';
import { applySourceFilter, readFilter } from './source-filter.js';
import type {
  AdapterOutcome,
  AttemptOutcome,
  RunContext,
  FeedItem,
  SourceAdapter,
  SourceAdapters,
  SourceRecord,
  SourceRepository,
} from './ports.js';

/** D-3: how many item keys the cursor remembers. */
export const CURSOR_MAX_KEYS = 500;
/** D-21: the shortest gap between two checks of one source. */
export const CHECK_COOLDOWN_MS = 60_000;

/** S-18 D-9: how far back a run looks before its last success, and on a first run. */
export const SINCE_OVERLAP_MS = 24 * 3_600_000;
export const FIRST_RUN_LOOKBACK_MS = 3 * 24 * 3_600_000;

/** Lesson: a date outside this range is a parse error, never stored. */
const DATE_MIN = Date.UTC(2000, 0, 1);
const DATE_MAX = Date.UTC(2100, 0, 1);

/** A source's own wait is capped here, so a hostile `Retry-After` cannot lock it for years. */
export const MAX_SOURCE_BACKOFF_MS = 7 * 24 * 3_600_000;

export interface SourceDeps {
  repository: SourceRepository;
  signals: SignalRepository;
  /** S-18 D-1: one adapter per source type. */
  adapters: SourceAdapters;
  clock: Clock;
  minIntervalMs: number;
  /** Called after a run stored new signals, so analysis starts without waiting for its timer. */
  onSignalCreated?: () => void;
  /** Source id, host, reason and counts only; never item text (FR-24 AC2). */
  logger?: { info(message: string): void; warn(message: string): void };
}

export type Refusal =
  { kind: 'not_found' } | { kind: 'disabled' } | { kind: 'too_soon'; nextAllowedAt: string };

export type CreateOutcome =
  | { kind: 'created'; source: Source }
  | { kind: 'exists' }
  | { kind: 'unknown_preset' }
  | { kind: 'invalid'; issues: string[] };

export type UpdateOutcome =
  | { kind: 'updated'; source: Source }
  | { kind: 'not_found' }
  | { kind: 'not_tender_source' }
  | { kind: 'invalid'; issues: string[] };

export type RunOutcome = { kind: 'done'; result: SourceRunResult } | Refusal;
export type CheckOutcome = { kind: 'done'; health: SourceHealth } | Refusal;

export interface SourceService {
  list(): SourceList;
  create(request: CreateSourceRequest): CreateOutcome;
  /**
   * D-13: `filter` replaces the whole filter; S-18 D-7: `tender` the tender config. Both are
   * validated before they are stored.
   */
  update(id: number, patch: UpdateSourceRequest): UpdateOutcome;
  run(id: number, context?: RunContext): Promise<RunOutcome>;
  check(id: number): Promise<CheckOutcome>;
  /**
   * AC3: every enabled source in turn; one that fails or throws never stops the next.
   * `shouldContinue` is asked before each source; `false` ends the cycle early (lost lock, D-2).
   */
  runEnabled(
    context?: RunContext & { shouldContinue?: () => boolean },
  ): Promise<{ id: number; name: string; outcome: RunOutcome }[]>;
}

const iso = (ms: number): string => new Date(ms).toISOString();

function parseConfigUrl(record: SourceRecord): string {
  if (record.type !== 'rss') {
    // S-18: a tender source's endpoint is fixed; its preset holds it for display.
    return PRESETS.find((candidate) => candidate.type === record.type)?.url ?? '';
  }
  try {
    const config = JSON.parse(record.configJson) as { url?: unknown };
    return typeof config.url === 'string' ? config.url : '';
  } catch {
    return '';
  }
}

function parseConfig(record: SourceRecord): Record<string, unknown> {
  try {
    const config: unknown = JSON.parse(record.configJson);
    return typeof config === 'object' && config !== null ? (config as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** S-18 D-7: the editable part of a tender source's config; null for a feed. */
function tenderSettings(record: SourceRecord): TenderSettings | null {
  if (record.type === 'bzp') {
    const parsed = BzpConfig.safeParse(parseConfig(record));
    return parsed.success ? { cpvPrefixes: parsed.data.cpvPrefixes, countries: null } : null;
  }
  if (record.type === 'ted') {
    const parsed = TedConfig.safeParse(parseConfig(record));
    return parsed.success ? parsed.data : null;
  }
  return null;
}

/** S-18 D-2: facts are validated and bounded before they are stored; invalid ones are dropped. */
function checkTender(item: FeedItem, warn: (field: string) => void): string | null {
  if (item.tender === undefined) return null;
  const inRange = (ms: number | null): ms is number =>
    ms !== null && Number.isFinite(ms) && ms >= DATE_MIN && ms < DATE_MAX;
  const facts = item.tender;
  const deadline = facts.deadlineAt === null ? NaN : Date.parse(facts.deadlineAt);
  const bounded = {
    ...facts,
    deadlineAt: inRange(Number.isNaN(deadline) ? null : deadline) ? facts.deadlineAt : null,
  };
  const parsed = TenderFacts.safeParse(bounded);
  if (!parsed.success) {
    warn(parsed.error.issues[0]?.path.join('.') || 'tender');
    return null;
  }
  return JSON.stringify(parsed.data);
}

/** Bound on an adapter's in-day position kept in the cursor (a TED token is a short string). */
const RESUME_AT_MAX = 2_000;

function readCursor(record: SourceRecord): {
  seen: string[];
  resumeFrom: number | null;
  resumeAt: string | null;
} {
  if (record.cursorJson === null) return { seen: [], resumeFrom: null, resumeAt: null };
  try {
    const cursor = JSON.parse(record.cursorJson) as {
      seen?: unknown;
      resumeFrom?: unknown;
      resumeAt?: unknown;
    };
    return {
      seen: Array.isArray(cursor.seen)
        ? cursor.seen.filter((key): key is string => typeof key === 'string')
        : [],
      // Lesson: a stored date is bounded before it is used.
      resumeFrom:
        typeof cursor.resumeFrom === 'number' &&
        cursor.resumeFrom >= DATE_MIN &&
        cursor.resumeFrom < DATE_MAX
          ? cursor.resumeFrom
          : null,
      resumeAt:
        typeof cursor.resumeAt === 'string' && cursor.resumeAt.length <= RESUME_AT_MAX
          ? cursor.resumeAt
          : null,
    };
  } catch {
    return { seen: [], resumeFrom: null, resumeAt: null };
  }
}

export function createSourceService({
  repository,
  signals,
  adapters,
  clock,
  minIntervalMs,
  onSignalCreated,
  logger,
}: SourceDeps): SourceService {
  const toSource = (record: SourceRecord): Source => {
    const offered = PRESETS.find((candidate) => candidate.id === record.presetId);
    const preset =
      offered ?? WITHDRAWN_PRESETS.find((candidate) => candidate.id === record.presetId);
    return {
      id: record.id,
      type: record.type,
      name: record.name,
      url: parseConfigUrl(record),
      tender: tenderSettings(record),
      presetId: record.presetId,
      accessNote: preset?.accessNote ?? MANUAL_ACCESS_NOTE,
      termsUrl: preset?.termsUrl ?? null,
      enabled: record.enabled,
      filter: readFilter(record.filterJson).filter,
      presetWithdrawn: preset !== undefined && offered === undefined,
      lastAttemptAt: record.lastAttemptAt === null ? null : iso(record.lastAttemptAt),
      lastSuccessAt: record.lastSuccessAt === null ? null : iso(record.lastSuccessAt),
      lastError:
        record.lastError === null
          ? null
          : {
              reason: record.lastError.reason,
              ...(record.lastError.httpStatus === undefined
                ? {}
                : { httpStatus: record.lastError.httpStatus }),
              at: iso(record.lastError.at),
            },
      nextAllowedAt: record.nextAllowedAt === null ? null : iso(record.nextAllowedAt),
    };
  };

  const logHost = (record: SourceRecord): string => {
    const url = parseConfigUrl(record);
    return URL.canParse(url) ? new URL(url).host : 'unknown';
  };

  const refusal = (claim: { reason: Refusal['kind']; nextAllowedAt?: number }): Refusal =>
    claim.reason === 'too_soon'
      ? { kind: 'too_soon', nextAllowedAt: iso(claim.nextAllowedAt ?? clock.now().getTime()) }
      : ({ kind: claim.reason } as Refusal);

  /** The failure half of a run or check: stored as the source's last error. */
  const recordFailure = (
    id: number,
    outcome: Extract<AdapterOutcome, { ok: false }>,
    at: number,
  ): { attempt: AttemptOutcome; nextAllowedAt: number | undefined } => {
    const attempt: AttemptOutcome = {
      ok: false,
      reason: outcome.reason,
      ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
    };
    // A-03: never sooner than the source asked, never sooner than the configured interval.
    const nextAllowedAt =
      outcome.retryAfterMs === undefined
        ? undefined
        : at + Math.min(Math.max(outcome.retryAfterMs, minIntervalMs), MAX_SOURCE_BACKOFF_MS);
    repository.finishAttempt(id, attempt, at, nextAllowedAt);
    return { attempt, nextAllowedAt };
  };

  async function run(id: number, context?: RunContext): Promise<RunOutcome> {
    const record = repository.get(id);
    if (!record) return { kind: 'not_found' };
    const startedAt = clock.now().getTime();
    const claim = repository.claimRun(id, startedAt, minIntervalMs);
    if (!claim.ok) return refusal(claim);

    const runId = repository.startRun(id, startedAt, context);
    const counts = { fetched: 0, new: 0, duplicates: 0, failed: 0, filtered: 0 };
    const fail = (outcome: Extract<AdapterOutcome, { ok: false }>): RunOutcome => {
      const at = clock.now().getTime();
      const { nextAllowedAt } = recordFailure(id, outcome, at);
      const error = {
        reason: outcome.reason,
        ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
      };
      repository.finishRun(runId, { status: 'failed', at, ...counts, error });
      logger?.warn(`source ${id} ${logHost(record)}: failed ${outcome.reason}`);
      return {
        kind: 'done',
        result: {
          status: 'failed',
          ...counts,
          error,
          nextAllowedAt: iso(nextAllowedAt ?? claim.nextAllowedAt ?? at),
        },
      };
    };

    try {
      // An unknown stored type is a failure, never a silent skip (S-18 D-1).
      const adapter = adapters[record.type] as SourceAdapter | undefined;
      if (!adapter) return fail({ ok: false, reason: 'internal' });
      const config = JSON.parse(record.configJson) as unknown;
      const checked = adapter.validateConfig(config);
      if (!checked.ok) return fail({ ok: false, reason: 'internal' });
      // D-9: a window that overlaps the last success; the cursor drops what it already saw.
      // A truncated run leaves a gap; the next one starts at the gap, not after the last success.
      const previous = readCursor(record);
      const since =
        previous.resumeFrom ??
        (record.lastSuccessAt === null
          ? startedAt - FIRST_RUN_LOOKBACK_MS
          : record.lastSuccessAt - SINCE_OVERLAP_MS);
      const outcome = await adapter.discover(checked.config, {
        since,
        ...(previous.resumeFrom !== null && previous.resumeAt !== null
          ? { resumeAt: previous.resumeAt }
          : {}),
      });
      if (!outcome.ok) return fail(outcome);
      const truncated = outcome.truncated === true;

      const stored = readFilter(record.filterJson);
      if (stored.invalid) logger?.warn(`source ${id} ${logHost(record)}: source_filter_invalid`);
      const filter = stored.filter;
      const seen = new Set(previous.seen);
      const remembered: string[] = [];
      counts.fetched = outcome.items.length + outcome.skipped;
      counts.failed = outcome.skipped;
      for (const item of outcome.items) {
        if (item.key !== null && seen.has(item.key)) {
          counts.duplicates += 1;
          continue;
        }
        try {
          const tenderJson = checkTender(item, (field) =>
            logger?.warn(`source ${id} ${logHost(record)}: tender_invalid ${field}`),
          );
          const snippet = normaliseSnippet(item.text);
          let canonicalUrl: string | null = null;
          if (item.url !== null) {
            try {
              canonicalUrl = canonicalizeUrl(item.url);
            } catch {
              canonicalUrl = null;
            }
          }
          const at = clock.now().getTime();
          const verdict = filter.enabled
            ? applySourceFilter(filter, item.title, snippet)
            : ({ pass: true } as const);
          const result = signals.transaction((tx) => {
            const ingested = ingest(tx, {
              sourceType: record.type,
              sourceId: id,
              externalId: item.key,
              sourceUrl: item.url,
              canonicalUrl,
              title: item.title,
              snippet,
              publishedAt: item.publishedAt,
              contentHash: contentHash(snippet),
              at,
              sourceFact: snippet !== '' ? snippet : (item.url ?? ''),
              jobRunId: runId,
              tenderJson,
            });
            // D-4: only a new opportunity is rejected; a duplicate keeps whatever status it has.
            if (ingested.result === 'created' && !verdict.pass) {
              tx.rejectBySourceFilter(ingested.opportunityId, verdict.phrase, at);
            }
            return ingested;
          });
          if (result.result === 'created') {
            counts.new += 1;
            if (!verdict.pass) counts.filtered += 1;
          } else counts.duplicates += 1;
          if (item.key !== null) remembered.push(item.key);
        } catch (error) {
          counts.failed += 1;
          logger?.warn(
            `source ${id} ${logHost(record)}: item failed ${error instanceof Error ? error.name : 'error'}`,
          );
        }
      }
      const kept = [...remembered, ...seen].slice(0, CURSOR_MAX_KEYS);
      repository.saveCursor(
        id,
        JSON.stringify({
          seen: kept,
          ...(truncated ? { resumeFrom: outcome.resumeFrom ?? since } : {}),
          ...(truncated &&
          outcome.resumeFrom !== undefined &&
          outcome.resumeAt !== undefined &&
          outcome.resumeAt.length <= RESUME_AT_MAX
            ? { resumeAt: outcome.resumeAt }
            : {}),
        }),
      );

      const finishedAt = clock.now().getTime();
      if (truncated) logger?.warn(`source ${id} ${logHost(record)}: page_cap`);
      const status = counts.failed > 0 || truncated ? 'partial' : 'ok';
      repository.finishRun(runId, { status, at: finishedAt, ...counts });
      repository.finishAttempt(id, { ok: true }, finishedAt);
      logger?.info(
        `source ${id} ${logHost(record)}: ${status} fetched ${counts.fetched} new ${counts.new} filtered ${counts.filtered} duplicates ${counts.duplicates} failed ${counts.failed}`,
      );
      if (counts.new > counts.filtered) onSignalCreated?.();
      return {
        kind: 'done',
        result: {
          status,
          ...counts,
          nextAllowedAt: iso(claim.nextAllowedAt ?? finishedAt),
        },
      };
    } catch (error) {
      // Plan-review #4: an unexpected exception is recorded, never left as a `running` row.
      logger?.warn(
        `source ${id} ${logHost(record)}: internal error ${error instanceof Error ? error.name : 'error'}`,
      );
      return fail({ ok: false, reason: 'internal' });
    }
  }

  async function check(id: number): Promise<CheckOutcome> {
    const record = repository.get(id);
    if (!record) return { kind: 'not_found' };
    const now = clock.now().getTime();
    const claim = repository.claimCheck(id, now, CHECK_COOLDOWN_MS);
    if (!claim.ok) return refusal(claim);

    let outcome: AdapterOutcome;
    try {
      const adapter = adapters[record.type] as SourceAdapter | undefined;
      const checked = adapter?.validateConfig(JSON.parse(record.configJson) as unknown);
      outcome =
        adapter && checked?.ok
          ? await adapter.healthCheck(checked.config)
          : { ok: false, reason: 'internal' };
    } catch {
      outcome = { ok: false, reason: 'internal' };
    }
    const at = clock.now().getTime();
    if (outcome.ok) {
      repository.finishAttempt(id, { ok: true }, at);
      return {
        kind: 'done',
        health: { ok: true, checkedAt: iso(at), nextAllowedAt: iso(claim.nextAllowedAt ?? at) },
      };
    }
    const { attempt, nextAllowedAt } = recordFailure(id, outcome, at);
    return {
      kind: 'done',
      health: {
        ok: false,
        checkedAt: iso(at),
        error: {
          reason: outcome.reason,
          ...(attempt.ok || attempt.httpStatus === undefined
            ? {}
            : { httpStatus: attempt.httpStatus }),
        },
        nextAllowedAt: iso(nextAllowedAt ?? claim.nextAllowedAt ?? at),
      },
    };
  }

  return {
    list() {
      return { items: repository.list().map(toSource), presets: [...PRESETS] };
    },

    create(request) {
      let name: string;
      let config: Record<string, unknown>;
      let type: SourceKind = 'rss';
      let presetId: string | null = null;
      let filterJson: string | null = null;
      if ('preset' in request) {
        const preset = PRESETS.find((candidate) => candidate.id === request.preset);
        if (!preset) return { kind: 'unknown_preset' };
        ({ name, type } = preset);
        // S-18 D-7: a tender preset carries the default CPV prefixes (and countries) instead of a URL.
        config =
          preset.tender === null
            ? { url: preset.url }
            : {
                cpvPrefixes: preset.tender.cpvPrefixes,
                ...(preset.tender.countries ? { countries: preset.tender.countries } : {}),
              };
        presetId = preset.id;
        filterJson = JSON.stringify(preset.filter);
      } else {
        ({ name } = request);
        config = { url: request.url };
      }
      const checked = (adapters[type] as SourceAdapter | undefined)?.validateConfig(config);
      if (!checked) return { kind: 'invalid', issues: ['Brak adaptera dla tego typu źródła.'] };
      if (!checked.ok) return { kind: 'invalid', issues: checked.issues };
      const inserted = repository.insert({
        type,
        name,
        configJson: JSON.stringify(checked.config),
        configKey: checked.key,
        presetId,
        filterJson,
        at: clock.now().getTime(),
      });
      return inserted ? { kind: 'created', source: toSource(inserted) } : { kind: 'exists' };
    },

    update(id, patch) {
      const record = repository.get(id);
      if (!record) return { kind: 'not_found' };
      // Lesson: validate before storing, not only on read.
      const filter = patch.filter === undefined ? undefined : SourceFilter.parse(patch.filter);
      let configJson: string | undefined;
      if (patch.tender !== undefined) {
        if (record.type === 'rss') return { kind: 'not_tender_source' };
        const checked =
          record.type === 'bzp'
            ? BzpConfig.safeParse({
                cpvPrefixes: patch.tender.cpvPrefixes,
                ...(patch.tender.countries ? { countries: patch.tender.countries } : {}),
              })
            : TedConfig.safeParse({
                cpvPrefixes: patch.tender.cpvPrefixes,
                countries: patch.tender.countries ?? tenderSettings(record)?.countries,
              });
        if (!checked.success) {
          return { kind: 'invalid', issues: checked.error.issues.map((issue) => issue.message) };
        }
        configJson = JSON.stringify({ ...parseConfig(record), ...checked.data });
      }
      const updated = repository.update(
        id,
        {
          ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
          ...(filter === undefined ? {} : { filterJson: JSON.stringify(filter) }),
          ...(configJson === undefined ? {} : { configJson }),
        },
        clock.now().getTime(),
      );
      return updated ? { kind: 'updated', source: toSource(updated) } : { kind: 'not_found' };
    },

    run,
    check,

    async runEnabled(context) {
      const results: { id: number; name: string; outcome: RunOutcome }[] = [];
      for (const record of repository.list().filter((candidate) => candidate.enabled)) {
        if (context?.shouldContinue && !context.shouldContinue()) break;
        let outcome: RunOutcome;
        try {
          outcome = await run(
            record.id,
            context && { parentRunId: context.parentRunId, trigger: context.trigger },
          );
        } catch (error) {
          logger?.warn(
            `source ${record.id}: run threw ${error instanceof Error ? error.name : 'error'}`,
          );
          outcome = {
            kind: 'done',
            result: {
              status: 'failed',
              fetched: 0,
              new: 0,
              duplicates: 0,
              failed: 0,
              filtered: 0,
              error: { reason: 'internal' },
              nextAllowedAt: iso(clock.now().getTime()),
            },
          };
        }
        results.push({ id: record.id, name: record.name, outcome });
      }
      return results;
    },
  };
}
