import type { Clock } from '../shared/clock.js';
import type { DataExport } from '@lead-hunter/contracts';
import { instantToWarsawDate, startOfWarsawMonth } from '../shared/warsaw-day.js';
import { toExportRow } from './export-rows.js';
import type { DataRepository } from './ports.js';

export interface DataDeps {
  repository: DataRepository;
  clock: Clock;
}

export interface DataService {
  /** False when the opportunity does not exist. */
  deleteOpportunity(id: number): boolean;
  /** FR-21 AC2: the export document and the Warsaw date used in its file name. */
  exportData(): { body: DataExport; date: string };
}

export function createDataService(deps: DataDeps): DataService {
  return {
    deleteOpportunity: (id) =>
      deps.repository.deleteOpportunity(id, startOfWarsawMonth(deps.clock.now()).getTime()),
    exportData() {
      const now = deps.clock.now();
      const tables = deps.repository.exportAll();
      const rows = (list: Record<string, unknown>[]) => list.map(toExportRow);
      return {
        date: instantToWarsawDate(now),
        body: {
          format: 'lead-hunter-export',
          version: 1,
          exportedAt: now.toISOString(),
          profile: tables.profile ? toExportRow(tables.profile) : null,
          sources: rows(tables.sources),
          signals: rows(tables.signals),
          opportunities: rows(tables.opportunities),
          evidence: rows(tables.evidence),
          analyses: rows(tables.analyses),
          offerDrafts: rows(tables.offerDrafts),
          events: rows(tables.events),
          payments: rows(tables.payments),
        },
      };
    },
  };
}
