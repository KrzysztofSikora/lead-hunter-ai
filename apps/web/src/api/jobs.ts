import { JobList, JobRun } from '@lead-hunter/contracts';
import { apiFetch } from './client.js';

export const JOBS_SHOWN = 20;

export async function listJobs(): Promise<JobList> {
  const response = await apiFetch(`/api/jobs?page=1&pageSize=${JOBS_SHOWN}`);
  if (!response.ok) throw new Error(`jobs failed: ${response.status}`);
  return JobList.parse(await response.json());
}

export type DiscoverOutcome = { ok: true; value: JobRun } | { ok: false; refused: 'busy' };

/** D-10: the cycle runs on in the background; the list shows how it ends. */
export async function discoverNow(): Promise<DiscoverOutcome> {
  const response = await apiFetch('/api/jobs/discover', { method: 'POST' });
  if (response.status === 202) return { ok: true, value: JobRun.parse(await response.json()) };
  if (response.status === 409) return { ok: false, refused: 'busy' };
  throw new Error(`discover failed: ${response.status}`);
}
