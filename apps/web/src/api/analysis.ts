import { AnalysisRequestRefused, AnalysisServiceStatus } from '@lead-hunter/contracts';
import { apiFetch } from './client.js';

export async function getAnalysisStatus(): Promise<AnalysisServiceStatus> {
  const response = await apiFetch('/api/analysis/status');
  if (response.status !== 200) throw new Error(`analysis status failed: ${response.status}`);
  return AnalysisServiceStatus.parse(await response.json());
}

export type RequestOutcome = 'queued' | 'prefiltered' | 'not_configured' | 'not_found';

/** D-10: queues a retry (`force` false) or a new analysis that skips the reuse (`force` true). */
export async function requestAnalysis(id: number, force: boolean): Promise<RequestOutcome> {
  const response = await apiFetch(`/api/opportunities/${id}/analysis`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force }),
  });
  if (response.status === 202) return 'queued';
  if (response.status === 404) return 'not_found';
  if (response.status === 409) return AnalysisRequestRefused.parse(await response.json()).error;
  throw new Error(`analysis request failed: ${response.status}`);
}
