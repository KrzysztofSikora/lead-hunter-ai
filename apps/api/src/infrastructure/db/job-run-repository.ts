import type { JobCost, JobCounters, JobErrorReason } from '@lead-hunter/contracts';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { JobRunRepository, JobRunRow, JobTrigger } from '../../modules/jobs/ports.js';
import { analyses, jobRuns, opportunities, rawSignals, sources } from './schema.js';

/** What the analyses of one source run's opportunities add to its stored counters (D-8, D-9). */
interface Analysed {
  rejected: number;
  sourceFiltered: number;
  analysed: number;
  analysisFailed: number;
  inputTokens: number;
  outputTokens: number;
  hasUsage: boolean;
}

const sumOf = (expression: ReturnType<typeof sql>) =>
  sql<number>`coalesce(sum(${expression}), 0)`.mapWith(Number);

/** The unique-index violation, whether drizzle wraps the driver error or not. */
function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  }
  return false;
}

export function createJobRunRepository(db: BetterSQLite3Database): JobRunRepository {
  return {
    startCycle(trigger, at, scheduledFor) {
      try {
        return db
          .insert(jobRuns)
          .values({
            jobType: 'discovery',
            status: 'running',
            startedAt: at,
            trigger,
            scheduledFor,
          })
          .returning({ id: jobRuns.id })
          .get().id;
      } catch (error) {
        if (isUniqueViolation(error)) return 'slot_taken';
        throw error;
      }
    },
    finishCycle(id, summary) {
      db.update(jobRuns)
        .set({
          status: summary.status,
          finishedAt: summary.at,
          fetched: summary.fetched,
          new: summary.new,
          duplicates: summary.duplicates,
          failed: summary.failed,
          skipped: summary.skipped,
          errorReason: summary.error?.reason ?? null,
        })
        .where(and(eq(jobRuns.id, id), eq(jobRuns.status, 'running')))
        .run();
    },
    list({ page, pageSize, sourceId, id }) {
      const where = and(
        sourceId === undefined
          ? undefined
          : and(eq(jobRuns.jobType, 'source_run'), eq(jobRuns.sourceId, sourceId)),
        id === undefined ? undefined : eq(jobRuns.id, id),
      );
      const total = db.select({ value: count() }).from(jobRuns).where(where).get()?.value ?? 0;
      const pageRows = db
        .select({ run: jobRuns, sourceName: sources.name })
        .from(jobRuns)
        .leftJoin(sources, eq(sources.id, jobRuns.sourceId))
        .where(where)
        .orderBy(desc(jobRuns.startedAt), desc(jobRuns.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .all();

      const cycleIds = pageRows.filter((r) => r.run.jobType === 'discovery').map((r) => r.run.id);
      const children =
        cycleIds.length === 0
          ? []
          : db.select().from(jobRuns).where(inArray(jobRuns.parentRunId, cycleIds)).all();
      const sourceRuns = [...pageRows.map((r) => r.run), ...children].filter(
        (r) => r.jobType === 'source_run',
      );
      const analysedBy = analysisCounts(
        db,
        sourceRuns.map((r) => r.id),
      );

      const countersOf = (run: (typeof sourceRuns)[number]): JobCounters => {
        const extra = analysedBy.get(run.id);
        return {
          fetched: run.fetched,
          new: run.new,
          duplicates: run.duplicates,
          rejected: extra?.rejected ?? 0,
          analysed: extra?.analysed ?? 0,
          failed: run.failed + (extra?.analysisFailed ?? 0),
          skipped: run.skipped,
          sourceFiltered: extra?.sourceFiltered ?? 0,
        };
      };
      const costOf = (ids: number[]): JobCost | null => {
        const used = ids.map((id) => analysedBy.get(id)).filter((a) => a?.hasUsage);
        if (used.length === 0) return null;
        return {
          inputTokens: used.reduce((sum, a) => sum + (a?.inputTokens ?? 0), 0),
          outputTokens: used.reduce((sum, a) => sum + (a?.outputTokens ?? 0), 0),
        };
      };

      const items = pageRows.map(({ run, sourceName }): JobRunRow => {
        const isCycle = run.jobType === 'discovery';
        const kids = isCycle ? children.filter((c) => c.parentRunId === run.id) : [];
        const counters: JobCounters = isCycle
          ? kids.map(countersOf).reduce(
              (sum, c) => ({
                fetched: sum.fetched + c.fetched,
                new: sum.new + c.new,
                duplicates: sum.duplicates + c.duplicates,
                rejected: sum.rejected + c.rejected,
                analysed: sum.analysed + c.analysed,
                failed: sum.failed + c.failed,
                skipped: sum.skipped,
                sourceFiltered: sum.sourceFiltered + c.sourceFiltered,
              }),
              {
                fetched: 0,
                new: 0,
                duplicates: 0,
                rejected: 0,
                analysed: 0,
                failed: 0,
                skipped: run.skipped,
                sourceFiltered: 0,
              },
            )
          : countersOf(run);
        return {
          id: run.id,
          type: isCycle ? 'discovery' : 'source_run',
          trigger: run.trigger as JobTrigger | null,
          parentId: run.parentRunId,
          source:
            run.sourceId !== null && sourceName !== null
              ? { id: run.sourceId, name: sourceName }
              : null,
          status: run.status as JobRunRow['status'],
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          scheduledFor: run.scheduledFor,
          counters,
          error:
            run.errorReason === null
              ? null
              : {
                  reason: run.errorReason as JobErrorReason,
                  ...(run.errorStatus === null ? {} : { httpStatus: run.errorStatus }),
                },
          cost: costOf(isCycle ? kids.map((k) => k.id) : [run.id]),
        };
      });
      return { items, total };
    },
  };
}

/** One grouped pass over the signals each run created (D-8): the index is `job_run_id`. */
function analysisCounts(db: BetterSQLite3Database, runIds: number[]): Map<number, Analysed> {
  const byRun = new Map<number, Analysed>();
  if (runIds.length === 0) return byRun;
  const outcomes = db
    .select({
      runId: rawSignals.jobRunId,
      // `no_text` goes to NEEDS_VERIFICATION, not REJECTED (same mapping as `moveFor`).
      rejected: sumOf(
        sql`case when ${opportunities.prefilterRule} is not null and ${opportunities.prefilterRule} <> 'no_text' then 1 else 0 end`,
      ),
      sourceFiltered: sumOf(
        sql`case when ${opportunities.prefilterRule} = 'source_filter' then 1 else 0 end`,
      ),
      analysed: sumOf(
        sql`case when ${opportunities.analysisStatus} = 'COMPLETE' then 1 else 0 end`,
      ),
      analysisFailed: sumOf(
        sql`case when ${opportunities.analysisStatus} = 'FAILED' then 1 else 0 end`,
      ),
    })
    .from(rawSignals)
    .innerJoin(opportunities, eq(opportunities.primarySignalId, rawSignals.id))
    .where(inArray(rawSignals.jobRunId, runIds))
    .groupBy(rawSignals.jobRunId)
    .all();
  for (const row of outcomes) {
    if (row.runId === null) continue;
    byRun.set(row.runId, {
      rejected: row.rejected,
      sourceFiltered: row.sourceFiltered,
      analysed: row.analysed,
      analysisFailed: row.analysisFailed,
      inputTokens: 0,
      outputTokens: 0,
      hasUsage: false,
    });
  }
  const usage = db
    .select({
      runId: rawSignals.jobRunId,
      inputTokens: sumOf(sql`${analyses.inputTokens}`),
      outputTokens: sumOf(sql`${analyses.outputTokens}`),
      reported:
        sql<number>`count(${analyses.inputTokens}) + count(${analyses.outputTokens})`.mapWith(
          Number,
        ),
    })
    .from(rawSignals)
    .innerJoin(opportunities, eq(opportunities.primarySignalId, rawSignals.id))
    .innerJoin(analyses, eq(analyses.opportunityId, opportunities.id))
    .where(inArray(rawSignals.jobRunId, runIds))
    .groupBy(rawSignals.jobRunId)
    .all();
  for (const row of usage) {
    const entry = row.runId === null ? undefined : byRun.get(row.runId);
    if (!entry) continue;
    entry.inputTokens = row.inputTokens;
    entry.outputTokens = row.outputTokens;
    entry.hasUsage = row.reported > 0;
  }
  return byRun;
}
