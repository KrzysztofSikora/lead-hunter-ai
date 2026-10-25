import {
  OpportunityDetail,
  OpportunityList,
  ValidationError,
  type BusinessStatus,
  type Category,
  type SourceType,
  type StatusChangeRequest,
} from '@lead-hunter/contracts';
import { apiFetch } from './client.js';
import type { FieldError } from './profile.js';

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
  /** D-13: a row is excluded only when its value is known and fails. */
  maxAgeDays?: number;
  /** Major units of `currency`; converted to minor units for the API. */
  minAmount?: number;
  currency?: string;
  language?: string;
  workMode?: string;
  country?: string;
  excludeIndustries?: string;
};

export const PAGE_SIZE = 20;

export async function listOpportunities(filters: ListFilters): Promise<OpportunityList> {
  const query = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(PAGE_SIZE),
    sort: filters.sort,
  });
  if (filters.minScore !== undefined) query.set('minScore', String(filters.minScore));
  for (const key of [
    'category',
    'sourceType',
    'status',
    'from',
    'to',
    'language',
    'workMode',
    'country',
    'excludeIndustries',
  ] as const) {
    const value = filters[key];
    if (value) query.set(key, value);
  }
  if (filters.maxAgeDays !== undefined) query.set('maxAgeDays', String(filters.maxAgeDays));
  if (filters.minAmount !== undefined && filters.currency) {
    query.set('minAmount', String(Math.round(filters.minAmount * 100)));
    query.set('currency', filters.currency);
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

export type ActionOutcome =
  | { ok: true; detail: OpportunityDetail }
  | { ok: false; kind: 'invalid'; fields: FieldError[] }
  | { ok: false; kind: 'conflict' | 'missing' };

async function postAction(path: string, body: unknown): Promise<ActionOutcome> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 200) {
    return { ok: true, detail: OpportunityDetail.parse(await response.json()) };
  }
  if (response.status === 409) return { ok: false, kind: 'conflict' };
  if (response.status === 404) return { ok: false, kind: 'missing' };
  if (response.status === 400) {
    const parsed = ValidationError.safeParse(await response.json().catch(() => null));
    if (parsed.success) return { ok: false, kind: 'invalid', fields: parsed.data.fields };
  }
  throw new Error(`opportunity action failed: ${response.status}`);
}

export function changeStatus(id: number, body: StatusChangeRequest): Promise<ActionOutcome> {
  return postAction(`/api/opportunities/${id}/status`, body);
}

export function addNote(id: number, text: string): Promise<ActionOutcome> {
  return postAction(`/api/opportunities/${id}/notes`, { text });
}
