# Plan: rss-sources (S-10)

## Goal and end state
The operator opens a new **Źródła** view (`/zrodla`, brief §11.5), adds "Hacker News — Seeking
freelancer" or a "We Work Remotely — <category>" feed in one step, or any other RSS/Atom URL by
hand (FR-04 AC2). Each source shows its access method and limits (AC7), whether it is enabled,
its last attempt, last success and last error with a reason (FR-18 AC3), and has **Uruchom
teraz** and **Sprawdź** buttons. A run fetches the feed once through the S-09 guarded client
(SSRF guard, timeout, size limit, robots.txt), maps every new entry to a raw signal with source,
URL, title, snippet, `publishedAt` or null, `fetchedAt` and content hash, and the entry appears in
*Okazje* with the source's name and date (AC1); a WWR entry names "We Work Remotely" and links to
the WWR URL (AC6). A second run creates no duplicates (cursor plus identity table, AC5). An
unreachable feed, a non-2xx answer or invalid XML records an explicit error on the source and a
failed job run, leaves earlier signals untouched and does not stop other sources (AC3). `429`/`503`
are retried with exponential backoff within the run, then recorded, and the next attempt waits at
least `max(Retry-After, 1 h)` (AC4, A-03). New signals enter the existing pre-filter and analysis
path. `docs/source-policy.md` lists each adapter's access method, terms link and limits (FR-26 AC2,
first entries). `pnpm discover` runs every enabled source once.

## Scope
- In: `SourceAdapter` port (brief §5.2: `discover`, `validateConfig`, `healthCheck`); RSS 2.0 /
  Atom adapter with fast-xml-parser (tech-stack); presets (D-01 of shape: HN freelance, optional
  HN `jobs?q=contract`, WWR programming, full-stack, back-end, devops); `sources` and `job_runs`
  tables, `raw_signals.source_id`/`external_id`; `external_id` identity kind; routes `GET/POST
  /api/sources`, `PATCH /api/sources/:id`, `POST /api/sources/:id/run`, `POST
  /api/sources/:id/check`; real `SourceStatusReader` for the empty state; source name on list and
  card; Sources view; `pnpm discover` over enabled sources; `pnpm fixtures:record`;
  `docs/source-policy.md`; README and `.env.example` updates.
- Out: scheduler, job lock, `POST /api/jobs/discover`, `GET /api/jobs`, run history list,
  `rejected`/`analysed`/`cost` counters (S-12, FR-17, FR-18 AC1–AC2); daily raw-signal limit
  (FR-09 AC3, S-05); IMAP (S-11); deleting or editing a source's URL; author/organisation and
  feed metadata columns (D-18); availability re-checks of stored items; e2e changes (no network in
  e2e; the two-spec budget is used up).

## Findings
- **Source today.** `raw_signals.source_type` is a free text column, "until `sources` exists
  (S-10)" (`apps/api/src/infrastructure/db/schema.ts:28-31`). `SourceType` is `manual_text |
  manual_url | manual_fetch`, with the comment "S-10/S-11 add `rss` and `imap`"
  (`packages/contracts/src/opportunities.ts:11-13`). The list labels source types from
  `strings.pl.ts:127-131` and filters by `SourceType.options` (`OpportunitiesPage.tsx:186`); the
  list line shows `t.sourceTypes[item.source.type]` (`OpportunitiesPage.tsx:338`).
- **Source status port.** `SourceStatusReader.summary(): SourcesStatus`
  (`modules/opportunities/ports.ts:122`) is stubbed by `noSourcesYet`
  (`infrastructure/sources/source-status.ts:4`, wired at `server.ts:107` and in
  `test/helpers/app.ts`). `SourceError = { source, message, at }`
  (`opportunities.ts:327`); the web prints `error.message` verbatim (`OpportunitiesPage.tsx:315`).
  manual-text-import D-10 says S-10/S-12 replace the stub with job-run data.
- **Identity.** `signal_identities(kind, value)` primary key, first owner wins (D-14 of
  manual-text-import); kinds `canonical_url | content_hash` (`modules/signals/ports.ts:3`). The
  import use case (`modules/signals/service.ts:56-120`) runs lookup → evidence → insert → claim in
  one synchronous transaction; this logic is what a feed item needs too. FR-06 AC1 orders identity
  URL → `externalId` per source → content hash.
- **Pre-filter.** A signal of a non-manual type with zero keyword matches is rejected
  (`modules/analysis/prefilter.ts:118`), so feed noise never reaches the LLM. The runner drains
  pending signals on `kick()` (`modules/analysis/service.ts:61,195`); `server.ts` kicks it from
  `onSignalCreated` and on a 10-minute timer.
- **HTTP client** (`infrastructure/sources/http/client.ts`): `get(url, { signal, accept,
  beforeHop })` returns `{ status, headers, body, url }` for any status, so 429/503 and
  `Retry-After` are visible to the caller; it throws `HttpFetchError(reason)` for guard, timeout,
  size, redirect and network failures; at most 2 requests in flight (NFR-01). robots.txt check
  with a 24 h cache: `createRobotsCheck` (`infrastructure/sources/manual/robots.ts`); the page
  fetcher passes it as `beforeHop` (`manual/page-fetcher.ts:39-43`).
- **Config** (`packages/config/src/env.ts`): every variable is listed in `ENV_VARIABLES`,
  `EnvSchema`, `EXPECTED` and `Config`; `FETCH_TIMEOUT_MS` (20 s) and `FETCH_MAX_BYTES` (1 MiB)
  already exist and apply to feeds (NFR-03).
- **CLI** `apps/api/src/cli/discover.ts` only prints `brak skonfigurowanych źródeł`.
- **Tests.** `apps/api/test/setup.ts` installs a global `MockAgent` with `disableNetConnect()`;
  `test/helpers/app.ts` builds the app with a temp migrated DB. The OpenAPI and auth tests iterate
  the route table, so new routes are covered by them automatically. Test budget
  (`context/test-plan.md`): TR-06 (`test`) needs "run a feed twice → no new signals"; TR-09
  (human), TR-10 (none), TR-17 (human). The roadmap item still asks for parser tests on fixtures
  of both feeds.
- **fast-xml-parser 5.11.2** (MIT, registry checked 2026-10-25; dependencies `@nodable/entities`,
  `strnum`, `is-unsafe`, …). Not yet installed. Defaults (`src/xmlparser/OptionsBuilder.js`):
  `ignoreAttributes: true` (must be `false` for Atom `<link href>`), `parseTagValue: true` (must be
  `false`, or a numeric title becomes a number), `processEntities: true` with DOCTYPE-entity
  limits, `maxNestedTags: 100`. `parser.parse(xml, true)` validates first and throws on invalid
  XML (`src/xmlparser/XMLParser.js:20-35`); `isArray` forces `item`/`entry` to arrays.
- **Real feeds `UNVERIFIED`.** The sandbox proxy refuses `hnrss.org` and `weworkremotely.com`
  (CONNECT 403), so the item format of both feeds and the exact WWR category URLs could not be
  checked. Assumed from public knowledge: hnrss is RSS 2.0, item title `New comment by <user> in
  "Ask HN: Freelancer? Seeking freelancer? (<month>)"`, HTML comment in `description`, `link` and
  `guid` = `https://news.ycombinator.com/item?id=<n>`, `pubDate`, `dc:creator`; WWR is RSS 2.0,
  title `<Company>: <Job title>`, HTML `description`, `link` = `guid` = job URL, `pubDate`; category
  feeds at `https://weworkremotely.com/categories/remote-<slug>-jobs.rss`. The human check of
  Phase 3 confirms or corrects this; presets live in one file (D-11).

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Shape of the `sources` table | Migration 0007: `sources(id, type TEXT 'rss', name, config_json, config_key UNIQUE, preset_id NULL, enabled, cursor_json NULL, next_allowed_at NULL, last_attempt_at NULL, last_success_at NULL, last_error_reason NULL, last_error_status NULL, last_error_at NULL, created_at, updated_at)`. `config_json` is adapter-owned and validated by `validateConfig`; `config_key` is the adapter's identity of a config (RSS: canonical feed URL) so the same feed cannot be added twice. `raw_signals` gains nullable `source_id` (FK → sources) and `external_id`; existing rows stay null | B: typed columns (`url`, `folder`, …) per adapter (plain SQL, but every adapter adds columns; S-11 would migrate again); C: one row per type with all feeds in JSON (no per-feed status, against AC3/AC7) | One row per configured feed carries the per-source status the PRD asks for; JSON config keeps S-11 additive; all columns new or nullable | costly (data shape) | agent |
| D-2 | What a run records now that S-12 owns job history | `job_runs(id, job_type 'source_run', source_id NULL FK, status 'running'/'ok'/'partial'/'failed', started_at, finished_at NULL, fetched, new, duplicates, failed, error_reason NULL, error_status NULL)` written by every run; no list route. S-12 adds `rejected`, `analysed`, `cost` and `GET /api/jobs` | B: only the `sources.last_*` columns (no table now, but AC3 "the job run records an error" has nowhere to live and S-12 recreates history); C: full FR-18 AC1 columns now (counters this slice cannot fill would read 0, which FR-19 AC2's spirit forbids) | AC3 asks for a job-run record; additive columns later are cheap | costly (data shape) | agent |
| D-3 | Cursor that keeps a re-read from reprocessing (AC5) | `cursor_json = { seen: string[] }`: item keys (`guid`, else `link`) of the last successful run plus earlier ones, newest first, capped at 500. Seen items are skipped before normalisation and counted as `duplicates`. The identity table is the backstop, so a lost cursor update never duplicates | B: newest `publishedAt` (tiny, but items without dates or with re-ordered/edited dates are lost or repeated); C: identity table only (no cursor; every run re-hashes every item, and AC5 names a cursor) | Works for feeds without dates; bounded size; adapter-owned JSON is swappable without migration | cheap | agent |
| D-4 | Identity of a feed entry | New kind `external_id` in `signal_identities`, value `<sourceId>:<item key>`; lookup order canonical URL → `external_id` → content hash (FR-06 AC1). The import transaction logic moves unchanged into `modules/signals/ingest.ts` and is shared by manual import and feeds | B: unique index `(source_id, external_id)` on `raw_signals` (a second identity mechanism next to D-14's table); C: URL and hash only (an item whose link changes would duplicate) | One identity table, as manual-text-import D-14 intended; the shared function keeps both paths identical | costly (data shape) | agent |
| D-5 | How the per-source minimum interval (A-03) is enforced, also for manual runs | Every attempt (run or check, manual or scheduled later) first claims the source with one `UPDATE … SET next_allowed_at = now + interval, last_attempt_at = now WHERE id = ? AND enabled AND (next_allowed_at IS NULL OR next_allowed_at <= now)`; 0 rows → refused `too_soon` with `nextAllowedAt`. Interval `SOURCE_MIN_INTERVAL_MINUTES`, default 60, allowed 60–1440 | B: manual runs bypass the interval (handy when testing a new feed, but a quick double tap hits the source twice and breaks A-03's purpose); C: interval only for scheduled runs (S-12) | Politeness to sources ranks above convenience (PRD priorities: lawful access); the atomic claim also stops two overlapping runs of one source until S-12's lock exists | cheap | agent |
| D-6 | Backoff on 429/503 (AC4) | Only 429 and 503 are retried, within one run: up to `SOURCE_MAX_ATTEMPTS` (default 3, 1–5) requests; delay before attempt n+1 = `max(2 s·2^(n-1), Retry-After)`; a `Retry-After` above 30 s (seconds or HTTP-date) stops at once. On failure: reason `rate_limited` with the status, `next_allowed_at = now + max(Retry-After, interval)`. Network errors and timeouts are not retried (recorded; the next attempt is a later run) | B: retry network/timeout too (more resilient, but triples a 20 s timeout inside an HTTP request); C: no in-run retry, only push `next_allowed_at` (simplest, but AC4 asks for in-run backoff) | Meets AC4 with a bounded worst case (3 × 20 s + 2 s + 4 s); the sleep is injected so tests count requests without waiting | cheap | agent |
| D-7 | Is a manual run synchronous? | `POST /api/sources/:id/run` performs the run and answers with its result (`200 SourceRunResult`); the UI shows a pending state on the button | B: `202` + polling of the source (UI never waits a minute, but adds a running state and polling) | Simplest; worst case is bounded by D-6; S-12's whole-cycle run can be async | cheap | agent |
| D-8 | robots.txt for feed URLs | The RSS adapter passes the existing robots check as `beforeHop`, same as page import; `robots_disallowed` is a source error | B: skip robots for feeds (feeds exist for machine readers; one fewer request per day, and a 5xx robots.txt would not block the feed) | CLAUDE.md: no fetching a site forbids; reuse costs nothing; 24 h cache keeps it to one extra request a day | cheap | agent |
| D-9 | What the health check is (FR-18 AC3) | `POST /api/sources/:id/check` runs the adapter's `healthCheck` = the same guarded fetch + parse, storing nothing but the outcome; it claims the interval like a run (D-5). The view shows health as the outcome of the last attempt (run or check): "OK" with the time, or "błąd" with the reason, plus `last_success_at` | B: a check that does not count toward the interval (instant feedback, but two requests within a minute); C: no network, health derived from the last run only (no "check" action, weaker reading of AC3) | One set of status columns for both; respects A-03 | cheap | agent |
| D-10 | HTTP contract | `GET /api/sources` → `{ items: Source[], presets: SourcePreset[] }`; `POST /api/sources` body `{ preset: <id> }` or `{ name, url }` → `201 Source`, `409 { error: "exists" }`; `PATCH /api/sources/:id` `{ enabled }` → `200 Source`; `POST /api/sources/:id/run` → `200 SourceRunResult { status, fetched, new, duplicates, failed, error?, nextAllowedAt }` or `409 { error: "too_soon", nextAllowedAt }` / `409 { error: "disabled" }`; `POST /api/sources/:id/check` → `200 SourceHealth` or the same 409s; `404 { error: "not_found" }`. `SourceError` in `SourcesStatus` becomes `{ sourceId, source, reason, httpStatus?, at }` (replaces `message`, which was never filled) so the web words it in Polish | B: keep `message` and build Polish text in the API (no contract change, but Polish strings outside `strings.pl.ts`, against frontend D-11 of tech-stack); C: `PUT /api/sources/:id` for all fields (more than §15 asks) | Routes are exactly brief §15; every shape lives in `packages/contracts/src/sources.ts` | costly (public API) | agent |
| D-11 | Where presets live and what they say | `apps/api/src/modules/sources/presets.ts`: `{ id, name, url, accessNote, termsUrl }` for `hn-freelance`, `hn-jobs-contract` (optional), `wwr-programming`, `wwr-full-stack`, `wwr-back-end`, `wwr-devops`; served in `GET /api/sources`; a manual source gets a generic access note. WWR URLs follow the `UNVERIFIED` pattern in *Findings* | B: presets in `packages/contracts` (web could render without the API, but URLs would ship in two bundles); C: presets in `.env` (configurable, but AC2 asks for one-step add) | One file to correct after the human check | cheap | agent |
| D-12 | Title of an hnrss item (its feed title is the generic "New comment by …") | When the feed host is `hnrss.org` and the title matches `^New comment by `, the signal title is the first non-blank line of the comment text (existing `deriveTitle`); otherwise the feed title | B: keep the feed title (honest but every HN row reads the same); C: `"<user>: <first line>"` (adds a person's handle to the title) | Makes the list usable; the text is still the source's own words; `UNVERIFIED` until the human check | cheap | agent |
| D-13 | Turning feed XML and HTML descriptions into a bounded snippet (lesson: bound CPU on untrusted input) | fast-xml-parser with `processEntities: false`, `htmlEntities: false`, `ignoreAttributes: false`, `parseTagValue: false`, `isArray` for `item`/`entry`, validation on; then our own linear decoder (XML predefined + numeric entities), a linear tag stripper (block tags → newline) and a second decode for common HTML entities; at most 200 entries per feed; snippet capped at `IMPORT_MAX_TEXT_CHARS`. No DOM parser for feed HTML. A test parses a feed of `FETCH_MAX_BYTES` within 2 s | B: linkedom/Readability on each description (better text, but the url-import-guard lesson shows superlinear cost); C: library entity processing on (handles DOCTYPE entities, but expansion is an attack surface we don't need) | Linear work on input already capped at 1 MiB | cheap | lesson |
| D-14 | Fixtures, given the real feeds cannot be reached from the agent | Phase 1 adds `synthetic-hnrss-freelance.xml`, `synthetic-wwr-programming.xml` (shapes as in *Findings*) and synthetic edge cases (Atom, CDATA, missing date, relative link, escaped HTML, invalid XML). The parser test also runs `it.each` over every non-synthetic file in `test/fixtures/feeds/`, asserting each yields ≥ 1 valid signal, so the files recorded in the human check are tested with no code change | B: wait for real fixtures (blocks the run); C: hand-written "real-looking" files without the `synthetic-` prefix (passes fiction off as a recording) | Truth first; the recorded files join the suite automatically | cheap | agent |
| D-15 | Defaults and refusals around enable/disable | A new source is enabled; a disabled source cannot be run or checked (`409 disabled`); disabling keeps its signals, cursor and status; the same feed twice → `409 exists` (by `config_key`) | B: allow manual runs of disabled sources (test before enabling, but blurs what "disabled" means for S-12) | Clear semantics the scheduler can rely on | cheap | agent |
| D-16 | `pnpm discover` before S-12 | The CLI runs every enabled source once, in order, through the same service and claim (D-5), prints one line per source (`nazwa: nowe N, duplikaty N, błąd …`) and exits 1 if any failed; still prints `brak skonfigurowanych źródeł` with none | B: leave the CLI as is until S-12 (it would then print a false sentence once sources exist) | Truth first; the per-source claim prevents overlap with a UI run until S-12's lock | cheap | agent |
| D-17 | Tests within the test budget | One integration file `apps/api/test/sources.int.test.ts` (AC1, AC2, AC3, AC4, AC5, AC6, AC7, FR-18 AC3, TR-06) and two unit files: `parse-feed.test.ts` (fixtures, edge cases, size bound) and `retry.test.ts` (`Retry-After` seconds/date/garbage, delay table). No web component tests (budget) | B: one integration test only (budget-strict, but parser edge cases through HTTP are clumsy and the roadmap asks for parser tests) | Every AC this item covers is proved by a test (plan rule); the rest is a human check | cheap | agent |
| D-18 | Author/organisation of an entry | Not stored in this slice | B: `raw_signals.author` (brief §5.2 lists it optional; HN usernames are personal data with no current use) | Store only what is needed (§5.4); additive later | cheap | agent |
| D-19 | How the list and card name the source (AC1, AC6) | `SourceFacts` gains `name: string \| null` (the source's name for feed signals, null for manual ones); list line and card show it next to the type label; `SourceType` gains `rss` | B: derive "We Work Remotely" from the URL host in the web (no contract change, but only works for presets) | Additive, nullable field; one place for the name | costly (public API) | agent |
| D-20 | Recording real fixtures safely (test-plan cookbook) | `pnpm fixtures:record <source-id>` fetches the source's feed through the guarded client and writes `apps/api/test/fixtures/feeds/<preset-or-id>.xml` with the first 5 entries, e-mail addresses replaced by `demo@example.com` and `dc:creator`/`author` values by `DEMO`; the person reviews the file before committing | B: raw copy (exact, but commits strangers' e-mail addresses; against PRD §16.1) | Anonymous fixtures by default | cheap | agent |

## Design

### Port (`apps/api/src/modules/sources/ports.ts`)
```ts
interface FeedItem { key: string | null; url: string | null; title: string; text: string; publishedAt: number | null }
type AdapterOutcome =
  | { ok: true; items: FeedItem[]; skipped: number }        // skipped = entries that could not be mapped
  | { ok: false; reason: SourceFailureReason; httpStatus?: number; retryAfterMs?: number };
interface SourceAdapter {
  type: 'rss';
  validateConfig(config: unknown): { ok: true; config: RssConfig; key: string } | { ok: false; issues: string[] };
  discover(config: RssConfig, context: { signal?: AbortSignal }): Promise<AdapterOutcome>;
  healthCheck(config: RssConfig): Promise<AdapterOutcome>;   // same fetch + parse, nothing stored
}
interface SourceRepository { list(); get(id); insert(...); setEnabled(id, enabled, at); claim(id, now, intervalMs): boolean;
  finishAttempt(id, outcome, at, nextAllowedAt); saveCursor(id, cursor); startRun(sourceId, at): runId; finishRun(runId, ...) }
```
The brief's `discover(config, cursor, context)` is kept in spirit: the cursor is applied by the
service (D-3), so the adapter stays a pure fetch-and-map.

`SourceFailureReason = FetchFailureReason | 'invalid_feed' | 'rate_limited'`
(contracts). Reasons are codes; the web words them.

### Run (`modules/sources/service.ts`, `runSource(id, mode: 'run' | 'check')`)
1. `get(id)` → 404; disabled → 409 `disabled`; `claim()` false → 409 `too_soon`.
2. `startRun` (`running`), then `adapter.discover`.
3. Failure: `finishRun(failed, reason)`, `finishAttempt` sets `last_error_*`, `next_allowed_at =
   now + max(retryAfter, interval)`; stored signals are not touched.
4. Success: drop items whose key is in `cursor.seen` (→ duplicates); for each remaining item, one
   `signals.transaction(tx => ingest(tx, candidate))` with `sourceType 'rss'`, `sourceId`,
   `externalId`; `created` → new, `duplicate` → duplicates; an item without URL and text →
   failed. Then save the cursor, `finishRun(ok | partial if failed > 0)`, clear `last_error_*`,
   set `last_success_at`; call `onSignalCreated()` when new > 0.
5. `check` mode stops after the adapter call and only records the attempt outcome.

### RSS adapter (`infrastructure/sources/rss/`)
- `fetch-feed.ts`: per attempt `AbortSignal.timeout(fetchTimeoutMs)`, `http.get(url, { accept:
  'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8', beforeHop:
  robots.check })`; 429/503 → `retry.ts` decides; other non-2xx → `http_status`; injected
  `sleep`.
- `parse-feed.ts`: `parseFeed(body: Uint8Array, baseUrl: string): { items, skipped } | 'invalid_feed'`;
  RSS 2.0 `rss.channel.item[]` (`guid`, `link`, `title`, `description` / `content:encoded`,
  `pubDate`) and Atom `feed.entry[]` (`id`, `link[@rel=alternate or none]@href`, `title`,
  `content` / `summary`, `published` / `updated`); relative links resolved against the feed URL;
  only `http(s)` links kept; D-12 title rule; D-13 text rules.
- `retry.ts`: `parseRetryAfter(value, now): number | null` (ms; delta-seconds or HTTP-date),
  `nextDelay(attempt, retryAfterMs)`.

### Error model
| Case | Run status | Source | HTTP |
|------|-----------|--------|------|
| network / timeout / guard / robots / too large | failed, reason | `last_error_*` set | 200 result |
| non-2xx other than 429/503 | failed, `http_status` + status | set | 200 |
| 429/503 after attempts | failed, `rate_limited` + status | set, `next_allowed_at` ≥ Retry-After | 200 |
| invalid XML / not RSS or Atom | failed, `invalid_feed` | set | 200 |
| some entries unmappable | partial, `failed` count | cleared | 200 |
| disabled / too soon | no run | unchanged | 409 |

Logs: source id, host, reason and counts only; never item text (FR-24 AC2).

### Source status for the empty state
`infrastructure/db/source-status-reader.ts` replaces `noSourcesYet`: `checked` = enabled sources
with `last_attempt_at` not null; `errors` = enabled sources whose last attempt failed, newest
first, as `{ sourceId, source: name, reason, httpStatus?, at }`.

## Phases

### Phase 1: Feed parser and retry rules
- Files:
  - `apps/api/package.json`, `pnpm-lock.yaml`: add `fast-xml-parser@5.11.2` (tech-stack choice).
  - `apps/api/src/infrastructure/sources/rss/parse-feed.ts` (new): D-12, D-13. Contract:
    `parseFeed(body: Uint8Array, feedUrl: string, maxTextChars: number): ParsedFeed | 'invalid_feed'`,
    `ParsedFeed = { items: FeedItem[]; skipped: number }`, at most 200 items.
  - `apps/api/src/infrastructure/sources/rss/retry.ts` (new): D-6. Contract:
    `parseRetryAfter(value: string | undefined, nowMs: number): number | null`,
    `retryDelay(attempt: number, retryAfterMs: number | null): number | 'stop'`.
  - `apps/api/src/modules/sources/ports.ts` (new): `FeedItem` and the port types of *Design*
    (types only; used from Phase 2).
  - `apps/api/test/fixtures/feeds/synthetic-*.xml` (new): D-14 (all marked `DEMO` in the text,
    fictional companies and handles).
  - `apps/api/src/infrastructure/sources/rss/parse-feed.test.ts`,
    `apps/api/src/infrastructure/sources/rss/retry.test.ts` (new): D-17.
- Proves: TR-17 (RSS 2.0, Atom, CDATA, escaped HTML, missing date → null, relative link, invalid
  XML → `invalid_feed`, a `FETCH_MAX_BYTES` feed parsed in < 2 s); AC4 delay and `Retry-After`
  table (unit).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm vitest run apps/api/src/infrastructure/sources/rss`, `pnpm test`.
- Human checks: none.

### Phase 2: Contracts, schema and shared ingest
- Files:
  - `packages/contracts/src/sources.ts` (new), `index.ts`: `SourceFailureReason`, `Source`,
    `SourcePreset`, `CreateSourceRequest`, `UpdateSourceRequest`, `SourceRunResult`,
    `SourceHealth`, `SourceList` (D-10).
  - `packages/contracts/src/opportunities.ts`: `SourceType` + `rss`; `SourceFacts.name`
    (D-19); `SourceError` → `{ sourceId, source, reason, httpStatus?, at }` (D-10).
  - `apps/api/src/infrastructure/db/schema.ts`, `apps/api/migrations/0007_*.sql` + snapshot
    (`pnpm --filter @lead-hunter/api db:generate`): `sources`, `job_runs`,
    `raw_signals.source_id`, `raw_signals.external_id` (D-1, D-2).
  - `apps/api/src/modules/signals/ingest.ts` (new), `service.ts`, `ports.ts`: move the transaction
    body of `importSignal` into `ingest(tx, candidate): ImportResult-like` with the `external_id`
    lookup between URL and hash (D-4); `NewSignal` gains `sourceId`, `externalId`;
    `IdentityKind` gains `external_id`. Manual import behaviour unchanged.
  - `apps/api/src/infrastructure/db/opportunity-repository.ts`, `modules/opportunities/{ports,service}.ts`:
    join `sources.name` into the row → `source.name` (D-19).
  - `apps/web/src/OpportunitiesPage.tsx`, `strings.pl.ts`: word `SourceError.reason`
    (reuse S-09 fetch wording; add `invalid_feed`, `rate_limited`); `sourceTypes.rss = 'Kanał
    RSS/Atom'`; show `source.name` on the list line when present.
  - `apps/web/src/OpportunityPage.tsx` / `opportunityCard.ts`: source name next to the source link.
- Proves: existing suites stay green (manual import identity unchanged, TR-06 for manual
  imports); migration applies on a DB with rows (existing `db.int.test.ts`).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 3: Sources service, RSS adapter, routes and CLI (checkpoint)
- Files:
  - `apps/api/src/modules/sources/presets.ts` (new): D-11.
  - `apps/api/src/modules/sources/service.ts` (new): list, create (validateConfig, preset or
    manual, `409 exists`), setEnabled, `runSource(id, 'run' | 'check')` per *Design* (D-3, D-5,
    D-6, D-9, D-15). Contract: `SourceService`.
  - `apps/api/src/modules/sources/routes.ts` (new): the five routes of D-10 with Zod schemas.
  - `apps/api/src/infrastructure/sources/rss/adapter.ts`, `fetch-feed.ts` (new): implements
    `SourceAdapter` with the shared client, robots check (D-8), injected `sleep`.
  - `apps/api/src/infrastructure/db/source-repository.ts` (new): `SourceRepository`, atomic
    `claim` (D-5), job runs (D-2).
  - `apps/api/src/infrastructure/db/source-status-reader.ts` (new) replaces
    `infrastructure/sources/source-status.ts` (deleted).
  - `packages/config/src/env.ts`, `env.test.ts`, `.env.example`: `SOURCE_MIN_INTERVAL_MINUTES`
    (60, 60–1440), `SOURCE_MAX_ATTEMPTS` (3, 1–5), each documented (lesson 1).
  - `apps/api/src/app.ts`, `server.ts`, `test/helpers/app.ts`: wire service, adapter, reader;
    `onSignalCreated` after a run with new signals.
  - `apps/api/src/cli/discover.ts`: D-16.
  - `apps/api/test/sources.int.test.ts` (new): with `MockAgent` and a fake clock:
    (a) add `wwr-programming` and `hn-freelance` presets in one call each, list shows access note
    (AC2, AC7); manual URL add; duplicate add → 409;
    (b) run WWR → signals with source, URL, title, snippet, `publishedAt`, `fetchedAt`, hash; list
    and `GET /api/opportunities/:id` show `source.name` "We Work Remotely — …" and the WWR URL
    (AC1, AC6);
    (c) second run before 1 h → 409 `too_soon`; after 1 h with the same feed → `new 0`, signal
    count unchanged (AC5, TR-06); same item in a second WWR category → duplicate;
    (d) HN feed answers 500 / invalid XML / `replyWithError` → run failed, `last_error_*` set,
    earlier signals still listed, WWR still runs, `sources.errors` in the list response (AC3);
    (e) 503 with `Retry-After: 5` twice then 200 → 3 requests counted, ok; 429 three times →
    `rate_limited`, exactly `SOURCE_MAX_ATTEMPTS` requests, next run refused until
    `max(Retry-After, 1 h)` (AC4);
    (f) check → health OK with time; failing check → error reason and unchanged
    `last_success_at` (FR-18 AC3); disabled source → 409 `disabled`.
- Proves: FR-04 AC1–AC7, FR-18 AC3, TR-06 (integration); OpenAPI/auth route-table tests cover
  the new routes.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm vitest run apps/api/test/sources.int.test.ts`, `pnpm test`.
- Human checks: from a machine with internet, `pnpm dev`, log in, then
  `curl -b <cookie> -X POST localhost:8080/api/sources -H 'content-type: application/json' -d '{"preset":"hn-freelance"}'`
  and the same for `wwr-programming`; `POST /api/sources/<id>/run` for both; record the counts and
  one sample signal (title, URL, date) in `evidence/real-run.md`; confirm the WWR category URLs
  answer 200 and the hnrss title pattern of D-12.
- Why a checkpoint: the item format and WWR URLs are `UNVERIFIED`; Phase 4's view and Phase 5's
  fixture recording build on the parser and presets being right for the real feeds.

### Phase 4: Sources view
- Files:
  - `apps/web/src/api/sources.ts` (new): client for the D-10 routes.
  - `apps/web/src/SourcesPage.tsx`, `SourcesPage.module.css` (new): list of sources (name, type,
    access note and terms link, enabled toggle, last attempt, health OK/błąd with text not only
    colour (NFR-07), last success, last error worded in Polish, next allowed time in
    Europe/Warsaw); **Uruchom teraz** and **Sprawdź** with pending state and the run result
    (nowe / duplikaty / pominięte or the error); **Dodaj z gotowych** (presets not yet added) and
    **Dodaj kanał** (name + URL, field errors from the 400 shape); 409 texts ("już dodane",
    "następna próba możliwa o HH:MM", "źródło wyłączone").
  - `apps/web/src/App.tsx`, `strings.pl.ts`: nav item and route `/zrodla`.
- Proves: no automated test (budget, D-17); behaviour is in the human check.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: at 360 px and on a laptop, add a preset, toggle it off and on, press **Uruchom
  teraz** (with network or with `pnpm dev` against an unreachable URL) and read the result and the
  error text; health status is readable without colour. Evidence: a Playwright screenshot of the
  view with one OK and one failing source (`E2E_EVIDENCE`-style, saved under `evidence/`, < 300 KB).

### Phase 5: Fixture recorder and documentation
- Files:
  - `scripts/fixtures-record.ts` (new), root `package.json` script `fixtures:record` (D-20).
  - `docs/source-policy.md` (new): per adapter (manual URL, RSS hnrss, RSS WWR, RSS manual):
    access method, terms link, limits (interval, attempts, timeout, size, robots), what is stored
    (FR-26 AC2).
  - `README.md`: *Co działa* (Sources view, presets, runs, `pnpm discover`), *Co wymaga ręcznej
    weryfikacji* (real feeds, fixture recording), configuration of the two new variables, link to
    `docs/source-policy.md`; `CLAUDE.md` Commands row for `pnpm discover` and `pnpm fixtures:record`.
  - `context/test-plan.md`: TR-06, TR-09, TR-10, TR-17 status → covered (S-10) with test names.
- Proves: FR-26 AC2 (document review).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: run `pnpm fixtures:record <id>` for the HN and one WWR source, check the files
  contain no real e-mail or handle, commit them; `pnpm vitest run
  apps/api/src/infrastructure/sources/rss` then also parses them (D-14). Read
  `docs/source-policy.md` against the hnrss and WWR terms pages.

## Risks and unknowns
- Real item formats and WWR category slugs are `UNVERIFIED` (Findings); mitigated by the Phase 3
  checkpoint and D-11/D-12 living in one file each.
- A WWR category feed may exceed `FETCH_MAX_BYTES` (1 MiB) → `too_large` error. The human check
  records the size; raising the limit is a `.env` change.
- WWR or hnrss robots.txt may disallow the feed path; then the source shows `robots_disallowed`
  (honest) and the preset is wrong for us — reported in the PR.
- hnrss is a third-party mirror of HN, not HN itself; its terms are documented in
  `docs/source-policy.md` as found by the person (terms link may be the GitHub project).
- A synchronous run holds the HTTP request up to ~70 s in the worst case (D-7).
- Feed text is untrusted: it reaches the LLM only through the existing delimited analysis path
  (TR-02 is covered by S-04/S-05 tests); this slice adds no new prompt path.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Feed parser and retry rules
- [ ] Phase 2: Contracts, schema and shared ingest
- [ ] Phase 3: Sources service, RSS adapter, routes and CLI (checkpoint)
- [ ] Phase 4: Sources view
- [ ] Phase 5: Fixture recorder and documentation

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] (Phase 1) Plan: `retry.test.ts` (D-17). Plan-review #5: TR-10 has budget `none`, so the file is dropped; `retryDelay`/`parseRetryAfter` are proved by integration case (e) in Phase 3 (add one HTTP-date `Retry-After` line there).
- [minor] (Phase 1) Plan: `ports.ts` holds the port types of *Design*. Plan-review #6: only `FeedItem` goes in now; `SourceAdapter`/`AdapterOutcome`/`RssConfig` arrive with Phase 2/3 (`RssConfig` in contracts `sources.ts`).
- [minor] (Phase 1) Plan-review #11 applied: `cdataPropName` keeps CDATA out of the XML-level decode (fixture `synthetic-edge.xml`); the parser decodes bytes as UTF-8 whatever the XML declaration says — to be noted in `docs/source-policy.md` (Phase 5).
- [minor] (Phase 1) Parser also drops `<script>`/`<style>` content (linear `indexOf` scan, no regex backtracking) and merges consecutive block tags into one line break; not named in D-13 but within its intent.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
