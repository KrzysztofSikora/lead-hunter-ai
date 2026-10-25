import type Database from 'better-sqlite3';
import type { HealthProbe } from '../../modules/health/ports.js';

export function createHealthProbe(sqlite: Database.Database): HealthProbe {
  return {
    check() {
      try {
        sqlite.prepare('select 1').get();
        const row = sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as {
          n: number;
        };
        return { ok: true, migrations: row.n };
      } catch {
        return { ok: false, migrations: 0 };
      }
    },
  };
}
