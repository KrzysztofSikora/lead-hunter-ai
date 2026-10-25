import type { BusinessStatus, Currency } from '@lead-hunter/contracts';

/** One opportunity in a pipeline list. Times are UTC epoch ms. */
export interface PipelineItemRow {
  id: number;
  title: string;
  businessStatus: BusinessStatus;
  score: number | null;
  /** Warsaw midnight of the follow-up day (S-08 D-5). */
  followUpAt: number | null;
  updatedAt: number;
  paid: { currency: Currency; totalMinor: number }[];
}

export interface PipelineRepository {
  /** Opportunities per status; statuses without rows are absent. */
  countByStatus(): { status: BusinessStatus; count: number }[];
  /** Newest updated first. */
  itemsInStatus(status: BusinessStatus, limit: number): PipelineItemRow[];
  /** Open follow-up stages with `follow_up_at` at or before `until`, overdue first. */
  followUpsDue(until: number): PipelineItemRow[];
  totals(): {
    contacted: number;
    won: number;
    paid: number;
    paidSums: { currency: Currency; totalMinor: number; count: number }[];
  };
}
