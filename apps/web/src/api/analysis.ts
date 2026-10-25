import { AnalysisServiceStatus } from '@lead-hunter/contracts';
import { apiFetch } from './client.js';

export async function getAnalysisStatus(): Promise<AnalysisServiceStatus> {
  const response = await apiFetch('/api/analysis/status');
  if (response.status !== 200) throw new Error(`analysis status failed: ${response.status}`);
  return AnalysisServiceStatus.parse(await response.json());
}
