import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn as AnyColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  createdAt: integer('created_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
});

export const operatorProfile = sqliteTable(
  'operator_profile',
  {
    id: integer('id').primaryKey(),
    schemaVersion: integer('schema_version').notNull(),
    /** The whole `OperatorProfile` as JSON (D-1). */
    data: text('data', { mode: 'json' }).notNull(),
    isExample: integer('is_example', { mode: 'boolean' }).notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [check('single_row', sql`${table.id} = 1`)],
);

/** S-10 D-1: one row per configured source; `configJson` is owned by its adapter. */
export const sources = sqliteTable(
  'sources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    name: text('name').notNull(),
    configJson: text('config_json').notNull(),
    /** The adapter's identity of a config (RSS: canonical feed URL); one source per key. */
    configKey: text('config_key').notNull().unique(),
    presetId: text('preset_id'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /** D-3: adapter-owned JSON, e.g. `{ seen: [...] }`. */
    cursorJson: text('cursor_json'),
    /** D-5: the earliest time the next attempt may start (UTC epoch ms). */
    nextAllowedAt: integer('next_allowed_at'),
    lastAttemptAt: integer('last_attempt_at'),
    lastSuccessAt: integer('last_success_at'),
    lastErrorReason: text('last_error_reason'),
    lastErrorStatus: integer('last_error_status'),
    lastErrorAt: integer('last_error_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('sources_enabled_idx').on(table.enabled)],
);

/** S-10 D-2: one row per source run; S-12 adds the remaining FR-18 counters. */
export const jobRuns = sqliteTable(
  'job_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobType: text('job_type').notNull(),
    sourceId: integer('source_id').references(() => sources.id),
    status: text('status').notNull(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    fetched: integer('fetched').notNull().default(0),
    new: integer('new').notNull().default(0),
    duplicates: integer('duplicates').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    errorReason: text('error_reason'),
    errorStatus: integer('error_status'),
  },
  (table) => [index('job_runs_source_idx').on(table.sourceId, table.startedAt)],
);

/** D-3: the source is a text column on signals created before `sources` (S-10). */
export const rawSignals = sqliteTable(
  'raw_signals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceType: text('source_type').notNull(),
    /** S-10 D-1: null for manual imports. */
    sourceId: integer('source_id').references(() => sources.id),
    /** S-10 D-4: the feed entry's own key (`guid`, else `link`); null for manual imports. */
    externalId: text('external_id'),
    /** The URL as the operator pasted it (trimmed). */
    sourceUrl: text('source_url'),
    /** Identity form of the URL (D-2); never shown as the source. */
    canonicalUrl: text('canonical_url'),
    title: text('title').notNull(),
    snippet: text('snippet').notNull(),
    publishedAt: integer('published_at'),
    fetchedAt: integer('fetched_at').notNull(),
    contentHash: text('content_hash'),
    availability: text('availability').notNull(),
    lastVerifiedAt: integer('last_verified_at'),
  },
  (table) => [index('raw_signals_content_hash_idx').on(table.contentHash)],
);

export const opportunities = sqliteTable(
  'opportunities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    primarySignalId: integer('primary_signal_id')
      .notNull()
      .unique()
      .references(() => rawSignals.id),
    businessStatus: text('business_status').notNull().default('NEW'),
    analysisStatus: text('analysis_status').notNull().default('PENDING'),
    category: text('category'),
    evidenceLevel: text('evidence_level'),
    score: integer('score'),
    confidence: text('confidence'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastVerifiedAt: integer('last_verified_at'),
    /** D-8: pre-filter outcome and the analysis columns that list filters read as plain SQL. */
    prefilterRule: text('prefilter_rule'),
    prefilterMatches: integer('prefilter_matches'),
    prefilterAt: integer('prefilter_at'),
    language: text('language'),
    analysisProvider: text('analysis_provider'),
    industry: text('industry'),
    workMode: text('work_mode'),
    /** `,PL,DE,` so a country is matched with LIKE '%,PL,%'. */
    countries: text('countries'),
    /** The budget the source stated, never a model's price (plan-review #8). */
    amountMaxMinor: integer('amount_max_minor'),
    amountCurrency: text('amount_currency'),
    /** D-10: the next analysis must call the provider instead of reusing a stored result. */
    analysisForce: integer('analysis_force').notNull().default(0),
    /** S-08 D-5, D-7: Warsaw midnight (UTC epoch ms) of the one current follow-up day. */
    followUpAt: integer('follow_up_at'),
  },
  (table) => [
    check('score_range', sql`${table.score} IS NULL OR ${table.score} BETWEEN 0 AND 100`),
    index('opportunities_business_status_idx').on(table.businessStatus),
    index('opportunities_score_idx').on(table.score),
    index('opportunities_created_at_idx').on(table.createdAt),
    index('opportunities_follow_up_idx').on(table.followUpAt),
  ],
);

/** D-8: one row per analysis attempt; the latest row is the current analysis. */
export const analyses = sqliteTable(
  'analyses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    opportunityId: integer('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    resultJson: text('result_json'),
    breakdownJson: text('breakdown_json'),
    guardNotesJson: text('guard_notes_json'),
    /** A reason (issue paths or provider message), never source text. */
    error: text('error'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    /** D-2: micro-USD, 0 for an unpaid provider, null when usage or price is unknown. */
    costMicroUsd: integer('cost_micro_usd'),
    /** D-4: set when the result was copied from an earlier analysis instead of a provider call. */
    reusedFromAnalysisId: integer('reused_from_analysis_id').references(
      (): AnyColumn => analyses.id,
      { onDelete: 'set null' },
    ),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('analyses_opportunity_idx').on(table.opportunityId, table.id),
    index('analyses_created_at_idx').on(table.createdAt),
  ],
);

export const opportunityEvidence = sqliteTable(
  'opportunity_evidence',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    opportunityId: integer('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    rawSignalId: integer('raw_signal_id')
      .notNull()
      .references(() => rawSignals.id),
    evidenceType: text('evidence_type').notNull(),
    sourceFact: text('source_fact').notNull(),
    sourceUrl: text('source_url'),
    canonicalUrl: text('canonical_url'),
    contentHash: text('content_hash'),
    extractedAt: integer('extracted_at').notNull(),
  },
  (table) => [index('opportunity_evidence_opportunity_idx').on(table.opportunityId)],
);

/** S-06 D-4: status changes and notes of one opportunity; S-08 adds event types. */
export const activityEvents = sqliteTable(
  'activity_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    opportunityId: integer('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    actor: text('actor').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    reason: text('reason'),
    /** Operator text; never logged. */
    note: text('note'),
    /** The cause of a system move (D-8). */
    metadataJson: text('metadata_json'),
    occurredAt: integer('occurred_at').notNull(),
  },
  (table) => [index('activity_events_opportunity_idx').on(table.opportunityId, table.occurredAt)],
);

/** D-14: one value belongs to one opportunity; the first to see it owns it. */
export const signalIdentities = sqliteTable(
  'signal_identities',
  {
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    opportunityId: integer('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.value] }),
    index('signal_identities_opportunity_idx').on(table.opportunityId),
  ],
);

/** S-08 D-10: append-only; a payment never depends on, or implies, a status. */
export const payments = sqliteTable(
  'payments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    opportunityId: integer('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    /** Integer minor units of `currency`. */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    /** Warsaw midnight (UTC epoch ms) of the day paid (D-5). */
    paidAt: integer('paid_at').notNull(),
    /** Operator text; never logged. */
    note: text('note'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    check('amount_positive', sql`${table.amountMinor} > 0`),
    check('currency_known', sql`${table.currency} IN ('PLN', 'EUR', 'USD')`),
    index('payments_opportunity_idx').on(table.opportunityId, table.paidAt),
  ],
);
