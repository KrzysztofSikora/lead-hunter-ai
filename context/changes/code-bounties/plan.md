# Plan: code-bounties (S-19)

## Goal and end state
Paid GitHub issues and Opire rewards that match the operator's profile arrive as signals through
the existing source loop (lock, interval, cursor, run history, source filter, explicit errors).
When done:

- The Sources view offers two more presets, "GitHub — płatne zgłoszenia (bounty)" and
  "Opire — nagrody za zgłoszenia". Each can be added once.
- **GitHub search (FR-33 AC1).** A run asks the official search API (`GET /search/issues`) for
  open issues with one of the configured labels (default `bounty`, `paid`, `💎 Bounty`). It
  sends one query per configured language; the default languages come from the operator
  profile.
  - Requests stay inside the search limit: 10 per minute without a token, 30 with one.
  - An optional `GITHUB_TOKEN` in `.env` raises the limit. Without it the adapter runs
    anonymously (roadmap *Decided up front*).
  - Each new issue becomes a signal that links to the issue.
  - A reward stated in a label, the title or a reward line of the body is stored as a bounty
    fact. The analysis' `sourceBudget` comes from that fact only, so it is set only when the
    issue states a reward.
- **Opire (FR-33 AC2).** A run reads the active rewards from Opire's public API. Each reward whose
  GitHub issue is still open becomes a signal that links to that GitHub issue and carries the
  reward as a bounty fact. A reward whose issue is closed or gone is skipped and logged. Such a
  reward is not counted as a failure.
- **Classification (FR-27 AC1, bounty case).** An analysed bounty signal is `DIRECT_REQUEST`
  only when it explicitly asks for paid help: a stated reward or a hiring cue in the text.
  Otherwise the existing guard downgrades it, as for every other source.
- A failing GitHub or Opire API (HTTP error, rate limit, timeout, bad JSON) is an explicit source
  error with reason and HTTP status, never "no results" (FR-04 AC3 unchanged).
- The token never appears in logs, API responses or the database. It is never sent to a host
  other than `api.github.com`.
- `docs/source-policy.md` has an entry for each API (access, terms, limits, stored fields,
  `DO WERYFIKACJI` items).

## Scope
- In:
  - two new source types, `github` and `opire`, on S-18's adapter registry;
  - per-request headers on the guarded HTTP client's `get`, for the token;
  - `GITHUB_TOKEN` config;
  - bounty facts on the raw signal (one nullable column);
  - a deterministic reward parser;
  - the guard rules for `sourceBudget` and `DIRECT_REQUEST` on bounty sources;
  - the presets, with default languages taken from the profile;
  - a GitHub config editor in the Sources view;
  - synthetic fixtures, `docs/source-policy.md` and `context/test-plan.md`.
- Out:
  - other bounty platforms (Algora, IssueHunt, Gitcoin);
  - reading issue comments, where bots such as Algora's state the amount;
  - re-checking stored bounties when their issue closes later;
  - enriching a stored duplicate with a reward that a later source states (D-12 B);
  - the generic FR-27 GitHub Issues adapter (P1, roadmap *Later*) beyond what the bounty source
    needs;
  - a card block for bounty facts (the card already shows source, link and budget, D-21);
  - `fixtures:record` for API sources;
  - storing the reason of a `partial` run's later failure in the run row (D-17; [FOLLOW-UP]).

## Findings

### Earlier attempt (`change/code-bounties-v1`)
A first run of this change was planned and implemented on top of S-20, before S-18
(`public-tenders`) merged. It was reviewed twice (APPROVE WITH FOLLOW-UPS), and no PR was
opened. S-18 has since merged into `main` with its own generic source port, so v1 no longer
applies cleanly.

This plan starts again from `main` (`ef843db`) and reuses v1 as follows:
- v1's third-party research (the APIs are still unreachable from here, see below);
- the fixes its plan-review asked for (findings 1–12);
- the fixes its code review asked for (R2–R7).

Each one is folded into a decision below and named where it applies. v1's code is reference
only and is not cherry-picked: its port, service and contracts conflict with S-18's.

### Repository (after S-18)
- **The source port is already generic.**
  - `SourceAdapter<C>` has `validateConfig`, `discover(config, { since, resumeAt? })` and
    `healthCheck`. `ConfigCheck<C>` and `SourceAdapters = Record<SourceKind, SourceAdapter>`
    exist (`apps/api/src/modules/sources/ports.ts:53-66`).
  - `AdapterOutcome.ok` carries `truncated`, `resumeFrom` and `resumeAt` (`ports.ts:27-50`).
  - `SourceKind = ['rss','bzp','ted']` (`packages/contracts/src/sources.ts:139`).
  - `SourceType` adds `bzp` and `ted` to the manual and `rss` types
    (`packages/contracts/src/opportunities.ts:13-21`).
- **The service dispatches by type.**
  - It ingests with `sourceType: record.type` (`apps/api/src/modules/sources/service.ts:356`).
    It validates tender facts before ingest (`checkTender`, `:136-154`).
  - It merges ingested keys into `seen` (≤ 500, `:410`). On `truncated` it stores
    `resumeFrom = outcome.resumeFrom ?? since` (`:413-420`), and a truncated run is `partial`
    (`:425`).
  - A stored type with no adapter fails the run with `internal` (`:316-318`).
  - `parseConfigUrl` returns the tender preset's endpoint for any non-RSS type (`:99-110`).
    `logHost` uses it (`:240-243`).
  - `update` with `tender` answers `not_tender_source` for `rss` (`:527`).
  - `create` from a preset picks `type` from it (`:476-500`).
- **Composition.**
  - `compose.ts` builds `rss`, `bzp` and `ted`, and takes `adapters` overrides for tests
    (`apps/api/src/infrastructure/sources/compose.ts:57-87`).
  - `buildTestApp` passes `adapters` through (`apps/api/test/helpers/app.ts:113,171`).
  - The server already builds a profile reader, `{ get: () => profileService.get().profile }`
    (`apps/api/test/helpers/app.ts:142`, same in `server.ts`).
- **The HTTP client.**
  - `GetOptions` = `{ signal, accept, beforeHop?, maxBytes? }`: no custom headers. `post`
    exists and follows no redirects (`apps/api/src/infrastructure/sources/http/client.ts:30-52`).
  - `get` follows up to 5 redirects and checks the SSRF guard on every hop.
- **Logging.** Log redaction covers the keys `token`, `apiKey` and `secret`, at depth 0 and 1
  (`apps/api/src/infrastructure/logging/logger.ts:5-12`). A config key named `token` is
  therefore redacted; a key named `githubToken` would not be.
- **No `GITHUB_TOKEN` in `packages/config/src/env.ts` on `main`.** The `dist/` of this worktree
  mentions one, but that is stale v1 build output (gitignored).
- **Migrations.** The last migration is `0012_fresh_molten_man.sql` (S-18's `tender_json`).
- **The output guard.**
  - Signature: `guardAnalysis(result, sourceText, origin?: { sourceType, tender })`
    (`apps/api/src/modules/analysis/output-guard.ts:11-15, 199-203`).
  - Tender sources get their budget from the facts and skip the hiring-cue downgrade
    (`:115-152`).
  - `paid` and `budget` are hiring cues; `bounty` and `reward` are not
    (`apps/api/src/modules/analysis/cues.ts:12-31`).
  - The runner passes `{ sourceType, tender: tenderOf(row.tenderJson) }`
    (`apps/api/src/modules/analysis/service.ts:110, 187-189`). The waiting row carries
    `tenderJson` (`apps/api/src/modules/analysis/ports.ts:107-108`).
- **The pre-filter.**
  - Bodies with more than 10 `http(s)://` links are rejected as `spam`
    (`apps/api/src/modules/analysis/prefilter.ts:24, 103-104`).
  - `no_profile_match` fires for every type except manual and tender ones (`:120-125`).
  - `too_old` skips `publishedAt: null`.
- **The Sources view.**
  - It has the S-17 filter editor and S-18's `TenderEditor` (`apps/web/src/SourcesPage.tsx:149-190,
    309-339`). `apps/web/src/api/sources.ts:60-78` maps `not_tender_source`.
  - A component test exists (`SourcesPage.test.tsx`, S-18 Phase 5).
- **The test plan.** The last risk row is TR-29 (tender API shapes, `context/test-plan.md:64`).
  There are two mutation targets (`:100-108`).

### Lessons that bind this plan
- validate the bounty facts and the config before storing them;
- bound source-supplied dates and numbers before use (`created_at`, `x-ratelimit-reset`, reward
  amounts);
- bound CPU-bound work on untrusted input: cut the body before the reward scan, use linear
  patterns only, and test with a body of the maximum size;
- decide and test what a second source that disagrees does (the same issue from GitHub search
  and from Opire, D-12);
- test the off state of each switch with input the on state would reject:
  - the source filter on a bounty source;
  - the token absent vs present;
- assert exact request counts in rate and spacing tests, and check that they fail without the
  guard;
- give the reward parser negative tests with look-alike phrasing (sponsor amounts, rates, credits,
  ranges, foreign dollars);
- the cursor must progress on every run: Opire's 20-check cap must not starve on the same closed
  rewards (D-8);
- answer every major plan-review finding before implementing.

### Third-party APIs
No live request was possible from this session. A probe on 2026-10-26 got:
- `api.github.com/search/issues`: 403 from the egress proxy;
- `api.opire.dev`, `docs.opire.dev` and `docs.github.com`: no connection.

v1 met the same refusals. The facts below are v1's research (search excerpts and third-party
code). No real response confirms them.

**GitHub search** (`GET https://api.github.com/search/issues?q=…&sort=…&order=desc&per_page=…`):
- Rate limit, per the GitHub REST search docs (<https://docs.github.com/en/rest/search/search>):
  - 30 requests per minute authenticated, 10 unauthenticated (search other than code search);
  - at most 1 000 results per query, `per_page` ≤ 100, and `q` ≤ 256 characters.
- Query syntax: `label:a,b` means "a or b", and a label with spaces is quoted. Repeating
  `language:` in one query is `UNVERIFIED` (AND vs OR), so this plan sends one query per
  language (D-4).
- Limit answers:
  - a primary limit answers 403 or 429 with `x-ratelimit-remaining: 0` and `x-ratelimit-reset`
    (epoch seconds);
  - a secondary limit answers 403 or 429, may send `retry-after`, and does not always zero
    `remaining`.
- Response: `{ total_count, incomplete_results, items: [{ html_url, number, title, body,
  labels: [{ name }], state, created_at, updated_at, repository_url, pull_request? }] }`.
- `GET /repos/{owner}/{repo}/issues/{n}` returns `state` and counts against the core limit (60
  per hour anonymous, 5 000 with a token). A transferred issue or renamed repo answers with a
  same-origin 301.
- Name rules: owner `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`; repo `^[A-Za-z0-9._-]{1,100}$`,
  never `.` or `..` (v1 R4).

**Opire** (`GET https://api.opire.dev/rewards`) is `UNVERIFIED`. No official API reference was
found; the docs describe the platform (<https://docs.opire.dev/overview/getting-started>). From
third-party users:
- public, no auth; returns a JSON **array** of rewards, small (≈ 30 items in March 2026), and
  ignores query parameters (bounty-mcp,
  <https://glama.ai/mcp/servers/Blackshield-Company/bounty-mcp>; DEV write-up,
  <https://dev.to/farkharoumy/how-to-use-opire-to-find-unclaimed-github-bounties-with-real-data-from-30-live-bounties-2dj5>);
- `opire-open-scan` reads `url` (the GitHub issue URL), `title`, `pendingPrice.value` with
  `unit` `USD_CENT`, `organization.name`, `claimerUsers` and `tryingUsers`
  (<https://github.com/filip-study/opire-open-scan>, `opire_open_scan.py:68-89`);
- a `programmingLanguages` field is mentioned (bounty-mcp);
- no closed/status field is confirmed. Both tools check the GitHub issue state themselves
  ("Opire doesn't tell you if an issue is already closed", DEV write-up), so AC2 needs a GitHub
  check per reward (D-8).

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | How do the bounty APIs fit the source loop? | Two source types, `github` and `opire`, on S-18's registry: `SourceKind` += `github`, `opire` and `SourceType` += `github`, `opire` (additive). Each adapter implements `SourceAdapter<C>` and ignores `since` and `resumeAt`. `parseConfigUrl` becomes a per-type endpoint table (`SOURCE_ENDPOINTS` in `service.ts`): `rss` reads its config, and the other types use a constant. `toSource` and `logHost` both use it (v1 plan-review 9). | B: a separate bounty job outside the source loop (no contract change, but a second lock, run history and error model). C: one generic "GitHub" type with Opire as a mode (fewer enum values, but two unrelated configs behind one type). | Reuses everything S-18 built, so FR-04 AC3 errors, the source filter and run history apply unchanged. The strongest argument against: `Source.type` and `SourceType` are API contracts that the web app switches on. The change is additive. | costly | agent |
| D-2 | Where do the reward and the issue facts live? | A nullable `raw_signals.bounty_json` column (migration `0013`) holding `BountyFacts`, strict, validated with Zod before insert and with `safeParse` on read. An invalid value is stored as `null`, with a warn line naming the source id and field. Fields: `platform` (`github`/`opire`), `repository` (`owner/repo`, name rules as in *Findings*), `issueNumber` (int 1…10⁹), `labels` (≤ 20 × ≤ 50 chars), `reward` (`{ amountMinor 1…10¹¹, currency: Currency, quote 1…200 }` or null). | B: fold `tender_json` and this into one `metadata_json` (one column for every API source, but nothing validates an open bag, and `tender_json` already holds data). C: text only (no migration, but the guard would re-parse untrusted text, and a forged line in a body could pass as a fact). | Same pattern as S-18 D-2, one additive column. A reviewer can rename it before it holds data. | costly | agent |
| D-3 | What is the GitHub source's config? | `GithubSearchConfig = { labels, languages }`, strict. Labels: 1–10, each 1–50 chars, no `"`, no control characters, no duplicates (case-insensitive). Languages: 0–5 from a fixed list of GitHub Linguist names (`GITHUB_LANGUAGES` in contracts), no duplicates. A refine checks that the longest built query is at most 256 chars (v1 plan-review 11), so PATCH answers 400 instead of the run failing later. The adapter always adds `is:issue is:open archived:false`; there is no free-text query. One GitHub source, key `github`. | B: free query strings per source (most flexible, but every string has to be checked against qualifiers and injection). C: several GitHub sources (parallel queries, but they overlap and share one rate limit). | "Configured queries" are covered by labels × languages. The config is validated before it is stored. Matches S-18 D-8 (one source per type). | costly | agent |
| D-4 | How are the languages queried, and where do the defaults come from? | One search per language (`language:"X"`), or one search without a language when the list is empty. Each search asks for page 1 with `per_page=30` and `sort=updated&order=desc`. Defaults: when the preset is added, `skills ∪ preferredTechnologies` from the profile, mapped case-insensitively onto `GITHUB_LANGUAGES` (aliases `node.js`/`nodejs`/`react` → JavaScript, `ts` → TypeScript), first 5 in profile order, no duplicates. The operator edits them afterwards (D-11). | B: `sort=created` (v1; stable, but misses an old issue that gets a bounty label later, the usual Algora flow). C: all languages in one query (fewer requests, but the semantics are `UNVERIFIED`). D: read the profile at every run (follows profile edits, but the source would show a config it does not use). | Adding a label updates `updated_at` (`UNVERIFIED`; checked at the Phase 3 checkpoint). With ≥ 60 min between runs, the 30 most recently updated issues per language cover new bounties. The cursor and identity dedupe absorb the repeats. At most 5 requests per run, and the stored config is what runs. | cheap | agent |
| D-5 | How does the GitHub adapter stay inside the search limit? | Spacing between any two requests of the shared GitHub helper: 6 100 ms without a token, 2 100 ms with one (injected `sleep` and clock). A primary limit (403 or 429 with `x-ratelimit-remaining: 0`) → `rate_limited`, with `retryAfterMs` from `x-ratelimit-reset` bounded to now…now + 1 h. A secondary limit (403 with `retry-after`) → `rate_limited`, with `retryAfterMs` from `retry-after`, bounded the same way. 429 without `remaining: 0`, and 503 → the shared `retryDelay` backoff, then `rate_limited` (v1 R7: a 429 with `retry-after` stays on the backoff). Any other 403 → `http_status`. `incomplete_results: true` → logged, items kept. | B: pace by reading `x-ratelimit-remaining` (fewer waits, more code). C: no spacing, only backoff (fast, but hits the limit by design). | Five searches at 6.1 s fit in 10 per minute with margin. The constants sit in one file. | costly | research |
| D-6 | What text does a bounty signal carry? | Labelled lines, then the body. The adapter writes: the title, `Repozytorium: owner/repo`, `Etykiety: …`, `Język (wyszukiwanie): X` (GitHub, from the query that found it), `Utworzono: YYYY-MM-DD` (bounded date, D-16), and `Nagroda (Opire): 150.00 USD` (Opire only). Then comes the issue body, cut to `IMPORT_MAX_TEXT_CHARS`. The URL is the issue `html_url`. The key is `github:<owner>/<repo>#<n>` for both types. | B: body only (the pre-filter and the LLM would miss labels and language). C: JSON of the fields (poor to read). | Gives the pre-filter (`no_profile_match`) and the LLM the facts as data, the same way S-18 D-5 does. One key form serves both types (D-12). | cheap | agent |
| D-7 | How is "the reward the issue states" found? | `parseReward({ labels, title, body })` is a pure function over input that is already cut. Candidates, in order: labels, then the title, then body lines with `bounty`, `reward`, `nagroda`, `pay`, `paid`, `budget`, `płac…` or `płatn…`. An amount is a currency marker (`$`, `US$`, `€`, `zł`, `USD`, `EUR`, `PLN`) next to a number (`1,000`, `1 000`, `1000.50`, `1.5k`). Exactly one distinct amount gives `reward`, with the matched text verbatim as `quote`. The whole parse gives `null` (unknown, never guessed) when any of these holds: <ul><li>no amount, or several different amounts;</li><li>a `$` right after another letter (`CA$`, `AU$`);</li><li>a rate or recurring amount (`/h`, `/hour`, `per hour`, `/month`, `/mo`);</li><li>a candidate line that also says `sponsor` or `credit`;</li><li>a range (`$100–$500`);</li><li>a zero amount, more than 10⁹ units, or a quote over 60 chars.</li></ul> Opire: `pendingPrice` with unit `USD_CENT` → `{ amountMinor: value, currency: 'USD' }`, with the adapter's `Nagroda (Opire)` line as quote; any other unit → `null`. | B: let the model find the reward through the existing quote check (no parser, but not deterministic; the mock and real providers differ). C: labels only (safest, but misses `[$200]` titles and "Bounty: 250 USD" lines). | AC1 "only when the issue states it" holds by construction, whatever the provider. Ambiguity stays unknown (PRD §0). The refusals answer v1 plan-review 8 and the look-alike lesson. | cheap | agent |
| D-8 | How are closed Opire issues skipped (AC2) without starving the cap? | For each reward whose key is not in the cursor, the adapter calls `GET /repos/{o}/{r}/issues/{n}` through the GitHub helper (token if set; spacing as in D-5). <ul><li>Kept: `state: open` without `pull_request`. The issue body from that call becomes the signal text.</li><li>Skipped: `closed`, 404 and 410. Logged as `opire closed N missing M`, not counted in `skipped` (v1 plan-review 5).</li><li>Every checked key is returned in `checkedKeys`, the reward's own key included even when the answer names another issue (v1 R5). The service merges them into the cursor, so a closed reward is not checked again (v1 plan-review 1).</li><li>Cap: at most 20 checks per run. Beyond it the outcome is `truncated` and the run `partial`.</li><li>A rate-limited check fails the run (`rate_limited`); any other failed check counts as `skipped` and is not remembered.</li><li>A reward URL that is not `https://github.com/<o>/<r>/issues/<n>` with valid names (v1 R4) counts as `skipped`.</li></ul> `DiscoverContext` gains `seen: ReadonlySet<string>`; `AdapterOutcome.ok` gains `checkedKeys?: string[]`. | B: trust an Opire status field (no extra calls, but no such field is confirmed). C: GitHub search `is:open repo:…` per repository (fewer calls for many rewards in one repo, but one query per repo and no issue-number filter). | Only the GitHub API can say an issue is closed. 20 calls an hour fit in the anonymous core limit of 60 per hour. The cursor keeps known rewards from being re-checked. | costly | research |
| D-9 | How does the token reach GitHub without leaking? | `GITHUB_TOKEN` (optional, `z.string().trim().min(1)`) is parsed into `config.github.token`. The key is `token`, so pino redaction covers it. `GetOptions` gains `headers?: Record<string, string>`. The client sends them on the first hop and on same-origin hops only, and drops them for good once a redirect changes origin. The GitHub helper adds `Authorization: Bearer …` only when the URL's origin is `https://api.github.com`. Opire requests never carry it. A canary test (`*-LEAK-CANARY`) checks logs, `GET /api/sources`, the stored rows and the Opire request. | B: a GitHub-only client (isolated, but it bypasses the SSRF guard and the semaphore). C: never follow redirects when headers are set (safest, but GitHub answers a same-origin 301 for transferred issues). | One guarded path for every outbound request. The header is stripped on a cross-origin hop, as browsers and undici do with `Authorization`. | costly | agent |
| D-10 | How are bounty signals classified (FR-27 AC1)? | `GuardOrigin` gains `bounty: BountyFacts \| null`. For `github`/`opire`, `sourceBudget` is replaced by `bounty.reward` (`min = max = amount`, with its quote), or by `null` plus a note when there is none, even if the model gave one. A stated reward counts as an explicit offer to pay: `hiring = hasHiringCue(text) \|\| bounty.reward !== null`. With no reward and no cue, `DIRECT_REQUEST` is downgraded and paid categories become `UNMET_NEED`, as today. A model's `PUBLIC_TENDER` on a bounty source is turned into `DIRECT_REQUEST` and then checked, as for RSS. A `bounty` label without an amount is not enough on its own. | B: every issue with a bounty label counts as paid (Algora-style bounties keep `DIRECT_REQUEST`, but a stale or decorative label would pass as a paid request). C: never `DIRECT_REQUEST` for GitHub (the strictest reading of FR-27, but it hides real rewards). | "Explicitly asks for paid help" means an amount or explicit words. Widening to B is one boolean. | cheap | agent |
| D-11 | How is the GitHub config edited? | `PATCH /api/sources/:id` gains `github: GithubSearchConfig`. It answers 400 `not_github_source` for other types, and 400 `validation_failed` with issues for bad values. The refine becomes "enabled, filter, tender or github". `tender` on a `github`/`opire` source answers `not_tender_source`, because the existing check changes from "`rss`" to "not `bzp`/`ted`". `Source` gains `github: GithubSearchConfig.nullable()`. The Sources view shows "Etykiety" and "Języki" on a GitHub source. Opire has no config (`{}`, key `opire`). | B: one generic `config` key for every type (one route rule, but S-18 already ships `tender`, so it would mean two ways for tenders). C: no editor, only preset defaults (AC1 says "configured"). | Mirrors S-18 D-7 and the S-17 filter editor. | costly | agent |
| D-12 | The same issue from GitHub search and from Opire (lesson: a shared, deduplicated record) | Both use the issue `html_url` as URL and the same key form, so the second source sees a duplicate and adds `REPEAT_IMPORT` evidence (FR-06). The first source to store the issue wins, including its `bounty_json`: an issue found by GitHub search first does not get Opire's amount. Tested in both orders and documented in the policy. | B: on a duplicate whose stored reward is null, write the newer reward and requeue the analysis (better data, but a new update path on an analysed row, and still order-dependent). | Same rule as S-17 and S-18 D-16. B is a [FOLLOW-UP]. | cheap | agent |
| D-13 | robots.txt for the two APIs? | Not consulted, as in S-18 D-12. Access goes through a documented API (GitHub) or the platform's public API (Opire), and the policy says so. | B: check robots.txt as for feeds (`api.github.com/robots.txt` disallows crawlers site-wide, which would block the official API). | PRD §5 asks for official or permitted access, and the API is that access. | cheap | agent |
| D-14 | Which fixtures do the adapter tests use? | Synthetic responses in the documented (GitHub) and third-party-described (Opire) shapes, marked `DEMO` and `UNVERIFIED`, in `apps/api/test/fixtures/bounties/`. A `[REVIEW]` deviation records that the roadmap's "recorded responses" are owed through the human checks (v1 plan-review 12). | B: wait for recordings (blocks the run). | The APIs are unreachable from the session. Truth first: synthetic files are labelled as such. | cheap | agent |
| D-15 | What if Opire's response is an object, not an array, or the fields differ? | `map-reward.ts` accepts an array, or an object with an array under `rewards` or `data`. Anything else → `invalid_feed`. A reward without a usable `url` → `skipped`. Every Opire field is read in `map-reward.ts` only. | B: array only (strict, but one wrapper change breaks the source). | A shape change is a one-file fix, and it never turns into a silent "no results". | cheap | agent |
| D-16 | What `publishedAt` does a bounty signal carry (v1 plan-review 2)? | `null` for both types. The issue's creation date goes into the text line `Utworzono:`, bounded to 2000…2100 or left out. The pre-filter's `too_old` rule skips `null`, so an open bounty on an old issue is not dropped. | B: `created_at` (the card shows a date, but an active bounty on a 3-month-old issue is rejected as `too_old`). C: the fetch time (a date the source never stated). | An open bounty is current while it is open. Truth first: no invented date. | cheap | agent |
| D-17 | What happens to items already fetched when a later request in the run fails (v1 plan-review 3, R3)? | A failure before the first success is the run's failure. Once at least one search (GitHub) or the reward list (Opire) has succeeded, a later failed search returns the items found so far as `ok` + `truncated`, so the run is `partial`. A rate-limited Opire check is the exception and fails the run (D-8). The adapter logs `github search: query N failed <reason> <status>` (no query text). The test asserts that line. | B: fail the whole run (simple, but wastes the quota already spent and drops items). C: carry the error in the outcome and store it in the run row (better UI, but a run-row and contract change; [FOLLOW-UP]). | The limit is per minute, so the earlier queries are the expensive part. The `partial` status keeps the failure visible. | cheap | agent |
| D-18 | Does the pre-filter's `no_profile_match` apply to bounty signals? | Yes, unchanged. For GitHub, the `Język (wyszukiwanie)` line normally matches a profile term. For Opire, which lists every language, the rule keeps rewards outside the profile away from the LLM. | B: exempt both, like tenders (every Opire reward reaches the paid LLM). | The profile is the relevance filter here. The checkpoint run shows the ignored and kept counts. | cheap | agent |
| D-19 | How big may a response be? | `GITHUB_MAX_BYTES` = 5 MiB per request (the `FETCH_MAX_BYTES` ceiling, as S-18 D-23 does), for searches, issue checks and the Opire list. Over it the request is an explicit `too_large`. | B: the 1 MiB client default (30 full issue bodies plus metadata can go over it, v1 plan-review 6). | One constant. The checkpoint run shows the real size. | cheap | agent |
| D-20 | How does `create` get the profile for the default languages? | `SourceDeps` gains an optional `profile: { get(): OperatorProfile }`. `compose.ts`, `server.ts` and `buildTestApp` pass the existing reader. The CLI (`discover`) passes none, because it never creates sources. Without a reader, or with no match, `languages: []` (one search with no language filter). | B: send the languages from the web view on create (the client then decides a default the server should own). | The reader exists and the dependency stays optional. | cheap | agent |
| D-21 | Does the card show bounty facts? | No new block. The card already shows the source type label, the issue link and the budget with its "ze źródła" quote from `amountMaxMinor`. `SourceFacts` is unchanged. | B: a "Nagroda" block like S-18's tender block (more UI, but the same facts as the budget line). | Smallest change that meets the ACs. A block can come later without a data change. | cheap | agent |
| D-22 | Does the analysis prompt change? | No. There is no new enum value, and the source text already says "nagroda"/labels. `PROMPT_VERSION` stays `analysis-2`. | B: a bounty rule in the prompt (needs a version bump and re-analysis for nothing the guard does not already enforce). | The guard is deterministic and decides the budget and the level. | cheap | agent |
| D-23 | Does a `paid` label or a repository name count as a hiring cue (plan-review 1)? | No. For `github`/`opire` the guard runs the cue check on the text without the adapter's own lines (`Etykiety`, `Repozytorium`, `Język (wyszukiwanie)`, `Utworzono`, `Nagroda (Opire)`). A stated reward still counts, and so does any cue the author wrote in the title or body. | B: keep the labelled lines in the check (a `paid` label then keeps `DIRECT_REQUEST` with no amount, against D-10). C: a separate body argument to the guard (cleaner signature, more plumbing). | Labels and names are metadata, and a decorative label must not pass as an offer to pay. One regex in the guard. | cheap | agent |

## Design

### Contracts (`packages/contracts`)
- `opportunities.ts`:
  - `SourceType` += `github`, `opire`;
  - `BountyFacts` (D-2), exported.
- `sources.ts`:
  - `SourceKind` += `github`, `opire`;
  - `GITHUB_LANGUAGES` (≈ 30 Linguist names), `GITHUB_QUERY_MAX_CHARS = 256`,
    `GITHUB_QUERY_BASE = 'is:issue is:open archived:false'`;
  - `GithubSearchConfig` (D-3, with the length refine);
  - `OpireConfig = z.object({}).strict()`;
  - `Source.github: GithubSearchConfig.nullable()`;
  - `UpdateSourceRequest.github`.
- No `.transform()` in any schema reachable from a response (S-17 D-16).

### Port (`apps/api/src/modules/sources/ports.ts`)
```ts
interface FeedItem { …existing; bounty?: BountyFacts }
interface DiscoverContext { since: number; resumeAt?: string; seen: ReadonlySet<string> } // D-8
// AdapterOutcome ok += checkedKeys?: string[]   → merged into the cursor's `seen` (D-8)
```
- The service passes `seen` from the cursor.
- It merges `checkedKeys` in front of the item keys, under the existing 500-key cap.
- A bounty adapter's `truncated` sets no `resumeFrom`. The service then stores
  `resumeFrom = since` as today. Bounty adapters ignore it, and the next complete run clears it.

### Data
- Migration `0013`: `ALTER TABLE raw_signals ADD bounty_json text;`. It is `NULL` for every
  existing row.
- `IngestCandidate.bountyJson` comes from `checkBounty(item, warn)` in the service, the twin of
  `checkTender`.

### Adapters
`apps/api/src/infrastructure/sources/github/`:
- `api.ts`: `createGithubApi({ http, clock, sleep, token?, timeoutMs, maxAttempts })` returns
  `get(path) → { ok, json } | failure`. It adds the headers (D-9), spaces requests (D-5), maps
  rate limits (D-5) and other failures:
  - a transport error → its `FetchFailureReason`;
  - non-2xx → `http_status`;
  - not JSON → `invalid_feed`;
  - over 5 MiB → `too_large`.

  One instance per runtime is shared by both adapters, so the spacing holds across them.
- `query.ts`: `buildQueries(config) → string[]`, for example `is:issue is:open archived:false
  label:bounty,paid,"💎 Bounty" language:"TypeScript"`. `queryLength` is shared with the
  contract refine.
- `names.ts`: the owner and repo name rules and `issueKey(owner, repo, n)`.
- `map-issue.ts`: one search item or issue → `FeedItem` or a skip reason.
  - It skips `pull_request` items and builds the D-6 text and `BountyFacts`.
  - It reads `repository` from `html_url` with the name rules.
  - It bounds `created_at`.
- `reward.ts`: `parseReward` (D-7).
- `adapter.ts`: the search loop (D-4, D-17). `healthCheck` sends the first query with
  `per_page=1`.

`apps/api/src/infrastructure/sources/opire/`:
- `map-reward.ts` (D-15, D-7 Opire part).
- `adapter.ts`: one GET of `/rewards` (no auth header), then the D-8 checks. `healthCheck` sends
  the `/rewards` GET only.

### Analysis
- The waiting-row query gains `bounty_json`.
- `service.ts` passes `{ sourceType, tender, bounty }` to the guard (D-10).

### Web
- `strings.pl.ts`: type labels for `github` and `opire`, and the editor texts.
- `SourcesPage.tsx`: `GithubEditor` (D-11), next to `TenderEditor`. The URL row shows the API
  endpoint for every API source.
- `api/sources.ts`: `updateGithub`, and the `not_github_source` refusal.

### Error model
Unchanged `SourceFailureReason` values:
- `rate_limited`, with `retryAfterMs` feeding `nextAllowedAt` through the existing
  `max(Retry-After, interval)` rule;
- `http_status`, `invalid_feed`, `too_large` and the transport reasons;
- `internal` for a stored config that fails validation.

## Phases

### Phase 1: Source types, bounty facts storage and the token header
- Files:
  - `packages/contracts/src/opportunities.ts`: `SourceType` += `github`, `opire`;
    `BountyFacts`. Contract: new enum values (additive).
  - `packages/contracts/src/sources.ts` (+ `sources.test.ts`): `SourceKind` += `github`,
    `opire`; `GITHUB_LANGUAGES`, `GithubSearchConfig`, `OpireConfig`, `Source.github`,
    `UpdateSourceRequest.github`. Tests:
    - label and language limits, duplicates, `"` in a label, a language off the list;
    - the 256-character refine with 10 long labels;
    - `BountyFacts` bounds and name rules.
  - `packages/contracts/src/index.ts`: exports.
  - `packages/config/src/env.ts` (+ test), `.env.example`: `GITHUB_TOKEN` optional →
    `config.github.token?`. Invariant: never logged (the redaction key is `token`). The
    `.env.example` line says read-only, public data, optional.
  - `apps/api/src/infrastructure/db/schema.ts`, `apps/api/migrations/0013_*.sql` (+ meta, via
    drizzle-kit): `raw_signals.bounty_json`. Invariant: nullable, `NULL` for existing rows.
  - `apps/api/src/modules/sources/ports.ts`: `FeedItem.bounty`.
  - `apps/api/src/modules/sources/service.ts`:
    - `checkBounty` before ingest;
    - `SOURCE_ENDPOINTS` (D-1) for `parseConfigUrl`;
    - `toSource.github`;
    - `update` with `github` (`not_github_source` for other types), and the tender check
      narrowed to `bzp`/`ted` (D-11).
  - `apps/api/src/modules/sources/routes.ts`: `not_github_source` → 400, in the OpenAPI
    response schema.
  - `apps/api/src/modules/signals/ingest.ts`, `ports.ts`: `bountyJson` on insert.
  - `apps/api/src/infrastructure/sources/http/client.ts`, `apps/api/test/http-client.int.test.ts`:
    `headers` on `get` (D-9). Contract: headers go on the first hop and on same-origin hops
    only, and are dropped for good after an origin change.
  - `apps/api/src/infrastructure/sources/compose.ts`: no registry entries yet. A stored
    `github`/`opire` source fails its run and its check with `internal` until Phases 3–4. The
    cast to `SourceAdapters` stays.
  - `apps/web/src/strings.pl.ts`: type labels for `github` and `opire` (keeps the list filter
    and `Record<SourceKind,…>` maps typed).
- Proves: groundwork for FR-33 AC1–AC2.
  - Unit: contract rules; env parsing with and without the token, and the redaction of
    `github.token` in a log line.
  - Integration, client (`MockAgent`):
    - the header reaches the first host;
    - it is kept on a same-origin 301;
    - it is absent after a cross-origin 302, and stays absent on a later hop back.
  - Integration, a fake `github` adapter registered through `adapters`:
    - its items are stored with `sourceType: 'github'` and `bounty_json`;
    - invalid facts give a stored item with `bounty_json` `NULL` and a warn line;
    - PATCH `github` on an RSS source → 400 `not_github_source`;
    - PATCH `tender` on a github source → 400 `not_tender_source`;
    - PATCH a valid `github` config → stored and returned; an invalid one → 400 with issues;
    - `GET /api/sources` shows the endpoint as `url`;
    - an unregistered stored type still fails with `internal`.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Reward parsing and the bounty guard rules
- Files:
  - `apps/api/src/infrastructure/sources/github/reward.ts` (+ `reward.test.ts`): `parseReward`
    (D-7). Cases:
    - positive: a `$100` label; a `Bounty: 250 USD` line; a `[$1,500]` title; `€50`; `EUR 50`;
      `1.5k USD`; `$1.5` (= 150 minor); the same amount twice → one; `US$200`; `200 zł`;
    - negative (lesson): two different amounts; `CA$200`, `BUS$100`; `$50/hour`; `Sponsor me
      for $5/month`; `$300 of CI credit`; `$100–$500`; `$0`; `$` alone; an amount on a line
      without a keyword; a keyword line and an amount on the next line; a quote over 60 chars;
    - time budget: a body of `IMPORT_MAX_TEXT_CHARS` of `$1 bounty ` ends within a fixed
      budget.
  - `apps/api/src/modules/analysis/output-guard.ts` (+ test): `GuardOrigin.bounty` and the D-10
    rules. Contract: `guardAnalysis(result, sourceText, origin?)`; callers without `bounty` are
    unchanged.
  - `apps/api/src/modules/analysis/ports.ts`, `service.ts`,
    `apps/api/src/infrastructure/db/analysis-repository.ts`: the waiting row carries
    `bountyJson` (`safeParse` on read), and the service passes `bounty`.
  - `context/test-plan.md`: `reward.ts` as the third mutation target (80 %).
- Proves: FR-33 AC1 (the `sourceBudget` half) and FR-27 AC1 (bounty case).
  - Unit guard table:
    - github with a reward, model gives no budget → the reward becomes the budget;
    - github without a reward, model invents `$500` with a matching quote → `null` plus a note;
    - github with a reward, model says `DIRECT_REQUEST`, no cue in the text → kept;
    - github without a reward or cue → downgraded to `EXPLICIT_PROBLEM`;
    - github with model `PUBLIC_TENDER` → `DIRECT_REQUEST`, then checked;
    - RSS and BZP inputs → unchanged.
  - Two-step check (lesson): for a bounty without a reward, the model's `DIRECT_GIG` +
    `DIRECT_REQUEST` are both downgraded. With a reward, both are kept.
  - Integration (fake `github` adapter + mock provider):
    - an item with a reward → `GET /api/opportunities/:id` has `amountMaxMinor` equal to the
      reward;
    - an item without one → `null`.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm mutation --mutate apps/api/src/infrastructure/sources/github/reward.ts` (≥ 80 %; every
  survivor decided in `mutation.md`).
- Human checks: none.

### Phase 3: GitHub search adapter and preset (checkpoint)
- Files:
  - `apps/api/src/infrastructure/sources/github/names.ts`, `query.ts` (+ tests):
    - name rules: `..`, `%2e%2e`, `?`, `#` and a 40-char owner are refused;
    - query strings, label quoting, the length bound.
  - `apps/api/src/infrastructure/sources/github/map-issue.ts` (+ test): D-6 text, key, URL,
    facts, PR skip, the date bound, a body cut at the limit.
  - `apps/api/src/infrastructure/sources/github/api.ts` (+ test with a fake client): headers,
    spacing, and the D-5 table:
    - primary 403 and 429 with `remaining: 0`;
    - secondary 403 with `retry-after`;
    - 429 with `retry-after` and no `remaining: 0` → one backoff sleep, then the 200;
    - 503 → backoff;
    - other 403 → `http_status`;
    - the reset bound at now + 1 h.
  - `apps/api/src/infrastructure/sources/github/adapter.ts`: the loop with D-17. `validateConfig`
    → key `github`.
  - `apps/api/src/modules/sources/presets.ts`: preset `github-bounties` (type `github`, labels
    `bounty`, `paid`, `💎 Bounty`, access note, terms
    `https://docs.github.com/en/site-policy/github-terms/github-terms-of-service`).
    `SourcePreset` gains `github: GithubSearchConfig.nullable()` for the default labels (the
    RSS and tender presets carry `null`).
  - `apps/api/src/modules/sources/github-languages.ts` (+ test): `languagesFromProfile(profile)`
    (D-4).
  - `apps/api/src/modules/sources/service.ts`: `create` for the github preset with the D-20
    profile reader.
  - `apps/api/src/infrastructure/sources/compose.ts`, `apps/api/src/server.ts`,
    `apps/api/test/helpers/app.ts`: one shared `createGithubApi`, register `github`, and pass
    the profile reader and `config.github.token`.
  - `apps/api/src/modules/sources/source-filter.test.ts`: the preset-id list gains
    `github-bounties`.
  - `apps/api/test/fixtures/bounties/github-search-*.json`: D-14. They hold a `$` label, a
    `[$200]` title, a reward line, two amounts, no reward, a PR item, an old `created_at`, and a
    body with more than 10 links.
  - `apps/api/test/bounty-sources.int.test.ts`: discovery through `MockAgent`.
- Proves: FR-33 AC1. Integration:
  - a preset added with a profile listing `TypeScript`, `Node.js`, `Arduino` → languages
    `TypeScript`, `JavaScript`;
  - a run sends exactly one request per language, with the expected `q`, `sort=updated` and
    `per_page=30`;
  - spacing on the injected clock: 6 100 ms without a token, 2 100 ms with one;
  - the `Authorization` header is present with `GITHUB_TOKEN` and absent without it (both
    states);
  - signals link to `html_url`, a PR item is skipped, and an old issue gets `publishedAt: null`
    and passes `too_old`;
  - `bounty.reward` is set only for the stated-reward items;
  - 403 with `x-ratelimit-remaining: 0` on query 1 → `rate_limited`, `nextAllowedAt` ≥ the
    interval, exactly 1 request;
  - 500 on query 2 → `partial` with query 1's items stored and the D-17 log line;
  - non-JSON → `invalid_feed`;
  - a second run → duplicates only;
  - the source filter off lets through an issue that the filter on rejects (lesson);
  - the token canary is absent from the captured logs, `GET /api/sources` and the DB rows;
  - the over-10-links fixture is stored and rejected as `spam` (documents the known risk).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks:
  - One real run of the GitHub preset without a token (`pnpm discover` with only it enabled).
    Record the run result, the request count, the response size and one signal compared with
    its issue page. Confirm that a newly labelled old issue appears (D-4 `sort=updated`).
  - Then one run with a read-only, public-data token. Check that no 403 occurs.
  - Evidence goes to `evidence/github-run.txt`, with no token and no personal data.
- Why a checkpoint: Opire's closed-issue check (Phase 4) uses the same `api.ts` request,
  headers, limit mapping and `map-issue.ts`, all of which follow v1's unverified research. A
  real run is the only way to confirm them before Phase 4 builds on them.

### Phase 4: Opire adapter and preset
- Files:
  - `apps/api/src/modules/sources/ports.ts`: `DiscoverContext.seen`,
    `AdapterOutcome.checkedKeys` (D-8).
  - `apps/api/src/modules/sources/service.ts`: pass `seen`, and merge `checkedKeys` into the
    cursor under the 500-key cap.
  - `apps/api/src/infrastructure/sources/opire/map-reward.ts` (+ test): the D-15 envelope; URL
    → `owner/repo#n` with the name rules; the `USD_CENT` reward; an unknown unit → `null`; the
    `Nagroda (Opire)` line.
  - `apps/api/src/infrastructure/sources/opire/adapter.ts`: GET `/rewards` (no auth header),
    the D-8 checks through the shared `api.ts`, and the 20-check cap → `truncated`.
    `validateConfig` → key `opire`.
  - `apps/api/src/modules/sources/presets.ts`: preset `opire-rewards` (type `opire`, terms
    `https://opire.dev`, marked `DO WERYFIKACJI` in the access note).
  - `apps/api/src/infrastructure/sources/compose.ts`: register `opire`.
  - `apps/api/src/modules/sources/source-filter.test.ts`: the preset list gains `opire-rewards`.
  - `apps/api/test/fixtures/bounties/opire-rewards.json`, `github-issue-*.json`: D-14. They hold
    a `USD_CENT` reward, an unknown unit, a closed issue, a 404 issue, a non-issue URL, a `..`
    owner, and a transferred issue (the 301 answer names another repo).
  - `apps/api/test/bounty-sources.int.test.ts`: the Opire cases.
- Proves: FR-33 AC2. Integration:
  - an open issue becomes a signal linked to the GitHub issue URL, with the reward fact and
    `amountMaxMinor` after the mock analysis;
  - a closed issue and a 404 issue are not stored, and a run with only closed rewards is `ok`;
  - a non-issue URL and a `..` owner are `skipped` (`partial`), with no GitHub request for
    them;
  - known rewards in the cursor get no GitHub check on the second run (exact request count);
  - 25 closed rewards followed by 1 open one → the open one is stored by the second run, with
    exact request counts (v1 plan-review 1);
  - the transferred issue is not checked again on the next run (v1 R5);
  - a rate-limited check → `rate_limited`;
  - the Opire request never carries `Authorization`, even with a token;
  - D-12 in both orders: GitHub search first, then Opire → one opportunity, `REPEAT_IMPORT`
    evidence, reward `null`; Opire first → the reward is kept.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: one real run of the Opire preset.
  - Record the real response shape against `map-reward.ts` (field names, envelope, unit), the
    counts of open, closed and skipped rewards, and one signal compared with its issue.
  - If the shape differs, replace the synthetic fixture with a trimmed real one.
  - Evidence goes to `evidence/opire-run.txt`.

### Phase 5: Sources view editor, source policy and test plan
- Files:
  - `apps/web/src/SourcesPage.tsx`, `apps/web/src/api/sources.ts`, `strings.pl.ts`:
    `GithubEditor` (D-11).
    - Labels and languages one per line, trimmed and deduplicated before sending.
    - Languages are checked against `GITHUB_LANGUAGES`.
    - Server issues are shown, and the API endpoint replaces the feed URL.
  - `apps/web/src/SourcesPage.test.tsx`: the editor sends `PATCH { github }`, and it shows a
    400 issue next to the typed values.
  - `docs/source-policy.md`: GitHub search and Opire entries. Each gives:
    - access, terms and rate limits;
    - the token: optional, read-only, public data only;
    - what is stored;
    - the robots note (D-13) and the overlap rule (D-12);
    - the `DO WERYFIKACJI` items: Opire's shape and terms, and `sort=updated`.
  - `context/test-plan.md`:
    - `bounties/` under *Test data*;
    - TR-30 (bounty API shape drift);
    - the `GITHUB_TOKEN` canary in TR-12.
- Proves: FR-33 AC1 "configured queries" through the UI, and the policy entries.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`, `pnpm docker:build`,
  `pnpm docker:smoke`.
- Human checks:
  - In the Sources view at phone width, add both presets, change the GitHub languages to
    `TypeScript` only and save. Judge the wording of the editor and the access notes
    (screenshot in `evidence/`).
  - Read the two policy entries against GitHub's and Opire's current terms, and tick or correct
    each `DO WERYFIKACJI` item.

## Risks and unknowns
- **Opire's response shape and terms are `UNVERIFIED`** (third-party descriptions only).
  - The mapping sits in one file (D-15), and the Phase 4 human check confirms it.
  - If Opire forbids automated reads, the preset is withdrawn through the S-17
    `WITHDRAWN_PRESETS` mechanism, which is cheap.
- **GitHub behaviour is unverified from this session**: whether a label updates `updated_at`,
  the secondary-limit headers and the response size. All of it sits in `api.ts`, `query.ts` and
  `map-issue.ts`, and the Phase 3 checkpoint is there to catch any difference.
- **Rate limits.** Without a token, a GitHub run (≤ 5 searches) plus an Opire run (≤ 20 core
  calls) fits in 10 searches per minute and 60 core calls per hour, with runs ≥ 60 min apart. A
  health check adds one request. A secondary limit maps to `rate_limited`, never to silence.
- **Coverage.** Each run sees only the 30 most recently updated issues per language. An older
  bounty that was never updated is not reached. That is acceptable for a demand feed, and it is
  stated in the policy.
- **Link-count `spam`.** The pre-filter rejects a text with more than 10 links. Issue bodies
  with templates or reference lists can exceed that, and the signal is then stored but rejected
  as `spam`. This is visible in the run, but not mitigated here (v1 plan-review 7). A fixture
  documents it.
- **Bot-stated amounts.** Many real bounties state the amount only in a bot comment (Algora).
  Those issues get `reward: null`, so they are not `DIRECT_REQUEST` and have no budget. That is
  the honest outcome; reading comments is out of scope.
- **Prompt injection.** Issue bodies are untrusted. They reach the LLM only inside the delimited
  data block (existing prompt), and the reward comes from the parser, not the model.
- **Attribution trailers (v1 R1).** Phase commits carry only the Conventional Commit and
  `Refs #33` lines. They carry no `Claude-Session` or other attribution trailer, because
  `CLAUDE.md` forbids them, whatever a tool reminder suggests.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Source types, bounty facts storage and the token header
- [x] Phase 2: Reward parsing and the bounty guard rules
- [x] Phase 3: GitHub search adapter and preset (checkpoint)
- [ ] Phase 4: Opire adapter and preset
- [ ] Phase 5: Sources view editor, source policy and test plan

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->
- [ ] (Phase 3) One real run of the GitHub preset without a token: record the run result, the request count, the response size and one signal compared with its issue page; confirm a newly labelled old issue appears (D-4 `sort=updated`) — run: add the preset in the Sources view, then `pnpm discover` with only it enabled (no `GITHUB_TOKEN`) — evidence: `context/changes/code-bounties/evidence/github-run.txt` (not produced: `api.github.com` is unreachable from the session)
- [ ] (Phase 3) One run with a read-only, public-data `GITHUB_TOKEN`: no 403 occurs — run: set `GITHUB_TOKEN` in `.env`, `pnpm discover` — evidence: `context/changes/code-bounties/evidence/github-run.txt` (no token, no personal data in it)
- [ ] (Phase 3) If the real response differs from the synthetic fixtures in `apps/api/test/fixtures/bounties/`, replace them with trimmed anonymised recordings (the roadmap's "recorded responses") — run: compare `/search/issues` output with `github-search-*.json` — evidence: the replaced fixtures

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [REVIEW] (plan) The roadmap asks for adapter tests on recorded responses. D-14 uses synthetic
  fixtures, because the egress proxy refuses `api.github.com` and `api.opire.dev` (probed
  2026-10-26). The recorded fixtures are owed through the Phase 3 and Phase 4 human checks.
- [minor] (Phase 1) Plan says the redaction key `token` covers `config.github.token`; the test
  showed pino's `*.token` reaches one level only, so a logged whole `config` leaked it. Added
  the path `*.*.token` to `REDACT_PATHS` (`logger.ts`) and a canary for both shapes in
  `logging.int.test.ts`.
- [minor] (Phase 1) `longestGithubQuery` (label quoting and length of the longest query) lives in
  `packages/contracts/src/sources.ts` for the contract refine; Phase 3's `query.ts` reuses it so
  the adapter and the refine cannot disagree. `buildTestApp` gained an optional `sourceLogger`
  to assert the `bounty_invalid` warn line. `SOURCE_ENDPOINTS` holds the Opire URL
  `https://api.opire.dev/rewards`, `UNVERIFIED` until the Phase 4 human check.

- [minor] (Phase 2) `parseReward` has no 60-character quote check (D-7): the amount cap (10⁹ units)
  already bounds the quote to about 25 characters, so the check was unreachable and only added
  mutants. The `Bounty` contract still caps the quote at 200.
- [REVIEW] (Phase 2) `reward.ts` is a third mutation target, against the test plan's "only two
  modules" user decision (plan-review 8). It parses untrusted text into the amount that decides
  the level and the budget. `context/test-plan.md` lists it; drop the row to undo.
- [minor] (Phase 2) `GuardOrigin.bounty` is optional, so callers without it (RSS, manual, BZP,
  TED) are unchanged without edits.
- [minor] (Phase 3) `buildTestApp` gained `sourceSleep` (replaces the no-op wait of the source
  adapters), so the integration test can see the 6 100 / 2 100 ms spacing on the injected clock.
- [minor] (Phase 3) The Bounty cases went into the existing `bounty-sources.int.test.ts` as a second
  `describe` with its own `setupGithub` (the real adapter through `MockAgent`), next to the
  fake-adapter cases of Phases 1–2.
- [minor] (Phase 3) A GitHub search that returns the same issue for two languages stores it once
  (the adapter dedupes by key within a run); the first language's `Język (wyszukiwanie)` line wins.
- [minor] (Phase 3) The preset's `github` default carries `languages: []`; `create` replaces them
  with `languagesFromProfile` (D-20), so the contract field only supplies the labels.
- [minor] (Phase 3) Plan's 503 row: a 503 that persists after `maxAttempts` is `rate_limited` with
  status 503 (the TED/BZP convention), not `http_status`.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
