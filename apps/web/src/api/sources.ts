import {
  Source,
  SourceHealth,
  SourceList,
  SourceRunResult,
  ValidationError,
  type CreateSourceRequest,
} from '@lead-hunter/contracts';
import { apiFetch } from './client.js';
import type { FieldError } from './profile.js';

export type Refused =
  | { ok: false; refused: 'too_soon'; nextAllowedAt: string }
  | {
      ok: false;
      refused: 'disabled' | 'exists' | 'not_found';
    };
export type Done<T> = { ok: true; value: T };
export type Outcome<T> = Done<T> | Refused;
export type CreateOutcome =
  Done<Source> | Refused | { ok: false; refused: 'invalid'; fields: FieldError[] };

const json = { 'content-type': 'application/json' };

export async function listSources(): Promise<SourceList> {
  const response = await apiFetch('/api/sources');
  if (!response.ok) throw new Error(`sources failed: ${response.status}`);
  return SourceList.parse(await response.json());
}

export async function createSource(body: CreateSourceRequest): Promise<CreateOutcome> {
  const response = await apiFetch('/api/sources', {
    method: 'POST',
    headers: json,
    body: JSON.stringify(body),
  });
  if (response.status === 201) return { ok: true, value: Source.parse(await response.json()) };
  if (response.status === 409) return { ok: false, refused: 'exists' };
  if (response.status === 400) {
    const parsed = ValidationError.safeParse(await response.json().catch(() => null));
    if (parsed.success) return { ok: false, refused: 'invalid', fields: parsed.data.fields };
  }
  throw new Error(`create source failed: ${response.status}`);
}

export async function setSourceEnabled(id: number, enabled: boolean): Promise<Source> {
  const response = await apiFetch(`/api/sources/${id}`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) throw new Error(`update source failed: ${response.status}`);
  return Source.parse(await response.json());
}

async function act<T>(
  id: number,
  action: 'run' | 'check',
  parse: (value: unknown) => T,
): Promise<Outcome<T>> {
  const response = await apiFetch(`/api/sources/${id}/${action}`, { method: 'POST' });
  if (response.status === 200) return { ok: true, value: parse(await response.json()) };
  if (response.status === 404) return { ok: false, refused: 'not_found' };
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      nextAllowedAt?: string;
    } | null;
    if (body?.error === 'too_soon' && body.nextAllowedAt) {
      return { ok: false, refused: 'too_soon', nextAllowedAt: body.nextAllowedAt };
    }
    if (body?.error === 'disabled') return { ok: false, refused: 'disabled' };
  }
  throw new Error(`source ${action} failed: ${response.status}`);
}

export const runSource = (id: number) => act(id, 'run', (v) => SourceRunResult.parse(v));
export const checkSource = (id: number) => act(id, 'check', (v) => SourceHealth.parse(v));
