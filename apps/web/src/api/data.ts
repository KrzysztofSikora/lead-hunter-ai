import { apiFetch } from './client.js';

/** FR-21 AC2: a plain download link; the session cookie travels with it. */
export const EXPORT_URL = '/api/export';

/** FR-21 AC1: 204 and 404 both leave nothing behind; anything else is a failure. */
export async function deleteOpportunity(id: number): Promise<void> {
  const response = await apiFetch(`/api/opportunities/${id}`, { method: 'DELETE' });
  if (response.status !== 204 && response.status !== 404) {
    throw new Error(`delete ${response.status}`);
  }
}
