import {
  INSIGHTS_MAX_YEAR,
  INSIGHTS_MIN_YEAR,
  Insights,
  isoWeeksInYear,
  type InsightsQuery,
} from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';
import {
  addCalendarDays,
  instantToWarsawDate,
  isoWeekOf,
  isoWeekStartDate,
  warsawDateToInstant,
} from '../shared/warsaw-day.js';
import { calculateInsights } from './calculate.js';
import type { InsightsRepository } from './ports.js';

export interface InsightsDeps {
  repository: InsightsRepository;
  clock: Clock;
}

type Period = Insights['period'];

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const inYears = (year: number) => year >= INSIGHTS_MIN_YEAR && year <= INSIGHTS_MAX_YEAR;
const weekKey = (year: number, week: number) => `${year}-W${pad(week)}`;
const monthKey = (year: number, month: number) => `${year}-${pad(month)}`;

function weekPeriod(year: number, week: number): Omit<Period, 'current'> {
  const from = isoWeekStartDate(year, week);
  const last = week === isoWeeksInYear(year);
  const [prevYear, prevWeek] = week === 1 ? [year - 1, isoWeeksInYear(year - 1)] : [year, week - 1];
  const [nextYear, nextWeek] = last ? [year + 1, 1] : [year, week + 1];
  return {
    kind: 'week',
    key: weekKey(year, week),
    from,
    to: addCalendarDays(from, 6),
    previous: inYears(prevYear) ? weekKey(prevYear, prevWeek) : null,
    next: inYears(nextYear) ? weekKey(nextYear, nextWeek) : null,
  };
}

function monthPeriod(year: number, month: number): Omit<Period, 'current'> {
  const from = `${year}-${pad(month)}-01`;
  const [prevYear, prevMonth] = month === 1 ? [year - 1, 12] : [year, month - 1];
  const [nextYear, nextMonth] = month === 12 ? [year + 1, 1] : [year, month + 1];
  return {
    kind: 'month',
    key: monthKey(year, month),
    from,
    to: addCalendarDays(`${nextYear}-${pad(nextMonth)}-01`, -1),
    previous: inYears(prevYear) ? monthKey(prevYear, prevMonth) : null,
    next: inYears(nextYear) ? monthKey(nextYear, nextMonth) : null,
  };
}

export function createInsightsService(deps: InsightsDeps) {
  return {
    /** D-1: the week or month of the query; the current ISO week without one. */
    get(query: InsightsQuery): Insights {
      const today = instantToWarsawDate(deps.clock.now());
      const period =
        query.month !== undefined
          ? monthPeriod(Number(query.month.slice(0, 4)), Number(query.month.slice(5)))
          : query.week !== undefined
            ? weekPeriod(Number(query.week.slice(0, 4)), Number(query.week.slice(6)))
            : (() => {
                const { year, week } = isoWeekOf(today);
                return weekPeriod(year, week);
              })();
      const from = warsawDateToInstant(period.from).getTime();
      const to = warsawDateToInstant(addCalendarDays(period.to, 1)).getTime();
      const { repository } = deps;
      const calculated = calculateInsights({
        from,
        to,
        events: repository.operatorStatusEvents(),
        sentDrafts: repository.sentDrafts(from, to),
        payments: repository.payments(from, to),
        work: repository.workEntries(from, to),
      });
      return Insights.parse({
        period: { ...period, current: period.from <= today && today <= period.to },
        ...calculated,
      });
    },
  };
}
