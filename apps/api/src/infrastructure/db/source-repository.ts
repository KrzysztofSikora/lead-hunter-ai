import type { SourceFailureReason, SourceKind } from '@lead-hunter/contracts';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { ClaimResult, SourceRecord, SourceRepository } from '../../modules/sources/ports.js';
import { jobRuns, sources } from './schema.js';

type Row = typeof sources.$inferSelect;

function toRecord(row: Row): SourceRecord {
  return {
    id: row.id,
    type: row.type as SourceKind,
    name: row.name,
    configJson: row.configJson,
    configKey: row.configKey,
    presetId: row.presetId,
    enabled: row.enabled,
    filterJson: row.filterJson,
    cursorJson: row.cursorJson,
    nextAllowedAt: row.nextAllowedAt,
    lastAttemptAt: row.lastAttemptAt,
    lastSuccessAt: row.lastSuccessAt,
    lastError:
      row.lastErrorReason === null || row.lastErrorAt === null
        ? null
        : {
            reason: row.lastErrorReason as SourceFailureReason,
            ...(row.lastErrorStatus === null ? {} : { httpStatus: row.lastErrorStatus }),
            at: row.lastErrorAt,
          },
  };
}

export function createSourceRepository(db: BetterSQLite3Database): SourceRepository {
  const get = (id: number): SourceRecord | undefined => {
    const row = db.select().from(sources).where(eq(sources.id, id)).get();
    return row ? toRecord(row) : undefined;
  };

  /** Why an atomic claim updated nothing. */
  const whyRefused = (id: number, readyAt: (record: SourceRecord) => number): ClaimResult => {
    const record = get(id);
    if (!record) return { ok: false, reason: 'not_found' };
    if (!record.enabled) return { ok: false, reason: 'disabled' };
    return { ok: false, reason: 'too_soon', nextAllowedAt: readyAt(record) };
  };

  return {
    list() {
      return db.select().from(sources).orderBy(asc(sources.id)).all().map(toRecord);
    },
    get,
    insert(source) {
      const row = db
        .insert(sources)
        .values({
          type: source.type,
          name: source.name,
          configJson: source.configJson,
          configKey: source.configKey,
          presetId: source.presetId,
          filterJson: source.filterJson,
          enabled: true,
          createdAt: source.at,
          updatedAt: source.at,
        })
        .onConflictDoNothing()
        .returning()
        .get();
      return row ? toRecord(row) : undefined;
    },
    update(id, patch, at) {
      const row = db
        .update(sources)
        .set({
          ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
          ...(patch.filterJson === undefined ? {} : { filterJson: patch.filterJson }),
          ...(patch.configJson === undefined ? {} : { configJson: patch.configJson }),
          updatedAt: at,
        })
        .where(eq(sources.id, id))
        .returning()
        .get();
      return row ? toRecord(row) : undefined;
    },
    claimRun(id, now, intervalMs) {
      const claimed = db
        .update(sources)
        .set({ nextAllowedAt: now + intervalMs, lastAttemptAt: now })
        .where(
          and(
            eq(sources.id, id),
            eq(sources.enabled, true),
            or(isNull(sources.nextAllowedAt), lte(sources.nextAllowedAt, now)),
          ),
        )
        .run();
      if (claimed.changes === 1) return { ok: true, nextAllowedAt: now + intervalMs };
      return whyRefused(id, (record) => record.nextAllowedAt ?? now);
    },
    claimCheck(id, now, cooldownMs) {
      const claimed = db
        .update(sources)
        .set({ lastAttemptAt: now })
        .where(
          and(
            eq(sources.id, id),
            eq(sources.enabled, true),
            or(isNull(sources.nextAllowedAt), lte(sources.nextAllowedAt, now)),
            or(isNull(sources.lastAttemptAt), lte(sources.lastAttemptAt, now - cooldownMs)),
          ),
        )
        .run();
      if (claimed.changes === 1) return { ok: true, nextAllowedAt: get(id)?.nextAllowedAt ?? null };
      return whyRefused(id, (record) =>
        Math.max(record.nextAllowedAt ?? 0, (record.lastAttemptAt ?? 0) + cooldownMs),
      );
    },
    finishAttempt(id, outcome, at, nextAllowedAt) {
      if (outcome.ok) {
        db.update(sources)
          .set({
            lastSuccessAt: at,
            lastErrorReason: null,
            lastErrorStatus: null,
            lastErrorAt: null,
            updatedAt: at,
          })
          .where(eq(sources.id, id))
          .run();
        return;
      }
      db.update(sources)
        .set({
          lastErrorReason: outcome.reason,
          lastErrorStatus: outcome.httpStatus ?? null,
          lastErrorAt: at,
          updatedAt: at,
          // Only ever later: the claim may already have set a further time.
          ...(nextAllowedAt === undefined
            ? {}
            : { nextAllowedAt: sql`max(coalesce(${sources.nextAllowedAt}, 0), ${nextAllowedAt})` }),
        })
        .where(eq(sources.id, id))
        .run();
    },
    saveCursor(id, cursorJson) {
      db.update(sources).set({ cursorJson }).where(eq(sources.id, id)).run();
    },
    startRun(sourceId, at, context) {
      return db
        .insert(jobRuns)
        .values({
          jobType: 'source_run',
          sourceId,
          status: 'running',
          startedAt: at,
          trigger: context?.trigger ?? null,
          parentRunId: context?.parentRunId ?? null,
        })
        .returning({ id: jobRuns.id })
        .get().id;
    },
    finishRun(runId, summary) {
      db.update(jobRuns)
        .set({
          status: summary.status,
          finishedAt: summary.at,
          fetched: summary.fetched,
          new: summary.new,
          duplicates: summary.duplicates,
          failed: summary.failed,
          errorReason: summary.error?.reason ?? null,
          errorStatus: summary.error?.httpStatus ?? null,
        })
        // An `interrupted` row is never rewritten by a late finish (D-3).
        .where(and(eq(jobRuns.id, runId), eq(jobRuns.status, 'running')))
        .run();
    },
  };
}
