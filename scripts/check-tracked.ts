import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Files that must never be tracked (PRD §16.1, FR-24 AC1): secrets, databases, backups, logs.
const FORBIDDEN: RegExp[] = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)/,
  /\.(db|sqlite)$/,
  /\.db-/,
  /(^|\/)backups\//,
  /(^|\/)logs\//,
  /\.log$/,
  /(^|\/)config\/profile\.local\./,
  /(^|\/)data\//,
];

export function findForbidden(paths: string[]): string[] {
  return paths.filter((p) => FORBIDDEN.some((re) => re.test(p)));
}

function main(): void {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const bad = findForbidden(tracked);
  if (bad.length > 0) {
    console.error(`Tracked files that must stay private:\n${bad.map((p) => `  ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`ok: ${tracked.length} tracked files, none private`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
