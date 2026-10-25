import { AnalysisServiceStatus } from '@lead-hunter/contracts';
import { apiFetch } from './client.js';

export async function getAnalysisStatus(): Promise<AnalysisServiceStatus> {
  const response = await apiFetch('/api/analysis/status');
  if (response.status !== 200) throw new Error(`analysis status failed: ${response.status}`);
  return AnalysisServiceStatus.parse(await response.json());
}

/** D-12: only a `FAILED` analysis can be retried; the server answers 409 otherwise. */
export async function retryAnalysis(id: number): Promise<boolean> {
  const response = await apiFetch(`/api/opportunities/${id}/analyze`, { method: 'POST' });
  if (response.status === 202) return true;
  if (response.status === 409) return false;
  throw new Error(`retry analysis failed: ${response.status}`);
}
