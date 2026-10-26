import { Insights } from '@lead-hunter/contracts';
import { apiFetch } from './client.js';

export type InsightsPeriod = { week?: string; month?: string };

export async function getInsights(period: InsightsPeriod): Promise<Insights> {
  const query = new URLSearchParams(period).toString();
  const response = await apiFetch(`/api/insights${query ? `?${query}` : ''}`);
  if (!response.ok) throw new Error(`insights ${response.status}`);
  return Insights.parse(await response.json());
}
