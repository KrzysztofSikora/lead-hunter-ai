import type { Clock } from '../shared/clock.js';
import type { DataExport } from '@lead-hunter/contracts';
import { instantToWarsawDate, startOfWarsawMonth } from '../shared/warsaw-day.js';
import { toExportRow } from './export-rows.js';
import type { BackupStore, DataRepository } from './ports.js';

export interface DataLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface DataDeps {
  repository: DataRepository;
  clock: Clock;
  /** Absent in tests that never back up. */
  backups?: BackupStore;
  backupKeep?: number;
  logger?: DataLogger;
}

export interface BackupResult {
  file: string;
  bytes: number;
  removed: string[];
}

export interface DataService {
  /** False when the opportunity does not exist. */
  deleteOpportunity(id: number): boolean;
  /** FR-21 AC2: the export document and the Warsaw date used in its file name. */
  exportData(): { body: DataExport; date: string };
  /** FR-22 AC1: a verified copy, then the rotation. Rejects when the copy cannot be made. */
  backup(): Promise<BackupResult>;
  /** The 03:30 job. Never rejects: every failure is logged (plan-review #6). */
  runDaily(): Promise<void>;
}

export function createDataService(deps: DataDeps): DataService {
  const log: DataLogger = deps.logger ?? { info: () => undefined, error: () => undefined };
  const message = (error: unknown): string => (error instanceof Error ? error.message : 'error');

  async function backup(): Promise<BackupResult> {
    if (!deps.backups) throw new Error('kopie zapasowe nie są skonfigurowane');
    const written = await deps.backups.write(deps.clock.now());
    let removed: string[] = [];
    try {
      removed = deps.backups.prune(deps.backupKeep ?? 14);
    } catch (error) {
      log.error(`backup rotation failed: ${message(error)}`);
    }
    return { ...written, removed };
  }

  return {
    backup,
    async runDaily() {
      try {
        const result = await backup();
        log.info(
          `backup: ${result.file} (${result.bytes} B), removed ${result.removed.length} old copies`,
        );
      } catch (error) {
        log.error(`backup failed: ${message(error)}`);
      }
    },
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
