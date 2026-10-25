import { ProfileResponse, ValidationError, type OperatorProfile } from '@lead-hunter/contracts';
import { apiFetch } from './client.js';

export type FieldError = ValidationError['fields'][number];
export type SaveResult = { ok: true; data: ProfileResponse } | { ok: false; fields: FieldError[] };

export async function getProfile(): Promise<ProfileResponse> {
  const response = await apiFetch('/api/profile');
  if (response.status !== 200) throw new Error(`profile load failed: ${response.status}`);
  return ProfileResponse.parse(await response.json());
}

export async function saveProfile(profile: OperatorProfile): Promise<SaveResult> {
  const response = await apiFetch('/api/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (response.status === 200) {
    return { ok: true, data: ProfileResponse.parse(await response.json()) };
  }
  if (response.status === 400) {
    const body = ValidationError.safeParse(await response.json().catch(() => null));
    if (body.success) return { ok: false, fields: body.data.fields };
  }
  throw new Error(`profile save failed: ${response.status}`);
}
