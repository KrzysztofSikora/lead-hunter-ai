import {
  BountyFacts,
  GithubSearchConfig,
  SourceFilter,
  type CreateSourceRequest,
  type OperatorProfile,
  type Source,
  type SourceKind,
  type SourcePreset,
  type SourceHealth,
  type SourceList,
  type SourceRunResult,
  type UpdateSourceRequest,
} from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';
import { canonicalizeUrl, contentHash, normaliseSnippet } from '../signals/identity.js';
import { ingest } from '../signals/ingest.js';
import type { SignalRepository } from '../signals/ports.js';
import { languagesFromProfile } from './github-languages.js';
import { GITHUB_BOUNTY_LABELS, MANUAL_ACCESS_NOTE, PRESETS, WITHDRAWN_PRESETS } from './presets.js';
import { applySourceFilter, readFilter } from './source-filter.js';
import type {
  AdapterOutcome,
  AttemptOutcome,
  RunContext,
  SourceAdapters,
  SourceRecord,
  SourceRepository,
} from './ports.js';

/** D-3: how many item keys the cursor remembers. */
export const CURSOR_MAX_KEYS = 500;
/** D-21: the shortest gap between two checks of one source. */
export const CHECK_COOLDOWN_MS = 60_000;

/** A source's own wait is capped here, so a hostile `Retry-After` cannot lock it for years. */
export const MAX_SOURCE_BACKOFF_MS = 7 * 24 * 3_600_000;

export interface SourceDeps {
  repository: SourceRepository;
  signals: SignalRepository;
  /** S-19 D-1: one adapter per source type; a type without one fails with `internal`. */
  adapters: SourceAdapters;
  clock: Clock;
  minIntervalMs: number;
  /** S-19 D-4: the operator's profile, for the languages of the GitHub preset. */
  profile?: { get(): Pick<OperatorProfile, 'skills' | 'preferredTechnologies'> };
  /** Called after a run stored new signals, so analysis starts without waiting for its timer. */
  onSignalCreated?: () => void;
  /** Source id, host, reason and counts only; never item text (FR-24 AC2). */
  logger?: { info(message: string): void; warn(message: string): void };
}

export type Refusal =
  { kind: 'not_found' } | { kind: 'disabled' } | { kind: 'too_soon'; nextAllowedAt: string };

export type UpdateOutcome =
  { kind: 'updated'; source: Source } | { kind: 'not_found' } | { kind: 'not_github_source' };

export type CreateOutcome =
  | { kind: 'created'; source: Source }
  | { kind: 'exists' }
  | { kind: 'unknown_preset' }
  | { kind: 'invalid'; issues: string[] };

export type RunOutcome = { kind: 'done'; result: SourceRunResult } | Refusal;
export type CheckOutcome = { kind: 'done'; health: SourceHealth } | Refusal;

export interface SourceService {
  list(): SourceList;
  create(request: CreateSourceRequest): CreateOutcome;
  /** D-13: `filter` replaces the whole filter; it is validated before it is stored. */
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

/** Plan-review 9: the endpoint a bounty source reads, shown in place of a feed URL. */
const ENDPOINTS: Partial<Record<SourceKind, string>> = {
  github: 'https://api.github.com/search/issues',
  opire: 'https://api.opire.dev/rewards',
};

function parseConfigUrl(record: SourceRecord): string {
  const endpoint = ENDPOINTS[record.type];
  if (endpoint !== undefined) return endpoint;
  try {
    const config = JSON.parse(record.configJson) as { url?: unknown };
    return typeof config.url === 'string' ? config.url : '';
  } catch {
    return '';
  }
}

function readGithub(record: SourceRecord): GithubSearchConfig | null {
  if (record.type !== 'github') return null;
  try {
    const parsed = GithubSearchConfig.safeParse(JSON.parse(record.configJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function readSeen(record: SourceRecord): string[] {
  if (record.cursorJson === null) return [];
  try {
    const cursor = JSON.parse(record.cursorJson) as { seen?: unknown };
    return Array.isArray(cursor.seen)
      ? cursor.seen.filter((key): key is string => typeof key === 'string')
      : [];
  } catch {
    return [];
  }
}

export function createSourceService({
  repository,
  signals,
  adapters,
  clock,
  minIntervalMs,
  profile,
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
      presetId: record.presetId,
      accessNote: preset?.accessNote ?? MANUAL_ACCESS_NOTE,
      termsUrl: preset?.termsUrl ?? null,
      enabled: record.enabled,
      filter: readFilter(record.filterJson).filter,
      github: readGithub(record),
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

  /** Lesson: validate before storing. An invalid fact is dropped, the signal is kept. */
  const readBounty = (
    item: { bounty?: unknown },
    id: number,
    record: SourceRecord,
  ): string | null => {
    if (item.bounty === undefined) return null;
    const parsed = BountyFacts.safeParse(item.bounty);
    if (parsed.success) return JSON.stringify(parsed.data);
    logger?.warn(`source ${id} ${logHost(record)}: bounty_facts_invalid`);
    return null;
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
      const adapter = adapters[record.type];
      if (!adapter) return fail({ ok: false, reason: 'internal' });
      const config = JSON.parse(record.configJson) as unknown;
      const checked = adapter.validateConfig(config);
      if (!checked.ok) return fail({ ok: false, reason: 'internal' });
      const seen = new Set(readSeen(record));
      const outcome = await adapter.discover(checked.config, { seen });
      if (!outcome.ok) return fail(outcome);

      const stored = readFilter(record.filterJson);
      if (stored.invalid) logger?.warn(`source ${id} ${logHost(record)}: source_filter_invalid`);
      const filter = stored.filter;
      const remembered: string[] = outcome.checkedKeys ? [...outcome.checkedKeys] : [];
      counts.fetched = outcome.items.length + outcome.skipped;
      counts.failed = outcome.skipped;
      for (const item of outcome.items) {
        if (item.key !== null && seen.has(item.key)) {
          counts.duplicates += 1;
          continue;
        }
        try {
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
          const bounty = readBounty(item, id, record);
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
              bountyJson: bounty,
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
      repository.saveCursor(id, JSON.stringify({ seen: kept }));

      const finishedAt = clock.now().getTime();
      const status = counts.failed > 0 || outcome.truncated ? 'partial' : 'ok';
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

  /** S-19: a preset of another type brings its own config, checked by that type's adapter. */
  const createTyped = (preset: SourcePreset): CreateOutcome => {
    const adapter = adapters[preset.type];
    if (!adapter) return { kind: 'invalid', issues: ['To źródło jest niedostępne.'] };
    const config =
      preset.type === 'github'
        ? {
            labels: [...GITHUB_BOUNTY_LABELS],
            languages: profile ? languagesFromProfile(profile.get()) : [],
          }
        : {};
    const checked = adapter.validateConfig(config);
    if (!checked.ok) return { kind: 'invalid', issues: checked.issues };
    const inserted = repository.insert({
      type: preset.type,
      name: preset.name,
      configJson: JSON.stringify(checked.config),
      configKey: checked.key,
      presetId: preset.id,
      filterJson: JSON.stringify(preset.filter),
      at: clock.now().getTime(),
    });
    return inserted ? { kind: 'created', source: toSource(inserted) } : { kind: 'exists' };
  };

  async function check(id: number): Promise<CheckOutcome> {
    const record = repository.get(id);
    if (!record) return { kind: 'not_found' };
    const now = clock.now().getTime();
    const claim = repository.claimCheck(id, now, CHECK_COOLDOWN_MS);
    if (!claim.ok) return refusal(claim);

    let outcome: AdapterOutcome;
    try {
      const adapter = adapters[record.type];
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
      let url: string;
      let presetId: string | null = null;
      let filterJson: string | null = null;
      if ('preset' in request) {
        const preset = PRESETS.find((candidate) => candidate.id === request.preset);
        if (!preset) return { kind: 'unknown_preset' };
        if (preset.type !== 'rss') return createTyped(preset);
        ({ name, url } = preset);
        presetId = preset.id;
        filterJson = JSON.stringify(preset.filter);
      } else {
        ({ name, url } = request);
      }
      const adapter = adapters.rss;
      if (!adapter) return { kind: 'invalid', issues: ['Źródła RSS są niedostępne.'] };
      const checked = adapter.validateConfig({ url });
      if (!checked.ok) return { kind: 'invalid', issues: checked.issues };
      const inserted = repository.insert({
        type: 'rss',
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
      // Lesson: validate before storing, not only on read.
      const filter = patch.filter === undefined ? undefined : SourceFilter.parse(patch.filter);
      const github =
        patch.github === undefined ? undefined : GithubSearchConfig.parse(patch.github);
      if (github !== undefined) {
        const existing = repository.get(id);
        if (!existing) return { kind: 'not_found' };
        if (existing.type !== 'github') return { kind: 'not_github_source' };
      }
      const updated = repository.update(
        id,
        {
          ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
          ...(filter === undefined ? {} : { filterJson: JSON.stringify(filter) }),
          ...(github === undefined ? {} : { configJson: JSON.stringify(github) }),
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
