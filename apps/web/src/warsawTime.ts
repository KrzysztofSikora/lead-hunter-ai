const ZONE = 'Europe/Warsaw';

const wallClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function wallParts(instant: number): Wall {
  const values = new Map<string, number>();
  for (const part of wallClock.formatToParts(instant)) {
    if (part.type !== 'literal') values.set(part.type, Number(part.value));
  }
  const get = (type: string) => values.get(type) ?? Number.NaN;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Milliseconds Europe/Warsaw is ahead of UTC at `instant` (3 600 000 or 7 200 000). */
function offsetAt(instant: number): number {
  const p = wallParts(instant);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    Math.floor(instant / 1000) * 1000
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-10-25T10:00:00Z` → `25.10.2026 12:00` (Europe/Warsaw). */
export function formatWarsaw(iso: string): string {
  const p = wallParts(Date.parse(iso));
  return `${pad(p.day)}.${pad(p.month)}.${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isCalendarDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** The UTC instant (ISO) at which the Warsaw calendar day `date` (`YYYY-MM-DD`) begins. */
export function warsawDayStart(date: string): string {
  const match = DATE.exec(date);
  if (!match) throw new Error(`not a calendar date: ${date}`);
  const asUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // Midnight never falls inside a DST gap here, so two passes settle the offset.
  const first = asUtc - offsetAt(asUtc);
  return new Date(asUtc - offsetAt(first)).toISOString();
}

/** The UTC instant (ISO) at which the Warsaw day after `date` begins: an exclusive upper bound. */
export function warsawDayEnd(date: string): string {
  const match = DATE.exec(date);
  if (!match) throw new Error(`not a calendar date: ${date}`);
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return warsawDayStart(next.toISOString().slice(0, 10));
}
