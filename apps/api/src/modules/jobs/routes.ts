import { JobList, JobListQuery, JobRun } from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { JobsService } from './service.js';

/** D-10: when the next scheduled cycle starts; the scheduler owns it, the list only shows it. */
export interface ScheduleInfo {
  times: string[];
  nextRunAt(): Date | null;
}

export interface JobRouteDeps {
  jobs: JobsService;
  schedule: ScheduleInfo;
}

const Busy = z.object({ error: z.literal('busy') }).strict();

export function registerJobRoutes(app: FastifyInstance, { jobs, schedule }: JobRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // Brief §15. The cycle runs on after the answer; the list shows how it ends (D-10).
  typed.post(
    '/api/jobs/discover',
    { schema: { response: { 202: JobRun, 409: Busy } } },
    async (_request, reply) => {
      const started = jobs.startCycle('manual');
      if (started.kind !== 'started') return reply.code(409).send({ error: 'busy' });
      // The outcome is stored on the row; an error here must not become an unhandled rejection.
      started.done.catch(() => undefined);
      const [run] = jobs.list({ page: 1, pageSize: 1, id: started.runId }).items;
      return reply.code(202).send(run as JobRun);
    },
  );

  typed.get(
    '/api/jobs',
    { schema: { querystring: JobListQuery, response: { 200: JobList } } },
    async (request) => ({
      ...jobs.list(request.query),
      schedule: {
        timezone: 'Europe/Warsaw' as const,
        times: schedule.times,
        nextRunAt: schedule.nextRunAt()?.toISOString() ?? null,
      },
    }),
  );
}
