import type { StoredRow } from './export-rows.js';

/** The stored rows of every exported table, read in one snapshot (S-15 D-8). */
export interface ExportTables {
  profile: StoredRow | null;
  sources: StoredRow[];
  signals: StoredRow[];
  opportunities: StoredRow[];
  evidence: StoredRow[];
  analyses: StoredRow[];
  offerDrafts: StoredRow[];
  events: StoredRow[];
  payments: StoredRow[];
}

export interface DataRepository {
  /**
   * Removes the opportunity with everything it owns (signal, evidence, analyses, drafts, events,
   * payments, identities). The usage of this month's analyses and drafts is kept (S-15 D-1).
   * Returns false when the id is unknown.
   */
  deleteOpportunity(id: number, usageSince: number): boolean;
  /** Allowlisted columns only; secrets and runtime state are never selected. */
  exportAll(): ExportTables;
}
