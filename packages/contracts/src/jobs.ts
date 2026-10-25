import { z } from 'zod';
import { SourceFailureReason } from './opportunities.js';

const isoInstant = z.iso.datetime();

/** S-12 D-14: who started a run. Null on rows from before S-12. */
export const JobTrigger = z.enum(['schedule', 'manual', 'cli']);
export type JobTrigger = z.infer<typeof JobTrigger>;

/** S-12 D-3: a source failure, or a run that a restart cut short. */
export const JobErrorReason = z.enum([...SourceFailureReason.options, 'interrupted']);
export type JobErrorReason = z.infer<typeof JobErrorReason>;

const count = z.number().int().min(0);

/** S-12 D-8: `rejected`, `analysed` and the analysis part of `failed` are read live. */
export const JobCounters = z
  .object({
    fetched: count,
    new: count,
    duplicates: count,
    rejected: count,
    analysed: count,
    failed: count,
    skipped: count,
  })
  .strict();
export type JobCounters = z.infer<typeof JobCounters>;

/** S-12 D-9: reported token usage only; the money value arrives with the price table (S-05). */
export const JobCost = z.object({ inputTokens: count, outputTokens: count }).strict();
export type JobCost = z.infer<typeof JobCost>;

/** S-12 D-10: one run, either a whole discovery cycle or a single source run. */
export const JobRun = z
  .object({
    id: z.number().int(),
    type: z.enum(['discovery', 'source_run']),
    trigger: JobTrigger.nullable(),
    parentId: z.number().int().nullable(),
    source: z.object({ id: z.number().int(), name: z.string() }).strict().nullable(),
    status: z.enum(['running', 'ok', 'partial', 'failed']),
    startedAt: isoInstant,
    finishedAt: isoInstant.nullable(),
    scheduledFor: isoInstant.nullable(),
    counters: JobCounters,
    error: z
      .object({
        reason: JobErrorReason,
        httpStatus: z.number().int().min(100).max(599).optional(),
      })
      .strict()
      .nullable(),
    cost: JobCost.nullable(),
  })
  .strict();
export type JobRun = z.infer<typeof JobRun>;

export const JobSchedule = z
  .object({
    timezone: z.literal('Europe/Warsaw'),
    times: z.array(z.string()),
    nextRunAt: isoInstant.nullable(),
  })
  .strict();
export type JobSchedule = z.infer<typeof JobSchedule>;

export const JobList = z
  .object({
    items: z.array(JobRun),
    total: count,
    page: z.number().int(),
    pageSize: z.number().int(),
    /** True while any run is in progress; the web app polls while it is. */
    running: z.boolean(),
    schedule: JobSchedule,
  })
  .strict();
export type JobList = z.infer<typeof JobList>;

/** `z.coerce.number()` turns `''` into 0; an empty query value means "not given". */
const emptyAsAbsent = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

export const JobListQuery = z
  .object({
    page: emptyAsAbsent(z.coerce.number().int().min(1).default(1)),
    pageSize: emptyAsAbsent(z.coerce.number().int().min(1).max(100).default(20)),
    sourceId: emptyAsAbsent(z.coerce.number().int().positive().optional()),
  })
  .strict();
export type JobListQuery = z.infer<typeof JobListQuery>;

/** S-12 D-12: the answer to a retry of a failed analysis. */
export const RetryAnalysisResult = z.object({ analysisStatus: z.literal('PENDING') }).strict();
export type RetryAnalysisResult = z.infer<typeof RetryAnalysisResult>;
