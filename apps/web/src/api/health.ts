import { HealthResponse } from '@lead-hunter/contracts';

/** Reads `/api/health`. A 503 still carries a valid body ("degraded"); anything else is an error. */
export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health');
  return HealthResponse.parse(await response.json());
}
