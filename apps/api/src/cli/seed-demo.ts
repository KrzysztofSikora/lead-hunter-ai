import { join, resolve } from 'node:path';
import { loadConfigOrExit } from './config.js';
import { openDb } from '../infrastructure/db/client.js';
import { runMigrations } from '../infrastructure/db/migrate.js';
import { createAnalysisRepository } from '../infrastructure/db/analysis-repository.js';
import { createProfileRepository } from '../infrastructure/db/profile-repository.js';
import { createSignalRepository } from '../infrastructure/db/signal-repository.js';
import { MockProvider } from '../infrastructure/llm/mock.js';
import { createAnalysisRunner } from '../modules/analysis/service.js';
import { contentHash } from '../modules/signals/identity.js';
import { ingest } from '../modules/signals/ingest.js';
import { createProfileService } from '../modules/profile/service.js';

const DEFAULT_COUNT = 10_000;
const MAX_COUNT = 50_000;
const BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const SPREAD_DAYS = 25;

// Fictional phrases only (PRD §16.1): no names, companies, URLs or contacts.
const OPENINGS = [
  'Szukam programisty do',
  'Potrzebujemy wykonawcy do',
  'Looking for a freelancer for',
  'Poszukujemy podwykonawcy do',
  'Mamy problem: nie działa',
  'Hiring a developer for',
  'Zlecę wykonanie',
  'Needed: a contractor for',
];
const TOPICS = [
  'integracji API z systemem magazynowym',
  'prototypu czujnika na ESP32',
  'automatyzacji raportów w Node.js',
  'aplikacji webowej w React i TypeScript',
  'bramki LoRa na Raspberry Pi',
  'panelu administracyjnego',
  'a TypeScript service with a REST API',
  'an IoT sensor dashboard',
  'migracji danych między dwoma systemami',
  'a small LLM-based assistant',
  'aplikacji: TypeScript, React, integracje API, automatyzacje',
  'an IoT prototype: ESP32, LoRa, Raspberry Pi, TypeScript',
];
const TERMS = [
  'Budżet 4000 PLN.',
  'Budget 1500 EUR.',
  'Stawka do ustalenia.',
  'Płatność po odbiorze, budżet 8000-12000 zł.',
  'Fully remote.',
  'Praca zdalna, termin za 3 tygodnie.',
  'On-site in the client office, budget 3000 USD.',
  'Szczegóły po kontakcie, bez podanej kwoty.',
];

function parseCount(args: readonly string[]): number | null {
  const rest = args.filter((arg) => arg !== '--');
  if (rest.length === 0) return DEFAULT_COUNT;
  const value = rest[0] === '--count' ? rest[1] : undefined;
  if (rest.length !== 2 || value === undefined || !/^\d+$/.test(value)) return null;
  const count = Number(value);
  return count >= 1 && count <= MAX_COUNT ? count : null;
}

const pick = <T>(list: readonly T[], i: number, step: number): T => list[(i * step) % list.length]!;

function snippetOf(i: number): { title: string; snippet: string } {
  const title = `DEMO ${i}: ${pick(OPENINGS, i, 1)} ${pick(TOPICS, i, 5)}`;
  const snippet = `${title}. ${pick(TERMS, i, 7)} ${pick(TERMS, i, 5)} Zgłoszenie testowe numer ${i}.`;
  return { title, snippet };
}

/**
 * pi-deployment D-2: fills an empty database with synthetic `DEMO` signals through the real
 * ingest path and scores them with the mock provider, for the NFR-01/NFR-02 measurements.
 */
async function main(): Promise<number> {
  const count = parseCount(process.argv.slice(2));
  if (count === null) {
    process.stderr.write(`użycie: seed:demo [--count N]  (N od 1 do ${MAX_COUNT})\n`);
    return 1;
  }
  const config = loadConfigOrExit();
  const { sqlite, db } = openDb(join(resolve(config.dataDir), 'lead-hunter.db'));
  try {
    runMigrations(db);
    if (sqlite.prepare('SELECT 1 FROM opportunities LIMIT 1').get() !== undefined) {
      process.stderr.write('baza nie jest pusta — seed:demo działa tylko na pustej bazie\n');
      return 1;
    }
    const started = Date.now();
    const clock = { now: () => new Date() };
    const signals = createSignalRepository(db);
    const now = clock.now().getTime();
    for (let from = 0; from < count; from += BATCH) {
      const to = Math.min(from + BATCH, count);
      signals.transaction((tx) => {
        for (let i = from; i < to; i += 1) {
          const { title, snippet } = snippetOf(i);
          ingest(tx, {
            sourceType: 'manual_text',
            sourceId: null,
            externalId: null,
            sourceUrl: null,
            canonicalUrl: null,
            title,
            snippet,
            publishedAt: null,
            contentHash: contentHash(snippet),
            at: now - Math.floor((i / count) * SPREAD_DAYS * DAY_MS),
            sourceFact: snippet,
          });
        }
      });
    }

    const profile = createProfileService({ repository: createProfileRepository(db), clock });
    profile.ensureExample();
    const runner = createAnalysisRunner({
      repository: createAnalysisRepository(db),
      provider: new MockProvider(),
      profile: { get: () => profile.get().profile },
      clock,
      dailyLimit: count,
      maxAgeDays: config.prefilterMaxAgeDays,
      onError: (error) => {
        throw error;
      },
    });
    await runner.drain();

    const countStatus = (status: string): number =>
      (
        sqlite.prepare('SELECT COUNT(*) AS n FROM analyses WHERE status = ?').get(status) as {
          n: number;
        }
      ).n;
    const complete = countStatus('COMPLETE');
    const failed = countStatus('FAILED');
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    process.stdout.write(
      `zapisano ${count} sygnałów DEMO, przeanalizowano ${complete}, błędy ${failed} (${seconds} s)\n`,
    );
    if (failed > 0 || complete !== count) {
      process.stderr.write('nie wszystkie sygnały zostały przeanalizowane\n');
      return 1;
    }
    return 0;
  } finally {
    sqlite.close();
  }
}

process.exitCode = await main();
