# Review: rss-sources

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (629), image not run (no Docker daemon in the sandbox: `Cannot connect to the Docker daemon`), e2e ok (5), mutation n/a (S-10 is not a mutation target) · Round: 2

Round 2 re-checks the fixes for R1–R5 (commits 026e922, 5170138, 5dea73e, 7db1bfc):
- R1 fixed: `parseDate` returns `null` outside 1970..9999-12-31; parser test covers year 12026 and 1900.
- R2 fixed: `recordFailure` caps the stored wait at `MAX_SOURCE_BACKOFF_MS` (7 days); integration case (e) asserts the capped `nextAllowedAt` and `GET /api/sources` 200.
- R3 fixed for `EMAIL` (bounded quantifiers, 1 MiB single token now ~1 ms); the same file still has two quadratic patterns, see R6.
- R4 fixed: the recorder refuses while `next_allowed_at` is pending and prints `HttpFetchError.reason`.
- R5 fixed: `.env.example` describes the run interval and the check cooldown correctly.

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `apps/api/package.json`, `pnpm-lock.yaml` | done | `fast-xml-parser@5.11.2`; `fixtures:record` script (deviation, Phase 5) |
| `package.json` | done | root `fixtures:record` delegates to the API (logged deviation) |
| `apps/api/src/infrastructure/sources/rss/parse-feed.ts` | done | D-12, D-13; linear on 1 MiB adversarial input (checked: nested tags, `<p` floods, entities, 60k attributes all < 400 ms) |
| `apps/api/src/infrastructure/sources/rss/parse-feed.test.ts` | done | |
| `apps/api/src/infrastructure/sources/rss/retry.ts` | done | |
| `apps/api/src/infrastructure/sources/rss/retry.test.ts` | absent | dropped, logged (plan-review #5) |
| `apps/api/src/infrastructure/sources/rss/fetch-feed.ts` | absent | fetch loop lives in `adapter.ts`; not logged, harmless |
| `apps/api/src/infrastructure/sources/rss/adapter.ts` | done | |
| `apps/api/src/infrastructure/sources/rss/anonymise-feed.ts` | unplanned | logged (Phase 5); see R3 |
| `apps/api/src/infrastructure/sources/compose.ts` | unplanned | logged (Phase 3) |
| `apps/api/src/modules/sources/{ports,presets,service,routes}.ts` | done | |
| `apps/api/test/fixtures/feeds/synthetic-*.xml` | done | marked DEMO |
| `packages/contracts/src/{sources,index,opportunities}.ts` | done | D-10, D-19 |
| `apps/api/src/infrastructure/db/schema.ts`, `migrations/0007_*`, snapshot, journal | done | D-1, D-2; additive, nullable |
| `apps/api/src/modules/signals/{ingest,service,ports}.ts` | done | D-4; manual import unchanged |
| `apps/api/src/infrastructure/db/opportunity-repository.ts`, `modules/opportunities/{ports,service}.ts` | done | left join of `sources.name` |
| `apps/web/src/OpportunitiesPage.tsx`, `strings.pl.ts` | done | |
| `apps/web/src/opportunityCard.ts`, `opportunityCard.test.ts` | done | `OpportunityPage.tsx` unchanged (logged) |
| `apps/api/src/infrastructure/db/source-repository.ts` | done | atomic `claimRun` / `claimCheck` |
| `apps/api/src/infrastructure/db/source-status-reader.ts` | done | |
| `apps/api/src/infrastructure/sources/source-status.ts` | done | deleted as planned |
| `packages/config/src/{env,env.test}.ts`, `.env.example` | done | see R5 for the comment |
| `apps/api/src/{app,server}.ts`, `apps/api/test/helpers/app.ts` | done | |
| `apps/api/src/cli/discover.ts` | done | D-16 |
| `apps/api/test/sources.int.test.ts` | done | cases (a)–(f) |
| `apps/web/src/{SourcesPage.tsx,SourcesPage.module.css,api/sources.ts,App.tsx}` | done | |
| `scripts/fixtures-record.ts` | absent | moved to `apps/api/src/cli/fixtures-record.ts` (logged); see R4 |
| `docs/source-policy.md`, `README.md`, `CLAUDE.md`, `context/test-plan.md` | done | |
| `context/roadmap.md` | done | status |
| `context/changes/rss-sources/evidence/anonymise-sample.txt` | done | |
| `apps/api/src/infrastructure/sources/rss/anonymise-feed.test.ts` | unplanned | added by the R3 fix; covers e-mail and a 1 MiB single-token body |
| `context/lessons.md` | unplanned | lesson proposed from R1/R2 |

## Areas
| Area | Result (ok / concern / fail) | One-line reason |
|------|------------------------------|-----------------|
| Correctness | ok | R1/R2 fixed and covered by tests; no out-of-range source date reaches stored state |
| Design | ok | Port/adapter split, one wiring point (`compose.ts`), shared `ingest`; backoff cap in one place |
| Safety | concern | Anonymiser still quadratic on untrusted feed bodies through `PHONE` and `PERSON_TAG` (R6) |
| Tests | ok | Fixes come with parser, integration and anonymiser cases |
| Simplicity | ok | Readable, small functions; no dead code found |
| Plan fidelity | concern | The 7-day backoff cap is not in `docs/source-policy.md` (R7) |
| Agent decisions | ok | D-1/D-2/D-4 live in schema + repository, D-10/D-19 in `packages/contracts`; D-21 [REVIEW] deviation has its Decisions row |

## Findings
### R1: A far-future `pubDate` in one feed entry breaks the opportunity list
- Severity: blocker
- Where: `apps/api/src/infrastructure/sources/rss/parse-feed.ts:136`
- Problem: `parseDate` keeps any value `Date.parse` accepts. `Date.parse('Sat, 01 Jan 12026 00:00:00 GMT')` is `317336745600000`; it is stored as `raw_signals.published_at`, and on read `toISOString()` gives `+012026-01-01T00:00:00.000Z`, which `SourceFacts.publishedAt` (`z.iso.datetime()`) rejects. Reproduced with a temporary integration test: run → `200 ok, new 1`, then `GET /api/opportunities` → `500 FST_ERR_RESPONSE_SERIALIZATION`. One malformed or hostile entry takes down the whole *Okazje* list (and the card) for good. This breaks the lesson "Validate every value against its contract schema before storing it".
- Fix: in `parseDate`, return `null` (date unknown) for anything outside a sane range: not before 1970 and not later than the fetch time plus a small margin (e.g. 1 day; pass `now` in, or bound to year 9999 at minimum). Add one parser case with a year-12026 date and one integration assertion that the list still answers 200.
- Effort: small
- Lesson candidate: Bound every date or time that comes from a source to the range the contract can serialise before storing it.
- Decision: fixed (026e922) + lesson proposed

### R2: A far-future `Retry-After` date makes the Sources view and the run answer 500
- Severity: blocker
- Where: `apps/api/src/infrastructure/sources/rss/retry.ts:10-12`, `apps/api/src/modules/sources/service.ts:144`
- Problem: `parseRetryAfter` turns any HTTP-date into a wait with no upper bound, and `recordFailure` stores `next_allowed_at = at + max(retryAfter, interval)`. A source answering `429` with `Retry-After: Sat, 01 Jan 12026 00:00:00 GMT` gets `next_allowed_at` in year 12026. Reproduced with a temporary integration test: the run answers `500 FST_ERR_RESPONSE_SERIALIZATION` (`SourceRunResult.nextAllowedAt`), and every later `GET /api/sources` answers 500 too (`Source.nextAllowedAt`), so the whole view is gone. There is no delete or edit route (out of scope), so the operator cannot recover without SQL. Delta-seconds up to `999999999` (≈ 31 years) also lock a source silently.
- Fix: cap the stored wait in one place, e.g. `nextAllowedAt = at + min(max(retryAfter, interval), MAX_SOURCE_BACKOFF_MS)` with a cap such as 7 days (or `24 h`, matching the interval's upper bound), and treat a `Retry-After` above the cap as the cap. Add a case to integration test (e) with a far-future HTTP-date.
- Effort: small
- Lesson candidate: Bound every date or time that comes from a source to the range the contract can serialise before storing it.
- Decision: fixed (5170138) + lesson proposed

### R3: The fixture anonymiser is quadratic on long tokens
- Severity: major
- Where: `apps/api/src/infrastructure/sources/rss/anonymise-feed.ts:5`
- Problem: `EMAIL = /[^\s<>"'&;@]+@[^\s<>"'&;@]+\.[^\s<>"'&;@]+/g` has unbounded quantifiers; on a run of characters without a delimiter or `@`, every start position scans to the end. Measured: 20 000 chars → 384 ms, 80 000 chars → 4.9 s, so a 1 MiB body (`FETCH_MAX_BYTES`) would take minutes. The input is the fetched feed (untrusted), and the file is in the scope of the lesson "Bound every CPU-bound step on untrusted input" (`apps/api/src/infrastructure/sources/**`). Impact is limited to the operator's CLI, not the server, but the docblock claims "Linear string work".
- Fix: bound the quantifiers (`{1,64}@{1,255}` style, matching RFC lengths) so each start position scans a constant length, and cut the XML to the first entries before scrubbing the head. Optionally add one timing assertion with a `FETCH_MAX_BYTES` body of a single long token.
- Effort: small
- Lesson candidate: no (covered by the existing lesson)
- Decision: fixed (5dea73e)

### R4: `pnpm fixtures:record` fetches a source outside the per-source interval and backoff
- Severity: minor
- Where: `apps/api/src/cli/fixtures-record.ts:40-50`
- Problem: the recorder calls `http.get` directly. It never claims the source (D-5) or checks `next_allowed_at`, so it can fetch right after a run or while the source has asked to wait via `Retry-After` (A-03, D-6). A thrown `HttpFetchError` (e.g. `robots_disallowed`, timeout) is also not caught, so the operator gets a stack trace instead of a one-line reason.
- Fix: refuse when `source.nextAllowedAt > now` (print the time), or go through `adapter.healthCheck` for the fetch and set `last_attempt_at`. Catch `HttpFetchError` and print its `reason`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (7db1bfc)

### R5: `.env.example` says the interval also applies to a check
- Severity: minor
- Where: `.env.example:48-51`
- Problem: the comment reads "Shortest time between two attempts on one source (a run or a check)". Under D-21 a check is not held to `SOURCE_MIN_INTERVAL_MINUTES`; it waits only for a pending `next_allowed_at` and a 60 s cooldown (`service.ts` `CHECK_COOLDOWN_MS`, `claimCheck`). `docs/source-policy.md` describes this correctly. This is close to the accepted lesson "never let a comment describe config that does not exist".
- Fix: change it to "Shortest time between two runs of one source, in minutes … A check (Sprawdź) waits 60 s since the last attempt and for any wait the source asked for."
- Effort: small
- Lesson candidate: no
- Decision: fixed (7db1bfc)

### R6: Two anonymiser patterns are still quadratic on a fetched feed
- Severity: major
- Where: `apps/api/src/infrastructure/sources/rss/anonymise-feed.ts:8`, `apps/api/src/infrastructure/sources/rss/anonymise-feed.ts:10`
- Problem: the R3 fix bounded `EMAIL` only. `PHONE = /(?<![\w.-])\+?\d[\d ()-]{7,}\d(?![\w-])/g` scans to the end of a run from every digit that follows a space or `(` when every digit is followed by `-`: measured on `'(1-'.repeat(n)` 15 k chars → 216 ms, 30 k → 903 ms, 60 k → 3.5 s (×4 per doubling, so a 1 MiB body takes minutes). `PERSON_TAG`'s lazy `[\s\S]*?<\/\1>` scans to the end from each unclosed `<author>`: 40 k → 28 ms, 80 k → 109 ms, 160 k → 435 ms (≈ 18 s at 1 MiB). With no entry in the feed, `scrub(xml, null)` runs on the whole body. The docblock still says "Linear string work", and this breaches the lesson "Bound every CPU-bound step on untrusted input" (scope `apps/api/src/infrastructure/sources/**`). Impact is the operator's CLI, not the server.
- Fix: bound `PHONE` (`[\d ()-]{7,20}`: no phone number is longer) and replace `PERSON_TAG` with an `indexOf` scan for the matching close tag (or bound the body, e.g. `[^<]{0,512}`). Extend the 1 MiB timing test in `anonymise-feed.test.ts` with these two shapes.
- Effort: small
- Lesson candidate: no (covered by the existing lesson)
- Decision: open

### R7: `docs/source-policy.md` does not mention the 7-day backoff cap
- Severity: minor
- Where: `docs/source-policy.md:15`
- Problem: the policy says the next attempt is "nie wcześniej niż `max(Retry-After, odstęp)`", but since the R2 fix it is `min(max(Retry-After, odstęp), 7 dni)` (`MAX_SOURCE_BACKOFF_MS`, `service.ts:27`). The operator reading the policy cannot tell a source may be retried before its stated `Retry-After`.
- Fix: append "…, najwyżej 7 dni" to that sentence.
- Effort: small
- Lesson candidate: no
- Decision: open
