import { z } from 'zod';

/** S-15 D-8: a stored row as the export shows it (camelCase columns, ISO times, parsed JSON). */
const ExportRow = z.record(z.string(), z.unknown());

/** S-15 D-8, FR-21 AC2: everything the operator owns, in one file. */
export const DataExport = z.object({
  format: z.literal('lead-hunter-export'),
  version: z.literal(1),
  exportedAt: z.string(),
  profile: ExportRow.nullable(),
  sources: z.array(ExportRow),
  signals: z.array(ExportRow),
  opportunities: z.array(ExportRow),
  evidence: z.array(ExportRow),
  analyses: z.array(ExportRow),
  offerDrafts: z.array(ExportRow),
  events: z.array(ExportRow),
  payments: z.array(ExportRow),
});
export type DataExport = z.infer<typeof DataExport>;
