import {
  BusinessStatus,
  PIPELINE_STAGE_LIMIT,
  PIPELINE_STAGES,
  type PipelineItem,
  type PipelineResponse,
} from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';
import { instantToWarsawDate, startOfWarsawDay } from '../shared/warsaw-day.js';
import type { PipelineItemRow, PipelineRepository } from './ports.js';

export interface PipelineDeps {
  repository: PipelineRepository;
  clock: Clock;
}

const toItem = (row: PipelineItemRow): PipelineItem => ({
  id: row.id,
  title: row.title,
  businessStatus: row.businessStatus,
  score: row.score,
  followUpOn: row.followUpAt === null ? null : instantToWarsawDate(new Date(row.followUpAt)),
  updatedAt: new Date(row.updatedAt).toISOString(),
  paid: row.paid,
});

export function createPipelineService(deps: PipelineDeps) {
  return {
    summary(): PipelineResponse {
      const { repository } = deps;
      const counts = new Map(repository.countByStatus().map((c) => [c.status, c.count]));
      const countOf = (status: BusinessStatus): number => counts.get(status) ?? 0;
      return {
        stages: PIPELINE_STAGES.map((status) => ({
          status,
          count: countOf(status),
          items: repository.itemsInStatus(status, PIPELINE_STAGE_LIMIT).map(toItem),
        })),
        otherCounts: BusinessStatus.options
          .filter((status) => !PIPELINE_STAGES.includes(status))
          .map((status) => ({ status, count: countOf(status) })),
        followUpsDue: repository
          .followUpsDue(startOfWarsawDay(deps.clock.now()).getTime())
          .map(toItem),
        totals: repository.totals(),
      };
    },
  };
}
