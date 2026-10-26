# Plan: code-bounties (S-19)

## Goal and end state
Paid GitHub issues and Opire rewards that match the operator's profile arrive as signals through
the existing source loop (lock, interval, cursor, run history, source filter, explicit errors).
When done:

- The Sources view offers two more presets: "GitHub — płatne zgłoszenia (bounty)" and
  "Opire — nagrody za zgłoszenia". Each can be added once.
- A run of the GitHub source asks the official search API (`GET /search/issues`) for open issues
  that carry one of the configured labels (default `bounty`, `paid`, `💎 Bounty`), once per
  configured language. The default languages come from the operator profile. Requests stay
  inside the search limit: 10 per minute without a token, 30 with one. An optional
  `GITHUB_TOKEN` in `.env` raises the limit; without it the adapter runs anonymously. Each new
  issue becomes a signal that links to the issue. A reward stated in a label, the title or a
  reward line of the body is stored as a bounty fact. The analysis' `sourceBudget` comes from
  that fact only, so it is set only when the issue states a reward. (FR-33 AC1)
- A run of the Opire source reads the active rewards from Opire's public API. Each reward whose
  GitHub issue is still open becomes a signal that links to that GitHub issue and carries the
  reward amount as a bounty fact. A reward whose issue is closed (or missing) is skipped, counted
  and logged. (FR-33 AC2)
- An analysed bounty signal is `DIRECT_REQUEST` only when it explicitly asks for paid help: a
  stated reward or a hiring cue in the text. Otherwise the existing guard downgrades it, as for
  every other source. (FR-27 AC1 for the bounty case)
- A failing GitHub or Opire API (HTTP error, rate limit, timeout, bad JSON) is an explicit source
  error with reason and HTTP status, never "no results" (FR-04 AC3 unchanged).
- The token never appears in logs, API responses, the database or a request to another host.
- `docs/source-policy.md` has an entry for each API (access, terms, limits, stored fields,
  `DO WERYFIKACJI` items).

## Scope
- In:
  - two new source types, `github` and `opire`, behind a generic adapter port shaped like
    S-18's (D-1);
  - an optional per-request header on the guarded HTTP client, for the token;
  - `GITHUB_TOKEN` config;
  - bounty facts on the raw signal (one nullable column);
  - deterministic reward parsing;
  - the guard rules for `sourceBudget` and `DIRECT_REQUEST` on bounty sources;
  - the presets, with languages taken from the profile;
  - a GitHub config editor in the Sources view;
  - synthetic fixtures, `docs/source-policy.md` and `context/test-plan.md`.
- Out:
  - public tenders (S-18);
  - other bounty platforms (Algora, IssueHunt, Gitcoin);
  - reading issue comments, where bots such as Algora's state the amount;
  - re-checking stored bounties when their issue closes later ([FOLLOW-UP]);
  - the generic FR-27 GitHub Issues adapter (P1, *Later*) beyond what the bounty source needs;
  - a card block for bounty facts (the card already shows the source, link and budget);
  - `fixtures:record` for API sources.

## Findings

### Repository
- **The source loop is RSS-only on `main`.** `SourceAdapter.type: 'rss'`,
  `discover(config: RssConfig)` (`apps/api/src/modules/sources/ports.ts:24-35`) and
  `SourceRecord.type: 'rss'` (`ports.ts:37-39`). The service takes one `adapter`
  (`apps/api/src/modules/sources/service.ts:36-46`) and hardcodes `sourceType: 'rss'` on ingest
  (`service.ts:226`). The composition root builds exactly one RSS adapter
  (`apps/api/src/infrastructure/sources/compose.ts:58-66`). `Source.type` is
  `z.literal('rss')` with a required `url` (`packages/contracts/src/sources.ts:64-68`), and
  `SourceType` = `manual_text | manual_url | manual_fetch | rss`
  (`packages/contracts/src/opportunities.ts:13`). `sources.type` is free text in the schema, so
  a new type needs no migration.
- **S-18 (`public-tenders`) is in flight on `change/public-tenders` and not merged.** It
  generalises the same port. It adds:
  - `SourceKind` and a generic `SourceAdapter<C>` with `validateConfig`, `discover(config,
    context)` and `healthCheck`;
  - `SourceAdapters = Record<SourceKind, SourceAdapter>`, picked by `record.type`;
  - `NewSource.type`, `row.type as SourceKind` in `source-repository.ts`, and
    `update(…configJson)`;
  - `adapters?: Partial<SourceAdapters>` overrides in `compose.ts`, and `truncated?: true` on
    `AdapterOutcome`;
  - `DiscoverContext { since }`;
  - migration `0012` (`raw_signals.tender_json`), and a `tender` key on `PATCH
    /api/sources/:id` (`git diff main change/public-tenders -- apps/api/src/modules/sources/ports.ts`).

  This plan copies those generic shapes and names verbatim where it needs them (D-1), so
  whichever branch merges second resolves enum lists and the migration number, not two
  designs.
- **Ingest** builds the candidate with `sourceType` and stores no metadata
  (`apps/api/src/modules/signals/ingest.ts:7,76`). The last migration is `0011`.
- **The HTTP client sends no custom headers.** `GetOptions` = `{ signal, accept, beforeHop }`
  (`apps/api/src/infrastructure/sources/http/client.ts:28-36`). It follows up to 5 redirects
  and checks every hop against the SSRF guard.
- **Log redaction** covers the keys `token`, `apiKey` and `secret` at depth 0 and 1
  (`apps/api/src/infrastructure/logging/logger.ts:5-19`). A config field called `token` inside
  `github` is therefore redacted. A field called `githubToken` would not be.
- **The output guard** keeps a model's `sourceBudget` only when its quote is in the text. It
  downgrades `DIRECT_REQUEST`, and moves paid categories to `UNMET_NEED`, when
  `hasHiringCue(text)` is false (`apps/api/src/modules/analysis/output-guard.ts:85-113`).
  `paid` and `budget` are hiring cues, `bounty` and `reward` are not
  (`apps/api/src/modules/analysis/cues.ts:12-31`). The guard is called as
  `guardAnalysis(answer, row.text)` (`apps/api/src/modules/analysis/service.ts:175`), and the
  waiting row carries `sourceType` (`apps/api/src/modules/analysis/ports.ts:101-110`).
- **The pre-filter** rejects a non-manual signal with no profile term (`no_profile_match`,
  `apps/api/src/modules/analysis/prefilter.ts:118`). For a bounty, the language line the
  adapter writes into the text (D-6) normally matches the profile.
- **The profile** has `skills` and `preferredTechnologies` as free tags
  (`packages/contracts/src/profile.ts:51-54`). The server reads it through
  `{ get: () => profileService.get().profile }` (`apps/api/src/server.ts:90`).
- **The Sources view** (`apps/web/src/SourcesPage.tsx`, 507 lines) has a per-source filter
  editor (`:76-140`). Type labels live in `strings.pl.ts:343`.
- **Lessons that bind this plan:**
  - validate the bounty facts and the config before storing them;
  - bound source-supplied dates and numbers before storing them (`created_at`,
    `x-ratelimit-reset`, reward amounts);
  - bound the CPU-bound steps on untrusted input: cut the body before the reward scan, linear
    patterns only;
  - decide and test what a second source that disagrees does: the same issue from GitHub search
    and from Opire (D-12);
  - test the off state of a switch with input the on state rejects: the source filter on a
    bounty source, and the token absent vs present;
  - make race and rate tests assert exact request counts.

### Third-party APIs
The sandbox proxy refused `api.github.com/search/*` ("sessions are bound to their configured
repositories"), `api.opire.dev`, `opire.dev`, `docs.opire.dev` and `docs.github.com` (CONNECT
403). The facts below come from search excerpts and third-party code, not live responses.

**GitHub search** (`GET https://api.github.com/search/issues?q=…&sort=created&order=desc&per_page=…`):
- Rate limit: 30 requests per minute authenticated and 10 unauthenticated, for search endpoints
  other than code search. This is from the GitHub REST search docs as quoted in search results
  (<https://docs.github.com/en/rest/search/search>).
- Known from the GitHub docs (not re-read in this session):
  - at most 1 000 results per query and `per_page` ≤ 100;
  - the query length limit is 256 characters;
  - `label:a,b` means "a or b", and a label with spaces is quoted;
  - an exceeded limit answers 403 or 429 with `x-ratelimit-remaining: 0` and
    `x-ratelimit-reset` (epoch seconds); a secondary limit may send `retry-after`;
  - the response is `{ total_count, incomplete_results, items: [{ html_url, number, title,
    body, labels: [{ name }], state, created_at, repository_url, pull_request? }] }`;
  - the issue endpoint `GET /repos/{owner}/{repo}/issues/{n}` returns `state` and counts
    against the core limit (60 per hour anonymous, 5 000 with a token).
- Repeating `language:` in one query is `UNVERIFIED` (AND vs OR). This plan sends one query per
  language instead (D-4).

**Opire** (`GET https://api.opire.dev/rewards`), `UNVERIFIED`. No official API reference was
found. The Opire docs describe the platform (<https://docs.opire.dev/overview/getting-started>,
reward lifecycle at <https://docs.opire.dev/rewards/lifecycle>). Third-party users describe the
endpoint as follows:
- public, no auth, a JSON **array** of rewards, small (≈30 items in March 2026), and query
  parameters are ignored (bounty-mcp, <https://glama.ai/mcp/servers/Blackshield-Company/bounty-mcp>;
  DEV write-up, <https://dev.to/farkharoumy/how-to-use-opire-to-find-unclaimed-github-bounties-with-real-data-from-30-live-bounties-2dj5>);
- `opire-open-scan` reads `url` (the GitHub issue URL), `title`, `pendingPrice.value` with
  `unit` `USD_CENT`, `organization.name`, `claimerUsers` and `tryingUsers`
  (<https://github.com/filip-study/opire-open-scan>, `opire_open_scan.py:68-89`, read raw);
- a `programmingLanguages` field is mentioned (bounty-mcp);
- an `isClosed`/status field is **not** confirmed. Both tools check the GitHub issue state
  separately, because "Opire doesn't tell you if an issue is already closed" (DEV write-up). So
  AC2's "closed issues are skipped" needs a GitHub check per reward (D-8).

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | How do the bounty APIs fit the source loop, given S-18 changes the same port on an unmerged branch? | Two source types, `github` and `opire`, behind a generic port. The names and shapes copy S-18 verbatim: `SourceKind`, `SourceAdapter<C>`, `ConfigCheck<C>`, `SourceAdapters`, `NewSource.type`, `adapters` override in `compose.ts`, `truncated?: true`, `update(…configJson)`. The service picks the adapter by `record.type` and ingests with `sourceType = record.type`. `SourceKind = ['rss','github','opire']` and `SourceType` += `github`, `opire` (additive). `DiscoverContext` gets only `seen` (D-8). S-18's `since` is not needed here. | B: wait for S-18 to merge (no duplicated groundwork, but blocks this run, and nothing says S-18 merges first). C: an own port design (free, but the second merge would reconcile two designs). | Same shape → conflicts are enum lists and one migration number. The strongest argument against: both branches touch `ports.ts`, `service.ts`, `compose.ts` and `sources.ts`, so a merge conflict is certain, just mechanical. | costly (API contract: `Source.type`, `SourceType`) | agent |
| D-2 | Where do the reward and the issue facts live? | Nullable `raw_signals.bounty_json` (migration `0012`) holding `BountyFacts`: `platform` (`github`/`opire`), `repository` (`owner/repo`, ≤ 140 chars), `issueNumber`, `labels` (≤ 20 × ≤ 50 chars), `reward` (`{ amountMinor, currency: Currency, quote }` or null). Validated with Zod before insert; an invalid value is stored as `null` with a warn log naming the source id; on read it goes through `safeParse` | B: a generic `metadata_json` (one column for S-18 and S-19, but nothing validates it). C: text only (no migration, but the guard would re-parse untrusted text, and a forged line in a body could pass as a fact). | Same pattern as S-18 D-2, one additive column. A reviewer can fold it and `tender_json` into one column before either holds data | costly (data shape, migration) | agent |
| D-3 | What is the GitHub source's config? | `GithubSearchConfig = { labels: string[], languages: string[] }`, strict. Labels: 1–10, each 1–50 chars, no `"`, no duplicates. Languages: 0–5, from a fixed allow-list of GitHub Linguist names (`GITHUB_LANGUAGES` in contracts), no duplicates. The adapter always adds `is:issue is:open archived:false`; no free-text query (so no `is:pr`, no injection into qualifiers). One GitHub source, key `github` | B: free query strings per source (most flexible, but every query has to be validated against qualifiers, and the 256-char limit is checked at run time). C: several GitHub sources with different keys (parallel queries, but they overlap and share one rate limit). | "Configured queries" are covered by labels × languages. The config is validated before it is stored. Matches S-18 D-8 (one source per type) | costly (API contract: config and PATCH body) | agent |
| D-4 | How are the languages queried, and where do the defaults come from? | One search request per language (`language:X`), or one request without a language when the list is empty. Each request asks for page 1 with `per_page=50`, `sort=created&order=desc`. When the preset is added, the defaults are `skills ∪ preferredTechnologies` from the profile, mapped case-insensitively onto `GITHUB_LANGUAGES` (aliases: `node.js`/`nodejs` → JavaScript, `ts` → TypeScript), first 5 in profile order. The operator edits them afterwards (D-11) | B: all languages in one query (fewer requests, but AND/OR of repeated `language:` is `UNVERIFIED`). C: read the profile at every run (follows profile edits, but the source would show a config it does not use, and a run would depend on two modules) | ≤ 5 requests per run, documented semantics, and the stored config is what runs | cheap | agent |
| D-5 | How does the GitHub adapter stay inside the search limit? | It waits between search requests: 6 100 ms without a token, 2 100 ms with one (injected `sleep` and clock). 403/429 with `x-ratelimit-remaining: 0` → `rate_limited`, with `retryAfterMs` from `retry-after` or `x-ratelimit-reset`. The reset time is bounded to now…now + 1 h before use. 429/503 otherwise → the shared `retryDelay`. Any other 403 → `http_status`. `incomplete_results: true` → logged, items kept | B: read `x-ratelimit-remaining` and pace adaptively (fewer waits, more code). C: no spacing, only backoff (fast, but it would hit the limit by design) | Five requests at 6.1 s fit in 10/min with margin. Constants in one file | cheap | research |
| D-6 | What text does a bounty signal carry? | Labelled lines built by the adapter: the title, `Repozytorium: owner/repo`, `Etykiety: …`, `Język (wyszukiwanie): X` (GitHub, from the query that found it), `Nagroda (Opire): 150.00 USD` (Opire only), then the issue body cut to `IMPORT_MAX_TEXT_CHARS`. The URL is the issue `html_url`; the key is `github:<owner>/<repo>#<n>` for both types | B: body only (the pre-filter and the LLM would miss labels and language). C: JSON of the fields (poor to read) | Gives the pre-filter (`no_profile_match`) and the LLM the facts as data. A shared key form lets one parser serve both types | cheap | agent |
| D-7 | How is "the reward the issue states" found? | `parseReward({ labels, title, body })`, a pure function. Candidates in order: labels, then title, then body lines that contain `bounty`, `reward` or `nagroda` (case-insensitive). An amount is a currency marker (`$`, `US$`, `€`, `zł`, `USD`, `EUR`, `PLN`) next to a number (`1,000`, `1 000`, `1000.50`, `1k`). Linear, anchored regexes over a body already cut to the text limit. Exactly one distinct amount → `reward` with the verbatim matched text as `quote`. None or several different amounts → `null` (unknown, never guessed). Opire: `pendingPrice` with unit `USD_CENT` → `{ amountMinor: value, currency: 'USD' }`, quote = the adapter's `Nagroda (Opire)` line. Any other unit → `null` | B: let the model find the reward through the existing quote check (no parser, but not deterministic; the mock and real providers differ). C: labels only (safest, but misses `[$200]` titles) | AC1 "only when the issue states it" holds by construction, whatever the provider. Ambiguity stays unknown (PRD §0) | cheap | agent |
| D-8 | How are closed Opire issues skipped (AC2)? | For each reward that is not in the cursor (`DiscoverContext.seen`), the adapter calls `GET /repos/{o}/{r}/issues/{n}` (token if set, 1 000 ms apart). It keeps `state: open` without `pull_request`, and skips `closed`, 404 and 410 (counted and logged as `opire closed N missing M`). At most 20 checks per run. Rewards beyond the cap are left out, the outcome is `truncated` and the run `partial`, so they come next run. A rate-limited check ends the run as `rate_limited`. The issue body from that call becomes the signal text. A reward URL that is not `github.com/<o>/<r>/issues/<n>` counts as `skipped` | B: trust an Opire status field (no extra calls, but no such field is confirmed). C: GitHub search `is:open` per repository (fewer calls for many rewards in one repo, but a query per repo and no issue-number filter) | Only the GitHub API can say an issue is closed. 20 calls an hour fit in the anonymous 60/h core limit. `seen` keeps known rewards from being re-checked | cheap | research |
| D-9 | How does the token reach GitHub without leaking? | `GITHUB_TOKEN` (optional, `z.string().trim().min(1)`) parsed into `config.github.token` (a `token` key, so pino redaction covers it). `GetOptions` gains `headers?: Record<string, string>`. The client sends them on the first hop and on same-origin redirects only, and drops them when a redirect changes origin. The adapters add `Authorization: Bearer …` only for `https://api.github.com` and never for Opire. A canary test checks logs, `GET /api/sources`, the stored rows and an Opire request | B: a token-aware GitHub-only client (isolated, but it bypasses the SSRF guard and the semaphore). C: never follow redirects with headers (safest, but GitHub answers 301 for renamed repositories on the same origin) | One guarded path for every outbound request. The header is stripped on a cross-origin hop, like browsers and undici do with `Authorization` | costly (security) | agent |
| D-10 | How are bounty signals classified (FR-27 AC1)? | `guardAnalysis(result, text, origin?: { sourceType, bounty })`. For `github`/`opire`, `sourceBudget` is replaced by `bounty.reward` (`min = max = amount`, with its quote), or `null` plus a note when there is none, even if the model gave one. A stated reward also counts as an explicit offer to pay in the hiring check, so `hiring = hasHiringCue(text) \|\| bounty.reward !== null`. No reward and no cue → `DIRECT_REQUEST` is downgraded and paid categories → `UNMET_NEED`, as today. A label alone (`bounty`, no amount) is not enough unless its text is itself a cue (`paid`) | B: every issue from a bounty label counts as paid (Algora-style bounties keep `DIRECT_REQUEST`, but a stale or decorative label would pass as a paid request). C: never `DIRECT_REQUEST` for GitHub (the strictest reading of FR-27, but it hides real rewards) | "Explicitly asks for paid help" = an amount or explicit words. One boolean to widen to B | cheap | agent |
| D-11 | How is the GitHub config edited? | `PATCH /api/sources/:id` gains `github: GithubSearchConfig` (400 `not_github_source` for other types). The refine becomes "enabled, filter or github". The Sources view shows two fields on a GitHub source, "Etykiety" and "Języki" (one per line, languages checked against the list), plus "Zapisz zapytanie". Opire has no config (`{}`, key `opire`) | B: a generic `config` key for every type (one route rule for S-18 and S-19, but S-18 already ships `tender`). C: no editor, only the preset defaults (AC1 says "configured") | Mirrors S-18 D-7 and the S-17 filter editor, which keeps the merged API consistent | costly (API contract) | agent |
| D-12 | The same issue from GitHub search and from Opire (lesson: shared, deduplicated records) | Both use the issue `html_url` as the canonical URL, so the second source sees a duplicate and adds `REPEAT_IMPORT` evidence (FR-06). The first source to store it wins, including its `bounty_json`, so a GitHub-first issue does not get Opire's amount. Tested both ways and documented in the policy | B: on a duplicate whose stored `bounty.reward` is null, write the newer reward and requeue the analysis (better data, but a new update path, a state change on an analysed row, and an order-dependent result anyway) | Same rule as S-17 D-19 and S-18 D-16. [FOLLOW-UP] for B | cheap | agent |
| D-13 | robots.txt for the two APIs? | Not consulted, as in S-18 D-12. Access goes through a documented API (GitHub) or the platform's public API (Opire), and the policy says so | B: check robots.txt as for feeds (`api.github.com/robots.txt` disallows crawlers site-wide, which would block the official API) | PRD §5 asks for official or permitted access; the API is that access | cheap | agent |
| D-14 | Which fixtures do the adapter tests use? | Synthetic responses in the documented (GitHub) and third-party-described (Opire) shapes, marked `DEMO`, in `apps/api/test/fixtures/bounties/`. GitHub: a page with a `$` label, a `[$200]` title, a reward line in the body, two different amounts, no reward, a PR item and a non-allowed language. Opire: a USD_CENT reward, an unknown unit, a closed issue, a 404 issue and a non-issue URL. Each file says `UNVERIFIED` until the human check replaces it with a trimmed real response (`DEMO` names) | B: wait for recordings (blocks the run) | Truth first: synthetic files are labelled as such | cheap | agent |
| D-15 | Opire's response is an object, not an array, or the fields differ | `map-reward.ts` accepts an array, or an object with an array under `rewards` or `data`. Anything else → `invalid_feed`. A reward without a usable `url` → `skipped`. Every field is read in `map-reward.ts` only | B: array only (strict, but one wrapper change breaks the source) | A shape change is a one-file fix, and it never turns into silent "no results" | cheap | agent |
| D-16 | Phase 1 registry shape and the plan-review fixes it carries (plan-review 1, 9, 10) | `SourceAdapters = Partial<Record<SourceKind, SourceAdapter>>`; a stored type with no adapter fails its run and its check with `internal` (tested). `AdapterOutcome.ok` gains `checkedKeys?: string[]`, which the service merges into the cursor, so Opire's closed issues are remembered (finding 1). The endpoint shown for a bounty source is a per-type constant in the service, used by `toSource` and `logHost` (finding 9) | B: `Record` with stub adapters (typechecks, but a stub hides the missing-adapter path) | Findings 1, 9 and 10 land in the port and service this phase touches anyway | cheap | agent |
| D-17 | Reward parser refinements from plan-review 8 | A `$` right after a letter other than `US` (`CA$`, `AU$`) is refused: the whole parse gives `null` (an unknown currency is an ambiguity, never USD). Body lines with `pay`, `paid`, `budget`, `płac…`, `płatn…` are candidates besides `bounty`, `reward`, `nagroda`. Zero, out-of-range (> 10⁹ units) and quotes longer than 60 chars are refused the same way | B: skip the refused amount and keep the others (a reward would survive next to `CA$200`, but the issue then states two amounts and one is unreadable) | Truth first: an amount the parser cannot read must not leave another one looking certain | cheap | agent |

## Design

### Contracts (`packages/contracts`)
- `opportunities.ts`:
  - `SourceType` += `github`, `opire`;
  - `BountyFacts` (strict, D-2): `reward.amountMinor` 0…`100_000_000_000`, `currency`
    `Currency`, `quote` 1–200 chars; `issueNumber` int 1…10⁹.
- `sources.ts`:
  - `SourceKind = z.enum(['rss','github','opire'])`, used for `Source.type`;
  - `GITHUB_LANGUAGES` (≈30 Linguist names) and `GithubSearchConfig` (D-3);
  - `OpireConfig = z.object({}).strict()`;
  - `Source` gains `github: GithubSearchConfig.nullable()`; `url` stays the API endpoint (display
    only);
  - `SourcePreset` gains `type: SourceKind`;
  - `UpdateSourceRequest` gains `github`.
  - No `.transform()` in any response schema (S-17 D-16).

### Port (`apps/api/src/modules/sources/ports.ts`)
These shapes copy S-18; only `seen` is this change's addition.
```ts
interface DiscoverContext { seen: ReadonlySet<string> }        // cursor keys (D-8)
interface FeedItem { …existing; bounty?: BountyFacts }
interface SourceAdapter<C = unknown> {
  type: SourceKind;
  validateConfig(config: unknown): ConfigCheck<C>;
  discover(config: C, context: DiscoverContext): Promise<AdapterOutcome>;
  healthCheck(config: C): Promise<AdapterOutcome>;            // one request, nothing stored
}
type SourceAdapters = Record<SourceKind, SourceAdapter>;
// AdapterOutcome ok += truncated?: true   → run `partial`
```
An unknown stored type fails the run with `internal`.

### Data
Migration `0012`: `ALTER TABLE raw_signals ADD bounty_json text;`. It is `NULL` for every
existing row. `IngestCandidate.bountyJson` is validated in the service before the transaction.

### Adapters (`apps/api/src/infrastructure/sources/github/`)
- `query.ts`: `buildQueries(config) → string[]`. Example: `is:issue is:open archived:false
  label:bounty,paid,"💎 Bounty" language:TypeScript`.
- `map-issue.ts`: one search item or issue → `FeedItem | 'skip'`. Skips an item with
  `pull_request`; builds the D-6 text and `BountyFacts`; bounds `created_at` to
  2000-01-01…2100-01-01, else `null`.
- `reward.ts`: `parseReward` (D-7).
- `api.ts`: `githubGet(path)`, the shared request helper for both adapters. It adds headers
  (D-9), maps rate limits (D-5) and failures:
  - transport error → its `FetchFailureReason`;
  - non-2xx → `http_status`;
  - not JSON → `invalid_feed`.
- `adapter.ts`: search loop (D-4, D-5). `healthCheck` sends the first query only.

`apps/api/src/infrastructure/sources/opire/`:
- `map-reward.ts` (D-15) and `adapter.ts` (one GET of `/rewards`, then D-8 checks through
  `githubGet`).

### Analysis
The waiting-row query gains `bounty_json`; `service.ts` passes `{ sourceType, bounty }` to the
guard (D-10).

### Web
- `strings.pl.ts`: labels for `github` and `opire`, plus the editor texts.
- `SourcesPage.tsx`: the GitHub config editor (D-11); the URL row shows the API endpoint.
- `api/sources.ts`: `updateSource` accepts `github`.

## Phases

### Phase 1: Generic source types, bounty facts storage and the token header
- Files:
  - `packages/contracts/src/opportunities.ts`: `SourceType` += `github`, `opire`;
    `BountyFacts`. Contract: new enum values (additive).
  - `packages/contracts/src/sources.ts` (+ `sources.test.ts`): `SourceKind`, `GITHUB_LANGUAGES`,
    `GithubSearchConfig`, `OpireConfig`; `Source.type` enum and `Source.github`;
    `SourcePreset.type`; `UpdateSourceRequest.github`. Tests: config limits, duplicates, `"` in
    a label, a language outside the list, `BountyFacts` bounds.
  - `packages/contracts/src/index.ts`: exports.
  - `packages/config/src/env.ts` (+ test), `.env.example`: `GITHUB_TOKEN` optional →
    `config.github.token?`. Invariant: never logged (redaction key `token`).
  - `apps/api/src/infrastructure/db/schema.ts`, `apps/api/migrations/0012_*.sql` (+ meta):
    `raw_signals.bounty_json`. Invariant: nullable, `NULL` for existing rows.
  - `apps/api/src/modules/sources/ports.ts`: the D-1 port, `DiscoverContext.seen`,
    `FeedItem.bounty`, `truncated`, `SourceRecord.type: SourceKind`, `NewSource.type`,
    `update(…configJson)`.
  - `apps/api/src/modules/sources/service.ts`:
    - the adapter registry by type, and `seen` passed to `discover`;
    - `sourceType = record.type`;
    - `bounty` validated before ingest; invalid → `null` plus a warn log;
    - `truncated` → `partial`;
    - `update` with `github` (refusal `not_github_source` for other types);
    - `toSource` with `github`.
  - `apps/api/src/modules/sources/routes.ts`: `not_github_source` → 400.
  - `apps/api/src/modules/signals/ingest.ts`, `ports.ts`,
    `apps/api/src/infrastructure/db/signal-repository.ts`: `bountyJson` on insert.
  - `apps/api/src/infrastructure/db/source-repository.ts`: type read from the row, `insert`
    takes `type`, `update` takes `configJson`.
  - `apps/api/src/infrastructure/sources/rss/adapter.ts`: implements `SourceAdapter<RssConfig>`
    (ignores the context).
  - `apps/api/src/infrastructure/sources/compose.ts`: registry (RSS only in this phase; a stored
    `github`/`opire` source fails with `internal` until Phases 3–4), `adapters` override for
    tests.
  - `apps/api/src/infrastructure/sources/http/client.ts`, `apps/api/test/http-client.int.test.ts`:
    `headers` on `get` (D-9). Contract: headers are sent on the first hop and same-origin hops
    only.
  - `apps/web/src/strings.pl.ts`: type labels for `github` and `opire` (keeps the list filter
    typed).
- Proves: groundwork for FR-33 AC1–AC2.
  - Unit: contract rules; env parsing with and without the token.
  - Integration, client: the header reaches the first host; it is kept on a same-origin 301; it
    is absent after a cross-origin redirect (asserted on `MockAgent` interceptors).
  - Integration, a fake `github` adapter registered through `adapters`:
    - its items are stored with `sourceType: 'github'` and `bounty_json`;
    - invalid facts give a stored item with `bounty_json` `NULL` and a warn line;
    - `seen` holds the cursor keys;
    - `truncated` → `partial`;
    - PATCH `github` on an RSS source → 400;
    - PATCH a valid `github` config on a github source → stored and returned;
    - an existing RSS run is unchanged (existing suite).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Reward parsing and the bounty guard rules
- Files:
  - `apps/api/src/infrastructure/sources/github/reward.ts` (+ test): `parseReward` (D-7).
    Table: `$100` label, `Bounty: 250 USD` body line, `[$1,500]` title, `€50`, `1k USD`, two
    different amounts → null, the same amount twice → one, an amount on a line without a keyword
    → null, `$` alone, a mid-number quote. A body of `IMPORT_MAX_TEXT_CHARS` of `$1 $2 …` ends
    within a fixed time budget (lesson).
  - `apps/api/src/modules/analysis/output-guard.ts` (+ test): `origin` parameter and the D-10
    rules. Contract: `guardAnalysis(result, sourceText, origin?)`; callers without `origin` are
    unchanged.
  - `apps/api/src/modules/analysis/ports.ts`, `service.ts`,
    `apps/api/src/infrastructure/db/analysis-repository.ts`: the waiting row carries
    `bounty: BountyFacts | null` (`safeParse` on read) and the service passes it.
- Proves: FR-33 AC1 (the `sourceBudget` half) and FR-27 AC1 (bounty case).
  - Unit guard table:
    - github with a reward, model says no budget → the reward becomes the budget;
    - github without a reward, model invents `$500` with a matching quote → `null` plus a note;
    - github with a reward, model says `DIRECT_REQUEST` and the text has no cue → kept;
    - github without a reward or cue → downgraded to `EXPLICIT_PROBLEM`;
    - RSS input → behaviour unchanged.
  - Two-step check (lesson): for a bounty without a reward, the model's `DIRECT_GIG` +
    `DIRECT_REQUEST` are both downgraded.
  - Integration: a github item with a reward goes through the mock provider, and
    `GET /api/opportunities/:id` has `amountMaxMinor` equal to the reward; an item without one
    has `null`.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm mutation --mutate apps/api/src/infrastructure/sources/github/reward.ts`.
- Human checks: none.

### Phase 3: GitHub search adapter and preset
- Files:
  - `apps/api/src/infrastructure/sources/github/query.ts` (+ test): D-3/D-4 query strings, label
    quoting, and the length checked against 256.
  - `apps/api/src/infrastructure/sources/github/map-issue.ts` (+ test): D-6 text, key, URL,
    facts, skip PRs, date bounds.
  - `apps/api/src/infrastructure/sources/github/api.ts` (+ test): headers, the D-5 failure and
    rate-limit mapping, and the reset bound.
  - `apps/api/src/infrastructure/sources/github/adapter.ts`: loop with spacing.
    `validateConfig` → key `github`.
  - `apps/api/src/modules/sources/presets.ts`: preset `github-bounties` (type `github`, labels
    `bounty`, `paid`, `💎 Bounty`, access note, terms
    `https://docs.github.com/en/site-policy/github-terms/github-terms-of-service`).
  - `apps/api/src/modules/sources/github-languages.ts` (+ test): `languagesFromProfile(profile)`
    (D-4).
  - `apps/api/src/modules/sources/service.ts`: `create` for typed presets. A github preset reads
    the profile through a `ProfileReader` dependency; an existing key → `exists`.
  - `apps/api/src/infrastructure/sources/compose.ts`, `apps/api/src/server.ts`,
    `apps/api/src/cli/*` (where the runtime is built): register `github`, pass the profile
    reader and `config.github.token`.
  - `apps/api/test/fixtures/bounties/github-search-*.json`: D-14.
  - `apps/api/test/bounty-sources.int.test.ts`: discovery through `MockAgent`.
- Proves: FR-33 AC1. Integration:
  - preset added with a profile listing `TypeScript`, `Node.js`, `Arduino` → languages
    `TypeScript`, `JavaScript`;
  - a run sends exactly one request per language, with the expected `q`, and the injected clock
    shows ≥ 6 100 ms between them;
  - with `GITHUB_TOKEN` the `Authorization` header is present and the spacing is 2 100 ms;
    without it the header is absent (both states, lesson);
  - signals link to `html_url`, and a PR item is skipped;
  - `bounty.reward` is set only for the stated-reward items;
  - 403 with `x-ratelimit-remaining: 0` → `rate_limited` with `nextAllowedAt` ≥ the interval
    and no further request (exact count);
  - 500 → `http_status`, earlier signals kept; non-JSON → `invalid_feed`;
  - a second run → duplicates only;
  - the source filter switched off lets through an issue that the filter switched on rejects
    (lesson);
  - token canary absent from the captured logs, `GET /api/sources` and the DB rows.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: one real run of the GitHub preset without a token (`pnpm discover` with only
  it enabled). Record the run result and request count, and compare one signal with its issue
  page. Then one run with a read-only, public-data token, and check that no 403 occurs. Evidence
  goes to `evidence/github-run.txt`, with no token and no personal data.

### Phase 4: Opire adapter and preset
- Files:
  - `apps/api/src/infrastructure/sources/opire/map-reward.ts` (+ test): D-15 envelope, URL →
    `owner/repo#n`, the `USD_CENT` reward, an unknown unit → `null`, the `Nagroda (Opire)` line.
  - `apps/api/src/infrastructure/sources/opire/adapter.ts`: GET `/rewards` (no auth header),
    the D-8 checks through `githubGet`, the 20-check cap → `truncated`. `healthCheck` sends the
    `/rewards` GET only.
  - `apps/api/src/modules/sources/presets.ts`: preset `opire-rewards` (type `opire`, terms
    `https://opire.dev` marked `DO WERYFIKACJI`).
  - `apps/api/src/infrastructure/sources/compose.ts`: register `opire`.
  - `apps/api/test/fixtures/bounties/opire-rewards.json`, `github-issue-*.json`: D-14.
  - `apps/api/test/bounty-sources.int.test.ts`: Opire cases.
- Proves: FR-33 AC2. Integration:
  - an open issue becomes a signal linked to the GitHub issue URL, with the reward fact;
  - a closed issue and a 404 issue are skipped, and none of them is stored;
  - a non-issue URL is counted as skipped (`partial`);
  - known rewards in the cursor get no GitHub check on the second run (exact request count);
  - 25 new rewards → 20 checks, `partial`, and the next run checks the other 5;
  - a rate-limited check → `rate_limited`;
  - the Opire request never carries `Authorization`, even with a token;
  - D-12 both orders: GitHub search first, then Opire → one opportunity, `REPEAT_IMPORT`
    evidence, and the reward stays `null`; Opire first → the reward is kept.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: one real run of the Opire preset. Record the real response shape against
  `map-reward.ts` (field names, envelope, unit), the counts of open, closed and skipped rewards,
  and one signal compared with its issue. Replace the synthetic fixture with a trimmed real one
  if the shape differs. Evidence goes to `evidence/opire-run.txt`.

### Phase 5: Sources view editor, source policy and test plan
- Files:
  - `apps/web/src/SourcesPage.tsx`, `SourcesPage.module.css`, `apps/web/src/api/sources.ts`,
    `strings.pl.ts`: the GitHub editor (D-11). Lines are trimmed and deduplicated before sending
    (as in the S-17 filter). Server issues are shown, and the API endpoint is shown in place of
    the feed URL.
  - `apps/web/src/SourcesPage.test.tsx` (or the existing Sources view test): the editor sends
    `PATCH { github }` and shows a 400 issue.
  - `docs/source-policy.md`: GitHub search and Opire entries. Each gives access, terms, rate
    limits, the token as optional, read-only and public data only, what is stored, the robots
    note (D-13), the overlap rule (D-12) and the `DO WERYFIKACJI` items (the Opire shape and
    terms).
  - `context/test-plan.md`: the `bounties/` fixtures under *Test data*; a TR row for API shape
    drift; TR-12 gains the `GITHUB_TOKEN` canary; mutation target `reward.ts`.
  - `CLAUDE.md`: nothing (no new command).
- Proves: FR-33 AC1 "configured queries" through the UI, and the policy entries.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`, `pnpm docker:build`,
  `pnpm docker:smoke`.
- Human checks: in the Sources view at phone width, add both presets, change the GitHub
  languages to `TypeScript` only and save. Judge the wording of the editor and the access notes
  (screenshot in `evidence/`). Read the two policy entries against GitHub's and Opire's current
  terms, then tick or correct each `DO WERYFIKACJI` item.

## Risks and unknowns
- **Opire's response shape and terms are `UNVERIFIED`** (third-party descriptions only). The
  mapping sits in one file (D-15), and the Phase 4 human check confirms it. If Opire forbids
  automated reads, the preset is withdrawn (S-17 D-7 mechanism), which is cheap.
- **Merge with S-18.** Both branches edit the same port, service, compose, contracts, the
  migration number `0012` and `PATCH` refine. The second to merge must:
  - unite the `SourceKind`/`SourceType` lists and the `DiscoverContext` fields;
  - renumber its migration and regenerate the drizzle journal;
  - merge the guard `origin` (`tender` + `bounty`).

  D-1 keeps this mechanical. Logged as `[REVIEW]` at implement time if S-18 merges first and
  the base moves.
- **Rate limits.** Without a token, a GitHub run (≤ 5 searches) plus an Opire run (≤ 20 core
  calls) fits in 10 searches per minute and 60 core calls per hour, provided they run ≥ 60 min
  apart (`SOURCE_MIN_INTERVAL_MINUTES`). A health check uses one more request. A secondary rate
  limit is mapped to `rate_limited`, never silent.
- **Coverage.** Many real bounties state the amount only in a bot comment (Algora). Those
  issues get `reward: null`, so they are not `DIRECT_REQUEST` and have no budget. That is the
  honest outcome, and reading comments is out of scope.
- **Prompt injection.** Issue bodies are untrusted. They reach the LLM only inside the
  delimited data block (existing prompt), and the reward comes from the parser, not the model.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Generic source types, bounty facts storage and the token header
- [x] Phase 2: Reward parsing and the bounty guard rules
- [ ] Phase 3: GitHub search adapter and preset
- [ ] Phase 4: Opire adapter and preset
- [ ] Phase 5: Sources view editor, source policy and test plan

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] Phase 2: the mock provider chooses `DIRECT_REQUEST` from text cues only, so the integration test asserts the reward-to-budget path end to end and the missing-reward downgrade, while "a reward keeps `DIRECT_REQUEST` with no cue" is asserted in the guard unit table.
- [minor] Phase 1: `update` on the source service now returns `{ kind: 'updated' | 'not_found' | 'not_github_source' }` instead of `Source | undefined`; PATCH 400 is `validation_failed | not_github_source`. The weight of the change is in `routes.ts` and `service.ts` only.
- [minor] Phase 1: `buildTestApp` gained `adapters` and `sourceLogger` options, and `createSourceRuntime` an `adapters` override, for the fake-adapter tests.
- [REVIEW] Plan-review findings 2 (Opire `too_old`), 3 (mid-run failures keep earlier items), 4 (D-8 and D-5 are `costly`), 5 (closed rewards stay out of `skipped`), 6 (`per_page` 30), 7 (link-count `spam`), 8 (parser: `CA$`, `pay|paid|budget`) and 11 (done in Phase 1 contracts: query length is checked in `GithubSearchConfig`) are not yet in the plan text. Phases 2–4 apply them and add the Decisions rows then. D-8 and D-5 should be read as `costly`.
- [REVIEW] The roadmap asks for adapter tests on recorded responses; D-14 uses synthetic fixtures because the sandbox proxy refuses the APIs. Recorded fixtures are owed through the Phase 3 and 4 human checks.
- [FOLLOW-UP] Re-check stored bounty signals when their issue closes, and enrich a stored
  duplicate with a reward that a later source states (D-12 B).
- [FOLLOW-UP] Read issue comments for bot-stated amounts (Algora), within the core rate limit.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
