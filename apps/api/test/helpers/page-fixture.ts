import { readFileSync } from 'node:fs';

const DIR = new URL('../fixtures/pages/', import.meta.url);

/**
 * Reads a page fixture as bytes. Fixtures in a legacy charset are stored as ASCII with `\xNN`
 * escapes, because Stryker's sandbox re-encodes files as UTF-8 and would corrupt raw bytes.
 */
export function pageFixture(name: string): Buffer {
  const text = readFileSync(new URL(name, DIR), 'latin1');
  return Buffer.from(
    text.replace(/\\x([0-9a-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
    'latin1',
  );
}
