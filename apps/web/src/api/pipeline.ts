import { PipelineResponse } from '@lead-hunter/contracts';
import { apiFetch } from './client.js';

export async function getPipeline(): Promise<PipelineResponse> {
  const response = await apiFetch('/api/pipeline');
  if (!response.ok) throw new Error(`pipeline ${response.status}`);
  return PipelineResponse.parse(await response.json());
}
