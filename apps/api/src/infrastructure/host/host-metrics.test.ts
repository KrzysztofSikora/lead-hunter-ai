import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHostMetrics } from './host-metrics.js';

const AT = new Date('2026-05-01T10:00:00Z');

function sysWith(temp: string | null): string {
  const root = mkdtempSync(path.join(tmpdir(), 'lh-sys-'));
  if (temp !== null) {
    mkdirSync(path.join(root, 'class/thermal/thermal_zone0'), { recursive: true });
    writeFileSync(path.join(root, 'class/thermal/thermal_zone0/temp'), temp);
  }
  return root;
}

const reader = (over: Parameters<typeof createHostMetrics>[0] = {}) =>
  createHostMetrics({
    platform: 'linux',
    loadavg: () => [1.234, 0.5, 0.1],
    cpuCount: () => 4,
    now: () => AT,
    ...over,
  });

describe('host metrics (FR-34 AC5)', () => {
  it('reads temperature in °C and the 1-minute load with the measurement time', async () => {
    expect(await reader({ sysRoot: sysWith('52345\n') }).read()).toEqual({
      temperatureC: 52.3,
      load1: 1.23,
      cpuCount: 4,
      measuredAt: AT,
    });
  });

  it.each([
    ['a missing file', null],
    ['garbage', 'hot'],
    ['an empty file', ''],
    ['a decimal', '52.3'],
  ])('reports %s as unavailable, never 0', async (_name, content) => {
    const snapshot = await reader({ sysRoot: sysWith(content) }).read();
    expect(snapshot.temperatureC).toBeNull();
    expect(snapshot.load1).toBe(1.23);
  });

  it('keeps a real reading of 0 °C', async () => {
    expect((await reader({ sysRoot: sysWith('0') }).read()).temperatureC).toBe(0);
  });

  it('reports nothing on a platform without sysfs and load', async () => {
    const snapshot = await reader({ platform: 'win32', sysRoot: sysWith('50000') }).read();
    expect(snapshot).toEqual({ temperatureC: null, load1: null, cpuCount: null, measuredAt: AT });
  });

  it('survives a failing load source', async () => {
    const snapshot = await reader({
      sysRoot: sysWith(null),
      loadavg: () => {
        throw new Error('no');
      },
    }).read();
    expect(snapshot).toMatchObject({ temperatureC: null, load1: null, cpuCount: null });
  });
});
