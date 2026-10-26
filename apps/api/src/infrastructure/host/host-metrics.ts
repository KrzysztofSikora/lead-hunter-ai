import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { HostMetrics } from '../../modules/analysis/ports.js';

export interface HostMetricsOptions {
  /** Where `/sys` is mounted; tests point it at a temporary directory. */
  sysRoot?: string;
  platform?: NodeJS.Platform;
  loadavg?: () => number[];
  cpuCount?: () => number;
  now?: () => Date;
}

const THERMAL = 'class/thermal/thermal_zone0/temp';

const finite = (value: number): number | null => (Number.isFinite(value) ? value : null);

/**
 * D-7 (S-20), FR-34 AC5: CPU temperature (millidegrees Celsius in sysfs) and the 1-minute load.
 * A value that cannot be read is `null`, never 0; nothing here throws.
 */
export function createHostMetrics(options: HostMetricsOptions = {}): HostMetrics {
  const sysRoot = options.sysRoot ?? '/sys';
  const platform = options.platform ?? process.platform;
  const loadavg = options.loadavg ?? os.loadavg;
  const cpuCount = options.cpuCount ?? (() => os.cpus().length);
  const now = options.now ?? (() => new Date());

  async function temperature(): Promise<number | null> {
    if (platform !== 'linux') return null;
    try {
      const raw = (await readFile(path.join(sysRoot, THERMAL), 'utf8')).trim();
      if (!/^-?\d+$/.test(raw)) return null;
      const celsius = finite(Number(raw) / 1000);
      return celsius === null ? null : Math.round(celsius * 10) / 10;
    } catch {
      return null;
    }
  }

  function load(): { load1: number | null; cpuCount: number | null } {
    try {
      const one = finite(loadavg()[0] ?? Number.NaN);
      const cpus = cpuCount();
      // `os.loadavg()` is all zeros on Windows, where it is not a measurement.
      if (one === null || platform === 'win32') return { load1: null, cpuCount: null };
      return {
        load1: Math.round(one * 100) / 100,
        cpuCount: Number.isInteger(cpus) && cpus > 0 ? cpus : null,
      };
    } catch {
      return { load1: null, cpuCount: null };
    }
  }

  return {
    async read() {
      const temperatureC = await temperature();
      return { temperatureC, ...load(), measuredAt: now() };
    },
  };
}
