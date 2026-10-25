import { ImportResult, ValidationError, type ImportRequest } from '@lead-hunter/contracts';
import { apiFetch } from './client.js';
import type { FieldError } from './profile.js';

/** Phase 3 handles `fetch_failed` (422); until then it surfaces as the generic failure. */
export type ImportOutcome =
  | { ok: true; result: Exclude<ImportResult, { result: 'fetch_failed' }> }
  | { ok: false; fields: FieldError[] };

export async function importSignal(body: ImportRequest): Promise<ImportOutcome> {
  const response = await apiFetch('/api/signals/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 200 || response.status === 201) {
    const result = ImportResult.parse(await response.json());
    if (result.result !== 'fetch_failed') return { ok: true, result };
  }
  if (response.status === 400) {
    const parsed = ValidationError.safeParse(await response.json().catch(() => null));
    if (parsed.success) return { ok: false, fields: parsed.data.fields };
  }
  throw new Error(`import failed: ${response.status}`);
}
