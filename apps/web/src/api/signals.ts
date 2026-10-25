import { ImportResult, ValidationError, type ImportRequest } from '@lead-hunter/contracts';
import { apiFetch } from './client.js';
import type { FieldError } from './profile.js';

export type ImportOutcome =
  { ok: true; result: ImportResult } | { ok: false; fields: FieldError[] };

export async function importSignal(body: ImportRequest): Promise<ImportOutcome> {
  const response = await apiFetch('/api/signals/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 200 || response.status === 201 || response.status === 422) {
    return { ok: true, result: ImportResult.parse(await response.json()) };
  }
  if (response.status === 400) {
    const parsed = ValidationError.safeParse(await response.json().catch(() => null));
    if (parsed.success) return { ok: false, fields: parsed.data.fields };
  }
  throw new Error(`import failed: ${response.status}`);
}
