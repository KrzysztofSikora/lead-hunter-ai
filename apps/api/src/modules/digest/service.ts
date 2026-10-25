import { DigestToday, type DigestItem, type DigestQuery } from '@lead-hunter/contracts';
import { DEFAULT_MIN_SCORE } from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';
import type { PipelineRepository } from '../pipeline/ports.js';
import { toItem } from '../pipeline/service.js';
import { instantToWarsawDate, startOfWarsawDay } from '../shared/warsaw-day.js';
import type { DigestCandidateRow, DigestRepository } from './ports.js';
import { CANDIDATE_LIMIT, DIGEST_WINDOW_DAYS, pickTop, pickWeak } from './select.js';

export interface DigestDeps {
  repository: DigestRepository;
  pipeline: PipelineRepository;
  clock: Clock;
}

const DAY_MS = 86_400_000;

const toDigestItem = (row: DigestCandidateRow): DigestItem => ({
  id: row.id,
  title: row.title,
  category: row.category,
  evidenceLevel: row.evidenceLevel,
  score: row.score,
  nextAction: row.nextAction,
  // Only the mock produces DEMO / MOCK results (as in the opportunities module).
  demo: row.provider === 'mock',
  businessStatus: row.businessStatus,
  createdAt: new Date(row.createdAt).toISOString(),
});

export function createDigestService(deps: DigestDeps) {
  return {
    today(query: DigestQuery): DigestToday {
      const { repository, pipeline } = deps;
      const now = deps.clock.now();
      const dayStart = startOfWarsawDay(now).getTime();
      const minScore = query.minScore ?? DEFAULT_MIN_SCORE;

      const candidates = repository.candidates(
        now.getTime() - DIGEST_WINDOW_DAYS * DAY_MS,
        CANDIDATE_LIMIT,
      );
      const top = pickTop(candidates, minScore);
      const followUpsDue = pipeline.followUpsDue(dayStart).map(toItem);

      // D-10: a promise already made to a real person comes before a new lead.
      const owed = followUpsDue[0];
      const lead = top[0];
      const bestNextStep: DigestToday['bestNextStep'] =
        owed?.followUpOn != null
          ? {
              kind: 'follow_up',
              opportunityId: owed.id,
              title: owed.title,
              followUpOn: owed.followUpOn,
            }
          : lead?.nextAction != null
            ? {
                kind: 'opportunity',
                opportunityId: lead.id,
                title: lead.title,
                nextAction: lead.nextAction,
              }
            : null;

      return DigestToday.parse({
        date: instantToWarsawDate(now),
        minScore,
        sources: repository.sourceHealth(),
        newSignals: repository.countSignalsSince(dayStart),
        newAboveThreshold: repository.countMainScoredSince(dayStart, minScore),
        top: top.map(toDigestItem),
        bestNextStep,
        followUpsDue,
        llm: repository.llmUsageSince(dayStart),
        weakSignals: pickWeak(candidates).map(toDigestItem),
      });
    },
  };
}
