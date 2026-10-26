import {
  OfferDraftConflict,
  OfferDraftFailed,
  OfferDraftRefused,
  OpportunityDetail,
  type OfferDraftPatch,
} from '@lead-hunter/contracts';
import { apiFetch } from './client.js';

export type OfferOutcome =
  | { ok: true; detail: OpportunityDetail }
  | { ok: false; kind: 'refused'; code: OfferDraftRefused['error'] }
  | { ok: false; kind: 'failed'; reason: string }
  | { ok: false; kind: 'conflict'; code: OfferDraftConflict['error'] }
  | { ok: false; kind: 'missing' };

async function read(response: Response): Promise<OfferOutcome> {
  if (response.status === 200 || response.status === 201) {
    return { ok: true, detail: OpportunityDetail.parse(await response.json()) };
  }
  if (response.status === 404) return { ok: false, kind: 'missing' };
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 409) {
    const refused = OfferDraftRefused.safeParse(body);
    if (refused.success) return { ok: false, kind: 'refused', code: refused.data.error };
    const conflict = OfferDraftConflict.safeParse(body);
    if (conflict.success) return { ok: false, kind: 'conflict', code: conflict.data.error };
  }
  if (response.status === 502) {
    const failed = OfferDraftFailed.safeParse(body);
    if (failed.success) return { ok: false, kind: 'failed', reason: failed.data.reason };
  }
  throw new Error(`offer draft call failed: ${response.status}`);
}

/** Synchronous: the request waits for the provider (D-5). */
export async function generateOfferDraft(opportunityId: number): Promise<OfferOutcome> {
  return read(
    await apiFetch(`/api/opportunities/${opportunityId}/offer-drafts`, { method: 'POST' }),
  );
}

export async function patchOfferDraft(id: number, body: OfferDraftPatch): Promise<OfferOutcome> {
  return read(
    await apiFetch(`/api/offer-drafts/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}
