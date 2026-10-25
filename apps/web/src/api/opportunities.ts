import {
  OpportunityDetail,
  OpportunityList,
  type BusinessStatus,
  type Category,
  type SourceType,
} from '@lead-hunter/contracts';
import { apiFetch } from './client.js';

export type ListFilters = {
  page: number;
  sort: 'date' | 'score';
  minScore?: number;
  category?: Category;
  sourceType?: SourceType;
  status?: BusinessStatus;
  /** ISO UTC instants; `from` inclusive, `to` exclusive. */
  from?: string;
  to?: string;
};

export const PAGE_SIZE = 20;

export async function listOpportunities(filters: ListFilters): Promise<OpportunityList> {
  const query = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(PAGE_SIZE),
    sort: filters.sort,
  });
  if (filters.minScore !== undefined) query.set('minScore', String(filters.minScore));
  for (const key of ['category', 'sourceType', 'status', 'from', 'to'] as const) {
    const value = filters[key];
    if (value) query.set(key, value);
  }
  const response = await apiFetch(`/api/opportunities?${query}`);
  if (response.status !== 200) throw new Error(`opportunity list failed: ${response.status}`);
  return OpportunityList.parse(await response.json());
}

/** `null` when the opportunity does not exist. */
export async function getOpportunity(id: number): Promise<OpportunityDetail | null> {
  const response = await apiFetch(`/api/opportunities/${id}`);
  if (response.status === 404) return null;
  if (response.status !== 200) throw new Error(`opportunity load failed: ${response.status}`);
  return OpportunityDetail.parse(await response.json());
}
