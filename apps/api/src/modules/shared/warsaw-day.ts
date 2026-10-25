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
