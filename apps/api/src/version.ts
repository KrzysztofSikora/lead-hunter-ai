import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// `src/` and `dist/` both sit directly below the package root.
const pkgFile = fileURLToPath(new URL('../package.json', import.meta.url));

export const VERSION: string =
  (JSON.parse(readFileSync(pkgFile, 'utf8')) as { version?: string }).version ?? '0.0.0';
