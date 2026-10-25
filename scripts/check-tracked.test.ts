import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { findForbidden } from './check-tracked.ts';

describe('findForbidden', () => {
  it.each([
    '.env',
    'apps/api/.env',
    '.env.local',
    '.env.production',
    'data/lead-hunter.db',
    'apps/api/data/x',
    'lead-hunter.db',
    'x.sqlite',
    'lead-hunter.db-wal',
    'backups/a.tar',
    'ops/backups/a',
    'logs/app.txt',
    'x.log',
    'config/profile.local.json',
  ])('flags %s', (path) => {
    expect(findForbidden([path])).toEqual([path]);
  });

  it.each([
    '.env.example',
    'apps/api/src/app.ts',
    'docs/workflow.md',
    'config/profile.example.json',
  ])('allows %s', (path) => {
    expect(findForbidden([path])).toEqual([]);
  });

  it('returns only the offending paths, in order', () => {
    expect(findForbidden(['a.ts', '.env', 'b.ts', 'x.log'])).toEqual(['.env', 'x.log']);
  });
});

describe('.gitignore', () => {
  it.each([
    '.env',
    'data/x.db',
    'backups/a.db',
    'logs/a.log',
    'x.log',
    'config/profile.local.json',
  ])('ignores %s', (path) => {
    // exit code 0 means ignored; execFileSync throws otherwise
    expect(() => execFileSync('git', ['check-ignore', '-q', path])).not.toThrow();
  });
});
