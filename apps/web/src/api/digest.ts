import { DigestToday } from '@lead-hunter/contracts';
import { apiFetch } from './client.js';

export async function fetchDigest(): Promise<DigestToday> {
  const response = await apiFetch('/api/digest/today');
  if (!response.ok) throw new Error(`digest ${response.status}`);
  return DigestToday.parse(await response.json());
}
