import { afterEach, describe, expect, it, vi } from 'vitest';
import { retryWhileBusy, startScheduler, type Scheduler } from './schedule.js';

const clock = { now: () => new Date() };
const HOUR = 3_600_000;

let scheduler: Scheduler | undefined;
afterEach(() => {
  scheduler?.stop();
  scheduler = undefined;
  vi.useRealTimers();
});

function collect(from: string, until: string, times = ['08:00', '18:00']): Promise<string[]> {
  vi.useFakeTimers({ now: new Date(from) });
  const slots: string[] = [];
  scheduler = startScheduler({
    times,
    onSlot: (slot) => slots.push(new Date(slot).toISOString()),
    analysisTick: () => undefined,
    tickMs: 24 * HOUR,
    clock,
  });
  return vi
    .advanceTimersByTimeAsync(new Date(until).getTime() - new Date(from).getTime())
    .then(() => slots);
}

describe('startScheduler', () => {
  // Europe/Warsaw is UTC+2 until the last Sunday of October and from the last Sunday of March.
  it.each([
    [
      'autumn change (2026-10-25)',
      '2026-10-24T22:00:00Z',
      '2026-10-25T22:00:00Z',
      ['2026-10-25T07:00:00.000Z', '2026-10-25T17:00:00.000Z'],
    ],
    [
      'spring change (2027-03-28)',
      '2027-03-27T22:00:00Z',
      '2027-03-28T22:00:00Z',
      ['2027-03-28T06:00:00.000Z', '2027-03-28T16:00:00.000Z'],
    ],
    [
      'autumn change (2027-10-31)',
      '2027-10-30T22:00:00Z',
      '2027-10-31T22:00:00Z',
      ['2027-10-31T07:00:00.000Z', '2027-10-31T17:00:00.000Z'],
    ],
  ])(
    'fires exactly once per slot across the %s',
    { timeout: 30_000 },
    async (_name, from, until, expected) => {
      const slots = await collect(from, until);
      expect(slots).toEqual(expected);
    },
  );

  it('gives an early fire the same slot key as the exact minute', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T06:59:59.990Z') });
    const slots: number[] = [];
    scheduler = startScheduler({
      times: ['08:00'],
      onSlot: (slot) => slots.push(slot),
      analysisTick: () => undefined,
      // The timer fires 10 ms early; the clock the callback reads is that early instant.
      clock: {
        now: () =>
          new Date(
            Date.parse('2026-11-02T06:59:59.990Z') +
              (Date.now() - Date.parse('2026-11-02T06:59:59.990Z')),
          ),
      },
    });
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(slots).toEqual([Date.parse('2026-11-02T07:00:00Z')]);
  });

  it('resumes at the next slot after a restart and does not catch up the missed one', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T05:00:00Z') });
    const first: number[] = [];
    scheduler = startScheduler({
      times: ['08:00'],
      onSlot: (s) => first.push(s),
      analysisTick: () => undefined,
      clock,
    });
    scheduler.stop();
    // The process was down over 08:00 Warsaw (07:00 UTC) and comes back at 09:00 UTC.
    await vi.advanceTimersByTimeAsync(4 * HOUR);
    expect(first).toEqual([]);
    const second: string[] = [];
    scheduler = startScheduler({
      times: ['08:00'],
      onSlot: (s) => second.push(new Date(s).toISOString()),
      analysisTick: () => undefined,
      clock,
    });
    expect(scheduler.nextRunAt()?.toISOString()).toBe('2026-11-03T07:00:00.000Z');
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(second).toEqual(['2026-11-03T07:00:00.000Z']);
  });

  it('ticks the analysis every 10 minutes and stop() ends both timers', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T00:00:00Z') });
    const tick = vi.fn();
    const onSlot = vi.fn();
    scheduler = startScheduler({ times: ['08:00'], onSlot, analysisTick: tick, clock });
    await vi.advanceTimersByTimeAsync(35 * 60_000);
    expect(tick).toHaveBeenCalledTimes(3);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(onSlot).not.toHaveBeenCalled();
  });

  it('reports the earliest next run across the configured times', () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T08:00:00Z') });
    scheduler = startScheduler({
      times: ['18:00', '08:00'],
      onSlot: () => undefined,
      analysisTick: () => undefined,
      clock,
    });
    expect(scheduler.nextRunAt()?.toISOString()).toBe('2026-11-02T17:00:00.000Z');
  });
});

describe('retryWhileBusy', () => {
  it('tries again until the lock is free, then stops', async () => {
    vi.useFakeTimers();
    let busyFor = 2;
    const attempt = vi.fn(() => (busyFor-- > 0 ? ('busy' as const) : ('done' as const)));
    retryWhileBusy(attempt, { retryMs: 30_000, windowMs: 30 * 60_000 });
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(attempt).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('gives up when the window ends', async () => {
    vi.useFakeTimers();
    const onGiveUp = vi.fn();
    const attempt = vi.fn(() => 'busy' as const);
    retryWhileBusy(attempt, { retryMs: 30_000, windowMs: 60_000, onGiveUp });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it('reports a throwing retry instead of crashing, and stops', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const onSettled = vi.fn();
    let calls = 0;
    const attempt = vi.fn((): 'busy' | 'done' => {
      if (++calls === 2) throw new Error('SQLITE_BUSY');
      return 'busy';
    });
    retryWhileBusy(attempt, { retryMs: 30_000, windowMs: 30 * 60_000, onError, onSettled });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});
