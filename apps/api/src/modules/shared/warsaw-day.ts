const TIME_ZONE = 'Europe/Warsaw';

const dayParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const offsetParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  timeZoneName: 'longOffset',
});

function offsetMinutes(at: Date): number {
  const name = offsetParts.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? '');
  if (!match) return 0; // 'GMT' alone means offset zero
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * The instant at which the Europe/Warsaw calendar day containing `instant` began (D-9).
 * Midnight local time is never inside a DST gap (the switch happens at 01:00 UTC), so the offset
 * two hours before UTC midnight of that date is the offset in force at local midnight.
 */
export function startOfWarsawDay(instant: Date): Date {
  const get = (type: string) =>
    Number(dayParts.formatToParts(instant).find((part) => part.type === type)?.value);
  const utcMidnight = Date.UTC(get('year'), get('month') - 1, get('day'));
  const offset = offsetMinutes(new Date(utcMidnight - 2 * 3_600_000));
  return new Date(utcMidnight - offset * 60_000);
}

/** The instant at which the Europe/Warsaw calendar month containing `instant` began (D-5). */
export function startOfWarsawMonth(instant: Date): Date {
  const get = (type: string) =>
    Number(dayParts.formatToParts(instant).find((part) => part.type === type)?.value);
  const utcMidnight = Date.UTC(get('year'), get('month') - 1, 1);
  const offset = offsetMinutes(new Date(utcMidnight - 2 * 3_600_000));
  return new Date(utcMidnight - offset * 60_000);
}

/** S-08 D-5: the instant a `YYYY-MM-DD` Europe/Warsaw calendar day begins (a real date is assumed). */
export function warsawDateToInstant(date: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(year, month - 1, day);
  const offset = offsetMinutes(new Date(utcMidnight - 2 * 3_600_000));
  return new Date(utcMidnight - offset * 60_000);
}

/** The Europe/Warsaw calendar day containing `instant`, as `YYYY-MM-DD`. */
export function instantToWarsawDate(instant: Date): string {
  const get = (type: string) =>
    dayParts.formatToParts(instant).find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const DAY_MS = 86_400_000;
const dateOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** S-14: the ISO 8601 week (Monday start) that contains the calendar date `YYYY-MM-DD`. */
export function isoWeekOf(date: string): { year: number; week: number } {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const utc = Date.UTC(year, month - 1, day);
  const mondayBased = (new Date(utc).getUTCDay() + 6) % 7;
  const thursday = new Date(utc + (3 - mondayBased) * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / DAY_MS / 7) + 1;
  return { year: isoYear, week };
}

/** S-14: the Monday (`YYYY-MM-DD`) on which ISO week `week` of `year` starts. */
export function isoWeekStartDate(year: number, week: number): string {
  const jan4 = Date.UTC(year, 0, 4);
  const mondayOfWeek1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
  return dateOf(mondayOfWeek1 + (week - 1) * 7 * DAY_MS);
}

/** S-14: `YYYY-MM-DD` shifted by whole days (pure calendar arithmetic, no DST involved). */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return dateOf(Date.UTC(year, month - 1, day) + days * DAY_MS);
}

export { isoWeeksInYear } from '@lead-hunter/contracts';
