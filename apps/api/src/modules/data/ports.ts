export interface DataRepository {
  /**
   * Removes the opportunity with everything it owns (signal, evidence, analyses, drafts, events,
   * payments, identities). The usage of this month's analyses and drafts is kept (S-15 D-1).
   * Returns false when the id is unknown.
   */
  deleteOpportunity(id: number, usageSince: number): boolean;
}
