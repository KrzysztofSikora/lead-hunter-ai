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

/** D-3: the source is a text column until `sources` exists (S-10). */
export const rawSignals = sqliteTable(
  'raw_signals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceType: text('source_type').notNull(),
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
  },
  (table) => [
    check('score_range', sql`${table.score} IS NULL OR ${table.score} BETWEEN 0 AND 100`),
    index('opportunities_business_status_idx').on(table.businessStatus),
    index('opportunities_score_idx').on(table.score),
    index('opportunities_created_at_idx').on(table.createdAt),
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
