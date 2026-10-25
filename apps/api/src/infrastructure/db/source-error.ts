import type { SourceError, SourceFailureReason } from '@lead-hunter/contracts';

export interface SourceErrorRow {
  id: number;
  name: string;
  reason: string | null;
  status: number | null;
  errorAt: number | null;
}

/** The last failure of a source, or nothing when it has none. */
export const toSourceErrors = (rows: SourceErrorRow[]): SourceError[] =>
  rows.flatMap((row) =>
    row.reason === null || row.errorAt === null
      ? []
      : [
          {
            sourceId: row.id,
            source: row.name,
            reason: row.reason as SourceFailureReason,
            ...(row.status === null ? {} : { httpStatus: row.status }),
            at: new Date(row.errorAt).toISOString(),
          },
        ],
  );
