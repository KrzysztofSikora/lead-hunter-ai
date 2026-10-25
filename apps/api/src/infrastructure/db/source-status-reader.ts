import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SourceStatusReader } from '../../modules/opportunities/ports.js';
import { sources } from './schema.js';
import { toSourceErrors } from './source-error.js';

/** The empty state's view of the sources: how many were attempted and which failed last time. */
export function createSourceStatusReader(db: BetterSQLite3Database): SourceStatusReader {
  return {
    summary() {
      const enabled = db
        .select({
          id: sources.id,
          name: sources.name,
          lastAttemptAt: sources.lastAttemptAt,
          reason: sources.lastErrorReason,
          status: sources.lastErrorStatus,
          errorAt: sources.lastErrorAt,
        })
        .from(sources)
        .where(and(eq(sources.enabled, true), isNotNull(sources.lastAttemptAt)))
        .orderBy(desc(sources.lastErrorAt))
        .all();
      return {
        checked: enabled.length,
        errors: toSourceErrors(enabled),
      };
    },
  };
}
