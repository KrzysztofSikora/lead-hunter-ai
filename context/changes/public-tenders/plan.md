# Plan: public-tenders (S-18)

## Goal and end state
Polish (e-Zamówienia BZP) and EU (TED) public tenders for software, IT services and R&D arrive
as signals through the existing source loop, and the card treats them as public tenders. When
done:

- The Sources view offers two more presets, "e-Zamówienia (BZP) — IT i oprogramowanie" and
  "TED — przetargi IT w Polsce". Each has CPV prefixes `72`, `48`, `73` and, for TED, country
  `PL`. The operator can change the prefixes (and the TED countries) per source.
- `pnpm discover` and the scheduler run both sources like any RSS source. Each new contract
  notice from the BZP notice API becomes a signal with buyer, submission deadline, notice URL
  and, only when the notice states it, the estimated value. The value becomes the analysis'
  `sourceBudget`. Requests to BZP stay at or below 30 per minute. (FR-32 AC1)
- The same holds for notices from the official TED search API, filtered by the same CPV
  prefixes and country, and limited to notices that open a procedure. (FR-32 AC2)
- An analysed tender signal has evidence level `PUBLIC_TENDER`, never `DIRECT_REQUEST`,
  whatever the model answers. The card shows "Przetarg publiczny", the buyer, the submission
  deadline (Europe/Warsaw) and the estimated value or "nie podano", all tagged "ze źródła".
  (FR-32 AC3)
- A failing tender API is an explicit source error with reason and HTTP status, never "no
  results" (FR-04 AC3 applies unchanged).
- `docs/source-policy.md` has an entry for each API (access, terms, limits, what is stored,
  `DO WERYFIKACJI` items). It also records that Baza Konkurencyjności stays manual.

## Scope
- In: a second and third source type (`bzp`, `ted`) behind the existing `SourceAdapter`
  contract; a per-source tender config (CPV prefixes, countries); structured tender facts on
  the raw signal; a `post` method on the guarded HTTP client (TED search is a POST); the
  `PUBLIC_TENDER` evidence level with its scoring row; the card's tender block; the Sources view
  editor for the tender config; synthetic or trimmed fixtures; `docs/source-policy.md` and
  `docs/scoring.md`.
- Out: Baza Konkurencyjności (manual import only, *Decided up front*). The same goes for other
  procurement portals (platformazakupowa.pl, own buyer platforms) and for downloading tender
  documents (SWZ) or attachments. A notice is not marked expired once its deadline passes
  ([FOLLOW-UP] candidate). Tender notifications are out, and so is an
  `fixtures:record` variant for API sources (D-14). Code bounties are S-19.

## Findings

### Repository
- **The adapter contract is RSS-only.** `SourceAdapter.type: 'rss'` and `discover(config:
  RssConfig)` (`apps/api/src/modules/sources/ports.ts:24-35`). `SourceRecord.type: 'rss'`
  (`ports.ts:37-39`). The repository hardcodes `type: 'rss'` on read and insert
  (`apps/api/src/infrastructure/db/source-repository.ts:12,57`). The contract has
  `Source.type: z.literal('rss')` and a required `url` (`packages/contracts/src/sources.ts:64-68`).
  `sources.type` is already free `text` (`apps/api/src/infrastructure/db/schema.ts:42`), so a
  new type needs no migration.
- **The service is generic except for one literal.** `service.run` validates the config, calls
  `adapter.discover`, dedupes by cursor keys (`seen`, at most 500), ingests each item in one
  transaction, and applies the S-17 source filter. Its only RSS-specific bit is
  `sourceType: 'rss'` (`apps/api/src/modules/sources/service.ts:166-290`, literal at `:230`).
  `create` reads `{ url }` for presets and manual feeds (`:330-356`). The composition root
  builds exactly one adapter (`apps/api/src/infrastructure/sources/compose.ts:46-63`).
- **The RSS adapter** owns the 429/503 backoff (`rss/adapter.ts:38-80`, `rss/retry.ts`:
  `max(2 s · 2^(n-1), Retry-After)`, stop above 30 s). It checks robots.txt on every hop
  (`:44-48`). The backoff helpers are reusable as they are.
- **The HTTP client only does GET** (`apps/api/src/infrastructure/sources/http/client.ts:31-41`).
  It applies the SSRF check per hop, a 2-request semaphore, a client-wide `maxBytes`
  (`FETCH_MAX_BYTES`, default 1 MiB, max 5 MiB, `packages/config/src/env.ts:100,265`) and at
  most 5 redirects.
- **The raw signal has no metadata column** (`schema.ts:110-137`). The PRD data model lists
  "metadata" on the raw signal (`context/prd.md:274-276`). The last migration is `0011`.
- **`SourceType`** = `manual_text | manual_url | manual_fetch | rss`
  (`packages/contracts/src/opportunities.ts:13`). The opportunity list filter offers every
  option (`apps/web/src/OpportunitiesPage.tsx:188`). The pre-filter drops `no_profile_match`
  for every non-manual type (`apps/api/src/modules/analysis/prefilter.ts:117-119`).
- **Classification.** `EvidenceLevel` = `DIRECT_REQUEST | EXPLICIT_PROBLEM | INDIRECT_SIGNAL |
  SPECULATIVE` (`packages/contracts/src/classification.ts:14-20`). The model schema is generated
  from the contract (`apps/api/src/infrastructure/llm/prompt.ts:66-75`), so a new enum value
  reaches the model. The guard downgrades `DIRECT_REQUEST`, and moves the paid categories to
  `UNMET_NEED`, when `hasHiringCue(text)` is false (`output-guard.ts:100-113`). The hiring cues
  (`cues.ts:12-31`) do not include tender words ("zamówienie", "zamawiający", "przetarg"), so
  without a change a BZP notice would be downgraded.
- **Scoring tables are exhaustive records** over `EvidenceLevel`
  (`apps/api/src/modules/scoring/rubric.ts:18-25`), so a new level fails `pnpm typecheck` until
  it has a row. `confidenceFor` treats `DIRECT_REQUEST | EXPLICIT_PROBLEM` as direct
  (`score.ts:18-23`). The digest puts `DIRECT_REQUEST` first (`digest/select.ts:39-44`). The web
  app has a label per level (`apps/web/src/strings.pl.ts:551`).
- **`sourceBudget`** flows into `opportunities.amount_max_minor/amount_currency`
  (`analysis/service.ts:120-131`). The guard keeps it only if its quote occurs in the source text,
  states both amounts, uses only the budget's currency and does not start or end mid-number
  (`output-guard.ts:85-98`). `Currency` comes from `packages/contracts/src/profile.ts`.
- **The card's origin section** shows source name, link, publication and detection date, each
  tagged `source` or `null` (`apps/web/src/opportunityCard.ts:146-158`). `SourceFacts` is built
  from the row in `apps/api/src/modules/opportunities/service.ts:61-73`.
- **Fixtures** are synthetic feeds (`apps/api/test/fixtures/feeds/synthetic-*.xml`).
  `fixtures:record` handles RSS only (`apps/api/src/cli/fixtures-record.ts`). Tests never reach
  the network (global `MockAgent`, `disableNetConnect()`, `context/test-plan.md:120`).
- **Lessons that bind this plan:** validate before storing (tender facts, config); bound every
  source-supplied date before storing (deadline, publication date); bound CPU-bound steps on
  untrusted input (notice HTML or long JSON fields); decide what a second source that disagrees
  does with a shared record (the same tender in BZP and TED); test the off state of every switch
  with input the on state would reject (the source filter on tender sources).

### Third-party APIs
No live request reached either API from this session. The egress proxy refused
`ezamowienia.gov.pl`, `media.ezamowienia.gov.pl`, `api.ted.europa.eu` and `docs.ted.europa.eu`
(CONNECT 403). The facts below therefore come from search excerpts of the official pages named,
not from pages read in full, and no response shape is confirmed against real output. That is
why every field read sits in one `map-notice.ts` per adapter, and why Phase 2 is a checkpoint.

**e-Zamówienia BZP** (`GET https://ezamowienia.gov.pl/mo-board/api/v1/notice`):
- Reading national BZP notices is public and free and needs no integration request
  (<https://ezamowienia.gov.pl/pl/integracja/>). The API terms are Zarządzenie 1/2023 with its
  annexes (<https://media.ezamowienia.gov.pl/pod/2023/02/Regulamin-korzystania-z-API-1.pdf>).
- **Rate limit:** in force since 2026-10-06. The guaranteed limit is 30 requests per minute per
  IP, and **going over it returns HTTP 403, not 429** (same page). See D-18.
- **Page size:** the maximum `PageSize` drops from 500 to 100 on production from 2027-01-11 (edu
  environment from 2026-10-15). Invalid parameters will return 404 with a message. The data
  scope does not shrink
  (<https://www.gov.pl/web/uzp/planowane-zmiany-w-api-bzp>).
- Notice number format: `YYYY/BZP NNNNNNNN`. A notice PDF is at
  `/mo-board/api/v1/Board/GetNoticePdfById?noticeId=<guid>`.
- `UNVERIFIED` (third-party descriptions only):
  - parameter names: `NoticeType=ContractNotice`, `PublicationDateFrom`/`PublicationDateTo`,
    `CpvCode`, `PageSize`, `PageNumber` or `SearchAfter`;
  - the response, said to be a JSON array of `{ objectId, bzpNumber, noticeType, orderObject,
    organizationName, organizationCity, cpvCode: "72000000-5 (…)", publicationDate,
    submittingOffersDate, htmlBody }`;
  - whether `htmlBody` is filled in on this endpoint;
  - whether the estimated value exists outside the HTML body (a third party says it is only in
    the HTML);
  - the human notice URL.
  - The text licence is `UNVERIFIED`: no explicit licence was found. The basis is the 2021
    open-data and PSI re-use act, and the platform terms are at
    <https://ezamowienia.gov.pl/pl/regulamin/>.

**TED Search API v3** (`POST https://api.ted.europa.eu/v3/notices/search`):
- Anonymous; no API key for search (<https://docs.ted.europa.eu/api/latest/search.html>).
- **Body:** `query` (expert syntax), `fields`, `page`, `limit`, `scope` (`LATEST`, `ACTIVE`,
  `ALL`), `paginationMode` (`PAGE_NUMBER`, `ITERATION`), `iterationNextToken`. At most 250 notices
  per page. `PAGE_NUMBER` mode is capped at 15 000 results
  (<https://docs.ted.europa.eu/ODS/latest/reuse/search-api.html>).
- **Query syntax:** `=`, `~`, `IN (a b)`, `NOT IN`, and comparisons on dates and numbers, with
  AND/OR/NOT. Wildcards are allowed (`classification-cpv=72*`), and dates are written
  `publication-date>=20261020`. `buyer-country` takes **alpha-3** codes (`POL`) and is separate
  from `place-of-performance` (<https://ted.europa.eu/en/help/search-browse>).
- **Notice types that open a procedure** (eForms "competition"): `cn-standard`, `cn-social`,
  `cn-desg`, `subco`, `pin-cfc-standard`, `pin-cfc-social`, `qu-sy`
  (<https://docs.ted.europa.eu/eforms/latest/schema/documents-forms-and-notices.html>).
- **Fair use:** 700 requests per minute per IP, possibly for the website only
  (<https://ted.europa.eu/en/news/fair-usage-policy-on-ted>).
- **Licence:** Commission Decision 2011/833/EU; notices "can be freely reused, for commercial or
  non-commercial purposes" (<https://ted.europa.eu/en/legal-notice>).
- `UNVERIFIED`:
  - the response field names (`notices`, `totalNoticeCount`, `iterationNextToken`, `links.html.<LANG>`);
  - the multilingual objects of `notice-title` and `buyer-name`;
  - `deadline-receipt-tender-date-lot`;
  - the estimated-value fields (`estimated-value-lot`, or `estimated-value-proc` with
    `estimated-value-cur-proc`).
  - Third-party advice for `ITERATION` mode: stop on an empty `notices` page, not on a missing
    token.

**Baza Konkurencyjności:** no documented public API on the official site or in its terms
(<https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/>). It stays a manual import, as
decided up front.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | How do the tender APIs fit the source loop? | Two new source types `bzp` and `ted` behind the existing `SourceAdapter` contract. The contract becomes generic over its config; the service picks the adapter by `record.type` from a registry built in `compose.ts`, and `sourceType` of the ingested signal is the source's type. `Source.type` becomes `z.enum(['rss','bzp','ted'])` and `SourceType` gains `bzp`, `ted` (additive). | B: one generic "json-api" adapter configured by mapping rules (one adapter for every API, but a mini-language to test and document). C: a separate tender job outside the source loop (no contract change, but a second lock, run history and error model). | Reuses lock, interval, cursor, run history, source filter and explicit errors as they are (FR-04 AC3). The strongest argument against: `Source` and `SourceType` are API contracts and the web app switches on them. The change is additive. | costly | agent |
| D-2 | Where do buyer, deadline and estimated value live? | A nullable `raw_signals.tender_json` column (migration `0012`) holding `TenderFacts` (`noticeId`, `buyer`, `deadlineAt`, `estimatedValue {amountMinor, currency, quote} \| null`, `cpvCodes`, `procedure` label, `country`), parsed with Zod before it is stored and on read. The same facts are also written as labelled lines into the signal text (D-5). | B: a generic `metadata_json` (the PRD's "metadata"; open to anything, so nothing validates it). C: a `tender_notices` table (normalised, but a join on every card read for two sources). D: text only (no migration, but the card would have to parse its own text). | One additive, nullable column, read only by the card and the analysis guard. A reviewer can rename it to `metadata_json` in one migration before it holds data. | costly | agent |
| D-3 | How is a tender "classified as a public tender, not `DIRECT_REQUEST`" (AC3)? | A new evidence level `PUBLIC_TENDER`. The output guard sets it for every `bzp`/`ted` signal whatever the model says, and turns a model's `PUBLIC_TENDER` on any other source into `DIRECT_REQUEST`, which the hiring-cue rule then checks as before. For tender sources the hiring-cue downgrade of the evidence level and of the paid categories is skipped, because the source type itself proves a buyer procuring. Each change is a guard note. | B: a new category `PUBLIC_TENDER` (fits "channel" better, but the evidence level would still be `DIRECT_REQUEST`, which the AC rules out). C: a separate `procurement` flag column next to an untouched evidence level (no enum change, but AC3 reads the evidence level). | The AC names the evidence level. A deterministic source-type rule beats trusting the model (PRD §7). The strongest argument against: evidence level was a strength-of-demand axis and now also encodes a channel. | costly | agent |
| D-4 | What does `PUBLIC_TENDER` score? | Demand 30 / 22 (the same row as `DIRECT_REQUEST`). It also counts as "direct" in `confidenceFor`. The digest keeps putting only `DIRECT_REQUEST` first. `SCORING_VERSION` stays 1, because no existing score changes; `docs/scoring.md` gets the row. | B: a lower row (e.g. 24 / 18) for the formal effort of a tender (a new weight with no rule behind it in the PRD). C: bump `SCORING_VERSION` (marks every stored breakdown old, although none of them changes). | A notice is as explicit a demand as a direct request. How hard a tender is to win is not what the demand component measures. One table cell to change. | cheap | agent |
| D-5 | What text does a tender signal carry? | The adapter builds the snippet as labelled Polish lines: title, `Zamawiający: …`, `Termin składania ofert: … (czas warszawski)`, `Wartość szacunkowa: … PLN` (only when stated), `Kody CPV: …`, `Numer ogłoszenia: …`, then the notice's own description when the API returns one, cut to `IMPORT_MAX_TEXT_CHARS`. | B: only the API's description text (the guard could not verify the buyer or value quote against it). C: JSON of the fields (machine-readable, but poor for the operator and the LLM). | The guard's existing checks (buyer in text, budget quote in text) then work unchanged, and the LLM sees the facts as data. | cheap | agent |
| D-6 | Who sets `sourceBudget` for a tender? | The guard, from `TenderFacts.estimatedValue`. A stated value becomes `{min = max = amount, currency, quote}`, with the quote taken verbatim from the `Wartość szacunkowa` line. No stated value, or a currency outside `Currency`, gives `null` plus a note. Either way the model's own `sourceBudget` is replaced. | B: leave it to the model and the existing guard (non-deterministic; a model may skip or misread a net amount). | AC1: "only when the notice states it" holds by construction, whatever the provider (also the mock). | cheap | agent |
| D-7 | How are CPV prefixes and countries configured? | Per source, in `config_json`: BZP `{ cpvPrefixes }`, TED `{ cpvPrefixes, countries }`. Prefixes are 2–8 digits, 1–20 of them, no duplicates; countries are ISO-3166 alpha-2, 1–10 of them. Presets set the defaults (72, 48, 73; PL). `PATCH /api/sources/:id` accepts `tender: { cpvPrefixes, countries? }` for tender sources only (400 otherwise); the Sources view edits it. | B: env variables (`TENDER_CPV_PREFIXES`; one restart per change, not per source). C: fixed defaults (AC1 says "configured"). | Follows the S-17 filter pattern (per-source, edited in the view, validated before storing). | costly | agent |
| D-8 | How many tender sources of each type? | One per type: `config_key` = `bzp` / `ted`, created only from its preset (`exists` on a second add). | B: several per type with different CPV sets (needs a key over the config, and overlapping sets duplicate requests). | Enough for the AC, and the config can be edited. Lifting the limit later only changes the key. | cheap | agent |
| D-9 | Which time window does a run ask for? | The service passes `since` to `discover`: `lastSuccessAt − 24 h`, or `now − 3 days` on the first run. The cursor's `seen` keys and the identity table drop the overlap. Each adapter stops at a page cap (BZP 10 × 100, TED 5 × 100 in `ITERATION` mode, stopping on an empty page). When the cap is hit, the run is `partial` with a `page_cap` log line, never silently complete. | B: an adapter-owned "last publication date" cursor (exact, but the service owns the cursor today, S-10 D-3). C: always the last N days (simple, but more requests). | Small windows (runs are ≥ 60 min apart) and no new cursor format. | cheap | agent |
| D-10 | How are 30 requests per minute to BZP guaranteed? | Inside a run, the BZP adapter waits at least 2 000 ms between two requests (injected `sleep` and clock, so tests count requests without waiting). Between runs the existing `SOURCE_MIN_INTERVAL_MINUTES` (≥ 60) applies. 429/503 use the shared `retryDelay`. TED uses the same 2 s spacing. | B: a token bucket in the HTTP client (shared by all sources, but more code for one limit). | One constant per adapter. With the page cap, a run stays far below the limit. | cheap | agent |
| D-11 | How does TED's POST fit the guarded client? | `HttpClient.post(url, { signal, accept, contentType, body })`: the same SSRF check, semaphore and size cap. It follows no redirects; a 3xx comes back as a status and becomes `http_status`. | B: undici `request` directly in the adapter (skips the SSRF guard and the semaphore). | Every outbound source request keeps one guarded path. | cheap | agent |
| D-12 | robots.txt for the two APIs? | Not consulted. Access is through a documented public API whose terms govern it, and the policy says so per source. The RSS rule is unchanged. | B: check robots.txt as for feeds (a site-wide `Disallow` written for crawlers would block an API the operator publishes for machine use). | PRD §5 asks for official or permitted access; the official API is that access. One line per adapter to add the check back. | cheap | agent |
| D-13 | Does the pre-filter's `no_profile_match` drop tenders? | No. `bzp` and `ted` are exempt, like manual imports, because the CPV prefixes already select the domain and Polish notice titles rarely name the profile's technologies. Every other pre-filter rule applies. | B: keep the rule (most notices would be rejected before analysis). | The CPV selection is the relevance filter the PRD names for tenders. | cheap | agent |
| D-14 | Which fixtures do the adapter tests use? | Trimmed real responses when the implementing session can fetch one sample page of each API (the planning session could not, see *Third-party APIs*). Only the mapped fields are kept, buyer names are replaced with `DEMO` names, contact people and e-mails are removed, and the file is marked `DEMO`. Otherwise synthetic responses in the documented shape, marked `UNVERIFIED` until the human check. No `fixtures:record` support for API sources. | B: extend `fixtures:record` with an anonymiser per API (a person can re-record, but more code than the adapters need now). | The roadmap asks for recorded responses. Public-body notices can still name contact people (PRD §16.1). [FOLLOW-UP] for the recorder. | cheap | agent |
| D-15 | How does the card show a tender? | `SourceFacts` gains `tender: TenderFacts \| null` (additive). The card's origin section adds "Przetarg publiczny" items: buyer, submission deadline (Europe/Warsaw, or "nieznany"), estimated value (or "nie podano") and notice number, all tagged "ze źródła". The evidence-level label for `PUBLIC_TENDER` is "przetarg publiczny". | B: show only the snippet lines (no structured deadline, so AC3 would hang on text). | AC3 and FR-11 AC3 (source facts tagged as such). | cheap | agent |
| D-16 | The same tender in BZP and TED (lesson: shared, deduplicated records)? | The first source to store it owns the opportunity. The other source's notice is added as `REPEAT_IMPORT` evidence when its URL or content hash matches, or stays a separate opportunity when neither matches (BZP and TED notices have different URLs and texts). Tested both ways and documented in the policy. | B: cross-source matching by notice number or buyer and title (BZP and TED numbers differ; fuzzy matching risks merging different lots). | Matches the existing identity rules (FR-06). Below-threshold notices appear only in BZP and above-threshold ones only in TED, so a real overlap is rare. | cheap | agent |
| D-17 | Does the analysis prompt change? | Yes. One rule ("a notice from `bzp` or `ted` is a public tender: evidenceLevel `PUBLIC_TENDER`") and the enum value in the schema. `PROMPT_VERSION` becomes `analysis-2`; `ANALYSIS_SCHEMA_VERSION` stays 2 (additive enum, every stored result stays valid). | B: no prompt change (the guard fixes the level anyway, but the model would see an enum value it was never told about). | A changed prompt must carry a new version (S-05 reuse key). Reuse only skips a call, so the bump costs at most one re-analysis per requeued item. | cheap | agent |
| D-18 | What does a BZP 403 mean? | `rate_limited` (the documented over-limit answer): no retry inside the run. The next attempt waits at least the source interval (`SOURCE_MIN_INTERVAL_MINUTES`, ≥ 60 min), via `retryAfterMs` = 60 s so the existing `max(Retry-After, interval)` rule applies. 429/503 keep the shared backoff. TED 403 stays `http_status`. | B: `http_status 403` (honest about the code, but reads as "access forbidden" and invites a manual re-run that makes it worse). C: retry after 60 s inside the run (holds the job lock for a minute). | The UZP page says 403 is the over-limit answer. The reason shown still carries `httpStatus: 403`, so nothing is hidden. | cheap | research |
| D-19 | TED country filter: which field and which codes? | `buyer-country` (where the buyer is based). Config keeps alpha-2 codes (default `PL`, like the roadmap), and `query.ts` maps them to alpha-3 through a fixed EU/EEA table. A code outside the table fails config validation. | B: `place-of-performance` (finds a foreign buyer's work in Poland, but misses remote services, which often have no place). C: alpha-3 in the config (no table, but unlike every other country field in the app, which uses alpha-2). | "TED country PL" reads as Polish buyers. Switching the field is one line in `query.ts`. | cheap | research |
| D-20 | How big may an API page be, and how is notice HTML read? | Tender adapters pass a per-request `maxBytes` of 8 MiB (constant in each adapter; `FETCH_MAX_BYTES` stays the feed limit). Notice HTML (BZP `htmlBody`) is cut to 200 000 characters, then stripped by a linear tag and entity pass, never a DOM parser. The estimated value is read only by a narrow labelled pattern ("Wartość zamówienia" / "Szacunkowa wartość" followed by an amount and currency); no match gives `null`. | B: page size 25 under the 1 MiB cap (4× the requests against a 30/min limit). C: linkedom on the HTML (structured, but superlinear on untrusted input, see lessons). | 100 notices with HTML bodies can exceed 1 MiB. A linear pass stays bounded (lesson), and a missed value stays unknown rather than guessed (PRD §0). | cheap | agent |

## Design

### Contracts (`packages/contracts`)
- `SourceType` += `bzp`, `ted`. `SourceKind = z.enum(['rss','bzp','ted'])` for `Source.type`.
- `TenderSourceConfig`: BZP `{ cpvPrefixes: string[] }`, TED `{ cpvPrefixes: string[],
  countries: string[] }`, strict, rules as in D-7. `Source` gains `tender:
  { cpvPrefixes, countries: string[] | null } | null`; `url` stays (the API endpoint, display
  only). `UpdateSourceRequest` gains `tender` (optional, same rules); the refine "enabled or
  filter" becomes "enabled, filter or tender".
- `TenderFacts` (strict): `noticeId` (≤ 100), `buyer` (≤ 300, nullable), `deadlineAt` (ISO
  instant, nullable), `estimatedValue` (`{ amountMinor: 0…MINOR_MAX, currency: Currency,
  quote: 1…500 }`, nullable), `cpvCodes` (≤ 20 × `^\d{8}(-\d)?$`), `procedure` (≤ 120,
  nullable), `country` (alpha-2, nullable). `SourceFacts.tender: TenderFacts.nullable()`.
- `EvidenceLevel` += `PUBLIC_TENDER`.

### Adapter port (`apps/api/src/modules/sources/ports.ts`)
```ts
interface DiscoverContext { since: number }            // UTC epoch ms (D-9)
interface FeedItem { …existing; tender?: TenderFacts } // tender sources only
interface SourceAdapter<C = unknown> {
  type: SourceKind;
  validateConfig(config: unknown): { ok: true; config: C; key: string } | { ok: false; issues: string[] };
  discover(config: C, context: DiscoverContext): Promise<AdapterOutcome>;
  healthCheck(config: C): Promise<AdapterOutcome>;     // one page, nothing stored
}
type AdapterOutcome = …existing ok | { ok: true; items; skipped; truncated?: true } | …failure;
```
The service takes `adapters: Record<SourceKind, SourceAdapter>` and dispatches by
`record.type`. An unknown stored type is a run failure `internal`.

### Data
- Migration `0012`: `ALTER TABLE raw_signals ADD tender_json text;`. The tender facts are
  validated with `TenderFacts` before the insert. An invalid one is dropped (`null`) and the item
  still stored, with a warn log of the source id and field name. Read: parsed with `safeParse`;
  invalid reads as `null`.
- Dates: `deadlineAt` and `publishedAt` are bounded to 2000-01-01…2100-01-01 before storing,
  else `null` (lesson).

### Adapters (`apps/api/src/infrastructure/sources/{bzp,ted}/`)
Each folder holds `adapter.ts` (fetch loop: pagination, spacing, backoff, page cap, failure
mapping) and `map-notice.ts`, a pure function from one raw notice (untrusted JSON) to `FeedItem
| 'skip'` that builds the D-5 text and the `TenderFacts`. Every field the API exposes is read
in `map-notice.ts` only, so a different real shape is a one-file fix. Failures map like RSS:
transport → its `FetchFailureReason`, non-2xx → `http_status`, 429/503 → backoff then
`rate_limited`. A body that is not JSON, or not the expected envelope, → `invalid_feed`. A single
notice that cannot be mapped is `skipped` (the run is `partial`), never silently dropped.

### Analysis
`guardAnalysis(result, sourceText, { sourceType, tender })`: after the existing checks, tender
sources get `evidenceLevel = PUBLIC_TENDER` and `sourceBudget` from `tender.estimatedValue`, with
no hiring-cue downgrade (D-3, D-6). The runner passes the row's `sourceType` and parsed
`tender_json` (the waiting-row query gains `tender_json`).

### Web
- `strings.pl.ts`: labels for `bzp`, `ted`, `PUBLIC_TENDER` and the tender items, plus the
  config editor texts.
- `opportunityCard.ts`: tender items in `origin` when `source.tender` is set.
- `SourcesPage.tsx`: for `bzp`/`ted` sources, a "Kody CPV" field (comma- or line-separated)
  and, for TED, a "Kraje" field, saved through `PATCH { tender }`. Server issues are shown
  like the filter's.

## Phases

### Phase 1: Source types, tender facts storage and the POST client
- Files:
  - `packages/contracts/src/opportunities.ts`: `SourceType` += `bzp`, `ted`; `TenderFacts`;
    `SourceFacts.tender`. Contract: response field `source.tender` (nullable).
  - `packages/contracts/src/sources.ts`: `SourceKind`, `BzpConfig`, `TedConfig`,
    `Source.type` enum, `Source.tender`, `UpdateSourceRequest.tender`. Contract: PATCH body and
    `Source` shape (additive).
  - `packages/contracts/src/sources.test.ts`: schema rules for the tender config (2–8 digits,
    duplicates, limits) and `TenderFacts` bounds.
  - `apps/api/src/infrastructure/db/schema.ts`, `apps/api/migrations/0012_*.sql` (+ meta):
    `raw_signals.tender_json`. Invariant: nullable, NULL for every existing row.
  - `apps/api/src/modules/sources/ports.ts`: generic `SourceAdapter<C>`, `DiscoverContext`,
    `FeedItem.tender`, `truncated`; `SourceRecord.type: SourceKind`.
  - `apps/api/src/modules/sources/service.ts`: adapter registry, `since` (D-9), `sourceType =
    record.type`, tender facts validated and bounded before ingest, `truncated` → `partial`,
    `update` with `tender` (400 for RSS sources), `toSource` with `tender`.
  - `apps/api/src/modules/sources/routes.ts`: maps the new refusal (`not_tender_source` →
    400).
  - `apps/api/src/modules/signals/ingest.ts`, `ports.ts`,
    `apps/api/src/infrastructure/db/signal-repository.ts`: `tenderJson` on insert.
  - `apps/api/src/infrastructure/db/source-repository.ts`: `type` read from the row, `insert`
    takes `type`; `update` takes `configJson`.
  - `apps/api/src/infrastructure/db/opportunity-repository.ts`,
    `apps/api/src/modules/opportunities/service.ts`: `source.tender` parsed with `safeParse`.
  - `apps/api/src/infrastructure/sources/rss/adapter.ts`: implements the generic port (ignores
    `since`).
  - `apps/api/src/infrastructure/sources/compose.ts`: builds the registry (RSS only in this
    phase; `bzp`/`ted` entries come in Phases 2–3; until then a stored tender type fails with
    `internal`).
  - `apps/api/src/infrastructure/sources/http/client.ts` (+ test): `post`, and an optional
    per-request `maxBytes` on both methods (D-20). Contract: `post` follows no redirects; same
    SSRF check, semaphore and size cap.
  - `apps/api/src/modules/analysis/prefilter.ts` (+ test): `bzp`/`ted` exempt from
    `no_profile_match` (D-13).
  - `apps/web/src/strings.pl.ts`: source-type labels for `bzp`, `ted` (keeps the list filter
    typed).
- Proves: the groundwork for FR-32 AC1–AC2. Unit tests: contract rules; POST through `MockAgent`
  (sent body, no redirect follow, blocked address refused); pre-filter exemption with a tender
  text and no profile term, next to an RSS text that is still rejected. Integration (fake tender
  adapter registered in the test runtime): `tender` facts stored and returned on the card
  detail; invalid facts → stored item with `tender: null`; `since` = `lastSuccessAt − 24 h` and
  `now − 3 days` on first run; `truncated` → `partial`; PATCH `tender` on an RSS source → 400.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: e-Zamówienia BZP adapter (checkpoint)
- Files:
  - `apps/api/src/infrastructure/sources/bzp/map-notice.ts` (+ test): one BZP notice →
    `FeedItem` (key = notice number, URL = public notice page, D-5 text, `TenderFacts`), or
    `'skip'` for a notice type that does not open a procedure.
  - `apps/api/src/infrastructure/sources/bzp/adapter.ts` (+ test): query by publication
    window, notice type and CPV prefixes as the API allows (client-side prefix match where the
    API only matches whole codes), page size 100, ≥ 2 000 ms between requests, 429/503 backoff,
    page cap 10, 403 → `rate_limited` (D-18), 404 → `http_status`, failure mapping,
    `healthCheck` = first page only. Contract: at most 30 requests in any 60 s window.
  - `apps/api/src/infrastructure/sources/tender-text.ts` (+ test): the D-20 linear HTML-to-text
    pass and the D-5 text builder shared by both adapters. Test: a body of the maximum size
    finishes within a fixed time budget (lesson).
  - `apps/api/src/modules/sources/presets.ts`: preset `bzp-it` (type `bzp`, defaults, access
    note, terms link). `SourcePreset` gains `type` and `tender` defaults
    (`packages/contracts/src/sources.ts`).
  - `apps/api/src/modules/sources/service.ts`: `create` from a tender preset; key `bzp` (D-8).
  - `apps/api/src/infrastructure/sources/compose.ts`: registers `bzp`.
  - `apps/api/test/fixtures/tenders/bzp-*.json`: fixtures per D-14 (a contract notice with a
    value, one without a value, one non-opening notice type, one malformed notice).
  - `apps/api/test/tenders.int.test.ts`: discovery through `MockAgent`.
- Proves: FR-32 AC1. Integration: run → signals with buyer, deadline, URL, and
  `tender.estimatedValue` only for the notice that states a value; requests
  counted on `MockAgent` with the injected clock: ≤ 30 within 60 s over a 10-page window; 500 →
  explicit `http_status`, earlier signals kept; 403 → `rate_limited` and `nextAllowedAt` ≥ the
  interval, with no second request; 429 with `Retry-After` → backoff; malformed
  notice → `partial`; a second run → duplicates only; the source filter switched off lets
  through a notice that the filter switched on rejects (lesson). Unit: the mapper on each
  fixture, deadline and value bounds, the description cut to the maximum length.
  Note: the `sourceBudget` half of AC1 is asserted at the analysis level in Phase 4. This
  phase asserts that `TenderFacts.estimatedValue` is set only for the notice that states it.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: one real run of the BZP preset (`pnpm discover` with only it enabled): run
  result, one sample signal compared with its notice page, no 429.
- Why a checkpoint: the BZP response shape is `UNVERIFIED` (roadmap unknown). `TenderFacts`,
  the card (Phase 4) and the TED mapping follow the same field choices. A real run is the only
  way to confirm them before they are built on.

### Phase 3: TED search adapter
- Files:
  - `apps/api/src/infrastructure/sources/ted/query.ts` (+ test): builds the expert query from
    `cpvPrefixes` (`classification-cpv IN (72* 48* 73*)`), `countries` (alpha-2 → alpha-3,
    D-19), `publication-date>=` the window, and `notice-type IN (cn-standard cn-social cn-desg
    subco pin-cfc-standard pin-cfc-social)`. `qu-sy` (utilities qualification systems) is left
    out. Inputs are already validated digits and alpha-2 codes, so nothing from a source
    reaches the query.
  - `apps/api/src/infrastructure/sources/ted/map-notice.ts` (+ test): one TED notice →
    `FeedItem`: the Polish title if present, else English, else the first one; the HTML link in
    the same language; buyer, deadline, estimated value.
  - `apps/api/src/infrastructure/sources/ted/adapter.ts` (+ test): `POST` search, pagination
    (`limit` 100, `paginationMode: ITERATION`, `scope: ACTIVE`, page cap 5, stop on an empty
    page), 2 s spacing, backoff, failure mapping.
  - `apps/api/src/modules/sources/presets.ts`: preset `ted-pl-it`.
  - `apps/api/src/infrastructure/sources/compose.ts`: registers `ted`.
  - `apps/api/test/fixtures/tenders/ted-*.json`, `apps/api/test/tenders.int.test.ts`.
- Proves: FR-32 AC2. Integration: the request body carries the configured CPV prefixes and
  country (asserted on `MockAgent`), mapping as in AC1, explicit errors, pagination stop. The
  D-16 cross-source case: a TED notice with the same URL as a stored BZP signal → one
  opportunity plus `REPEAT_IMPORT` evidence; different URL and text → two opportunities.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: one real run of the TED preset, as in Phase 2.

### Phase 4: Public-tender classification and the card
- Files:
  - `packages/contracts/src/classification.ts`: `EvidenceLevel` += `PUBLIC_TENDER`.
  - `apps/api/src/modules/analysis/output-guard.ts` (+ test): the D-3 and D-6 rules. Contract:
    `guardAnalysis(result, sourceText, origin?: { sourceType, tender })`.
  - `apps/api/src/modules/analysis/service.ts`, `ports.ts`,
    `apps/api/src/infrastructure/db/analysis-repository.ts`: pass `sourceType` and `tender` to
    the guard.
  - `apps/api/src/modules/scoring/rubric.ts`, `score.ts` (+ tests), `docs/scoring.md`: the
    D-4 row and confidence rule.
  - `apps/api/src/infrastructure/llm/prompt.ts` (+ test): the D-17 rule, `PROMPT_VERSION =
    'analysis-2'`.
  - `apps/web/src/strings.pl.ts`, `apps/web/src/opportunityCard.ts` (+ test): the tender items
    (D-15) and the `PUBLIC_TENDER` label.
- Proves: FR-32 AC3 and the `sourceBudget` half of AC1. Unit: a guard table (tender + model says
  `DIRECT_REQUEST` → `PUBLIC_TENDER`; RSS + model says `PUBLIC_TENDER` → `DIRECT_REQUEST` and
  then the hiring rule; a tender without hiring cues keeps `DIRECT_GIG`; a value → budget with
  the verbatim quote; no value → `null` even when the model invented one; a currency outside
  `Currency` → `null` plus a note). Rubric rows; two-step check that an RSS
  `PUBLIC_TENDER → DIRECT_REQUEST` is still downgraded without a hiring cue (lesson). Card: the
  deadline is shown in Warsaw time and tagged "ze źródła"; "nie podano" without a value.
  Integration: BZP fixture → mock analysis → `GET /api/opportunities/:id` has `evidenceLevel
  PUBLIC_TENDER`, `source.tender.deadlineAt`, and `amountMaxMinor` only for the notice with a
  value.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm mutation --mutate
  apps/api/src/modules/scoring/rubric.ts` (a mutation target the phase touches).
- Human checks: open one analysed BZP card on a phone-width screen. Check that the deadline,
  buyer and value read correctly and that "Przetarg publiczny" is clear (screenshot in
  `evidence/`).

### Phase 5: Sources view tender config and source policy
- Files:
  - `apps/web/src/SourcesPage.tsx`, `SourcesPage.module.css`, `apps/web/src/api/sources.ts`,
    `strings.pl.ts`: the tender config editor (D-7) on `bzp`/`ted` sources. The URL row shows
    the API endpoint.
  - `apps/web/src/*.test.tsx` (where the Sources view is tested) or a new
    `SourcesPage.test.tsx`: the editor sends `PATCH { tender }` and shows server issues.
  - `e2e/`: extend the sources flow if it exists, so it adds the BZP preset and edits a prefix
    (network mocked as in the existing e2e setup). Otherwise a component test only.
  - `docs/source-policy.md`: the BZP and TED entries (access, terms, limits, stored fields,
    robots note D-12, D-16 overlap, `DO WERYFIKACJI` items) and Baza Konkurencyjności (manual).
  - `context/test-plan.md`: fixture folder `tenders/` under *Test data*; TR-17-like row for the
    API shapes.
- Proves: FR-32 AC1 "configured CPV prefixes" through the UI; the policy entries the roadmap
  lists.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`, `pnpm docker:build`,
  `pnpm docker:smoke`.
- Human checks: in the Sources view, add both presets, change BZP prefixes to `72, 48` and
  save. Check that the wording of the editor and access notes is clear. Read the two policy
  entries against the APIs' current terms pages and tick or correct each `DO WERYFIKACJI` item.

## Risks and unknowns
- The BZP response shape after the 2027-01-11 page-size change, and TED's query syntax, are
  taken from docs (see *Third-party APIs*). Any real difference is confined to `map-notice.ts`
  and `query.ts` of one adapter, and the Phase 2 checkpoint is there to catch it.
- The licence of the notice texts is `UNVERIFIED`. We store a bounded excerpt and the link, not
  the full notice or documents, and the policy marks it `DO WERYFIKACJI`.
- A large page (HTML bodies in a list response) may exceed `FETCH_MAX_BYTES`. In that case the
  run is an explicit `too_large`, never "no results", and the page size is the knob (see
  *Third-party APIs* for what the list carries).
- Notice texts are untrusted: no HTML parser runs on them, only bounded linear tag stripping
  (lesson on CPU-bound steps), and they reach the LLM only as delimited data.
- Polish tenders often need formal qualifications (turnover, references). The card does not
  judge eligibility; that stays the operator's call.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [ ] Phase 1: Source types, tender facts storage and the POST client
- [ ] Phase 2: e-Zamówienia BZP adapter (checkpoint)
- [ ] Phase 3: TED search adapter
- [ ] Phase 4: Public-tender classification and the card
- [ ] Phase 5: Sources view tender config and source policy

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
