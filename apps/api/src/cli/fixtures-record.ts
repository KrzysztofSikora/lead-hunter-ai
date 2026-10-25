import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RssConfig } from '@lead-hunter/contracts';
import { loadConfigOrExit } from './config.js';
import { openDb } from '../infrastructure/db/client.js';
import { runMigrations } from '../infrastructure/db/migrate.js';
import { createSourceRepository } from '../infrastructure/db/source-repository.js';
import { createHttpClient, HttpFetchError } from '../infrastructure/sources/http/client.js';
import { createRobotsCheck } from '../infrastructure/sources/manual/robots.js';
import { anonymiseFeed } from '../infrastructure/sources/rss/anonymise-feed.js';
import { parseFeed } from '../infrastructure/sources/rss/parse-feed.js';
import { VERSION } from '../version.js';

const FIXTURES = fileURLToPath(new URL('../../test/fixtures/feeds/', import.meta.url));

/** D-20: record the first entries of a configured feed as an anonymised fixture. */
async function main(): Promise<number> {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || id < 1) {
    process.stderr.write('użycie: pnpm fixtures:record <id źródła>\n');
    return 1;
  }
  const config = loadConfigOrExit();
  const { sqlite, db } = openDb(join(resolve(config.dataDir), 'lead-hunter.db'));
  try {
    runMigrations(db);
    const source = createSourceRepository(db).get(id);
    if (!source) {
      process.stderr.write(`nie ma źródła ${id}\n`);
      return 1;
    }
    if (source.nextAllowedAt !== null && source.nextAllowedAt > Date.now()) {
      process.stderr.write(
        `źródło prosiło o czekanie do ${new Date(source.nextAllowedAt).toISOString()}\n`,
      );
      return 1;
    }
    const feed = RssConfig.parse(JSON.parse(source.configJson));
    const clock = { now: () => new Date() };
    const http = createHttpClient({
      userAgent: `LeadHunterAI/${VERSION} (+https://github.com/KrzysztofSikora/lead-hunter-ai)`,
      maxBytes: config.fetchMaxBytes,
    });
    const robots = createRobotsCheck({ http, userAgentToken: 'LeadHunterAI', clock });
    const signal = AbortSignal.timeout(config.fetchTimeoutMs);
    let response;
    try {
      response = await http.get(feed.url, {
        signal,
        accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
        beforeHop: (hop) => robots.check(hop, signal),
      });
    } catch (error) {
      if (!(error instanceof HttpFetchError)) throw error;
      process.stderr.write(`nie pobrano kanału: ${error.reason}\n`);
      return 1;
    }
    if (response.status < 200 || response.status >= 300) {
      process.stderr.write(`kanał odpowiedział ${response.status}\n`);
      return 1;
    }
    const xml = anonymiseFeed(new TextDecoder().decode(response.body));
    const parsed = parseFeed(
      new TextEncoder().encode(xml),
      response.url,
      config.importMaxTextChars,
    );
    if (parsed === 'invalid_feed' || parsed.items.length === 0) {
      process.stderr.write('po anonimizacji kanał nie daje żadnego wpisu; nic nie zapisano\n');
      return 1;
    }
    mkdirSync(FIXTURES, { recursive: true });
    const file = join(FIXTURES, `${source.presetId ?? `source-${source.id}`}.xml`);
    writeFileSync(file, xml);
    process.stdout.write(
      `zapisano ${file} (${parsed.items.length} wpisów); przejrzyj plik przed commitem\n`,
    );
    return 0;
  } finally {
    sqlite.close();
  }
}

process.exitCode = await main();
