# Review: public-tenders

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (72 files, 1031 tests), e2e ok (5), image not run (no Docker daemon in this session), image smoke not run (no Docker daemon) · Round: 3

Base: `2b2dd45` (branch point on `main`), head `0d533d2`: five phase commits, the fixes `39bc5e3` (R2) and `e0b3f01` (R1, R3), the lesson proposals `7caded4` and the triage `0d533d2`.

Round 3, a re-review after `/fix-review`. All three round-2 findings are marked `fixed`; I checked each one against the code:
- R1 is fixed in the adapters. BZP keeps the page number (`resumeAt`) and TED keeps the iteration token. The new adapter tests read past an over-full day and reach the later days. The service side of the fix has gaps, though: R4 and R5.
- R2 is fixed. `VALUE_LABEL` now needs the amount straight after the label (an optional parenthesised qualifier and a separator are allowed). Both threshold sentences give `null`, and `Wartość zamówienia (netto): 10 000 PLN` still parses.
- R3 is fixed. `TED_PAGE_CAP` now counts per day slice, and a 3-slice window with a token and an empty page per slice ends as `ok`.

R4-R6 are new and all come from the R1/R3 fix. I demonstrated R4 and R5 with scratch tests, which I removed afterwards. The tree stayed clean.

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/contracts/src/opportunities.ts` | done | `SourceType` += `bzp`/`ted`, `TenderFacts` (+ `valueState`, D-22), `SourceFacts.tender` |
| `packages/contracts/src/sources.ts` | done | `SourceKind`, `BzpConfig`, `TedConfig`, `TenderSettings`, `TED_COUNTRY_CODES` (D-26), `SourcePreset.type/tender`, PATCH `tender` |
| `packages/contracts/src/sources.test.ts` | done | prefix, duplicate, country and `TenderFacts` bounds |
| `packages/contracts/src/classification.ts` | done | `PUBLIC_TENDER` |
| `packages/contracts/src/index.ts` | unplanned | re-exports only |
| `apps/api/src/infrastructure/db/schema.ts`, `migrations/0012_*` (+ meta) | done | nullable `tender_json` |
| `apps/api/src/modules/sources/ports.ts` | done | generic `SourceAdapter<C>`, `DiscoverContext`, `truncated`/`resumeFrom` (D-21); `resumeAt` added by the R1 fix, see R6 |
| `apps/api/src/modules/sources/service.ts` | done | registry, `since`, `resumeFrom`/`resumeAt` cursor, `checkTender`, tagged `update` outcome (logged deviation); see R4, R5 |
| `apps/api/src/modules/sources/routes.ts` | done | 400 `not_tender_source` / `validation_failed` |
| `apps/api/src/modules/sources/presets.ts` | done | `bzp-it`, `ted-pl-it`; RSS presets carry `type`/`tender: null` (logged) |
| `apps/api/src/modules/signals/ingest.ts`, `ports.ts` | done | `tenderJson` |
| `apps/api/src/infrastructure/db/signal-repository.ts` | absent | not needed: `insertSignal` spreads `NewSignal`, so `tenderJson` is stored as is |
| `apps/api/src/infrastructure/db/source-repository.ts` | done | type from the row, `configJson` patch |
| `apps/api/src/infrastructure/db/opportunity-repository.ts`, `modules/opportunities/{ports,service}.ts` | done | `source.tender` via `safeParse` |
| `apps/api/src/infrastructure/db/analysis-repository.ts`, `modules/analysis/{ports,service}.ts` | done | `tenderJson` to the guard |
| `apps/api/src/infrastructure/sources/rss/adapter.ts` | done | typed `SourceAdapter<RssConfig>` |
| `apps/api/src/infrastructure/sources/compose.ts` | done | `rss`, `bzp`, `ted` + test overrides (logged) |
| `apps/api/src/infrastructure/sources/http/client.ts`, `test/http-client.int.test.ts` | done | `post`, per-request `maxBytes`, no redirect follow |
| `apps/api/src/modules/analysis/prefilter.ts` (+ test) | done | D-13 exemption |
| `apps/api/src/infrastructure/sources/bzp/{adapter,map-notice}.ts` (+ tests) | done | day slices (logged [REVIEW] deviation), 2 100 ms, 403 → `rate_limited`; resumes at a page number (R1 fix, see R6) |
| `apps/api/src/infrastructure/sources/tender-text.ts` (+ test) | done | linear HTML pass, value pattern needs the amount straight after the label (R2 fix) |
| `apps/api/src/infrastructure/sources/ted/{adapter,map-notice,query}.ts` (+ tests) | diverged | day slices (logged), `ITERATION`; the cap is now 5 per day slice, not 5 per run as in D-9, and nothing logs that; resumes from a stored token; see R4, R6 |
| `apps/api/test/fixtures/tenders/*` | done | synthetic, `DEMO`, `UNVERIFIED` (logged [FOLLOW-UP]) |
| `apps/api/test/tenders.int.test.ts`, `test/tender-sources.int.test.ts` | done | AC1–AC3, D-16, plan-review 4 |
| `apps/api/test/helpers/app.ts` | done | adapter override hook (plan-review 10) |
| `apps/api/src/infrastructure/sources/manual/robots.test.ts` | unplanned | fake client gains `post`; test-only |
| `apps/api/src/modules/sources/source-filter.test.ts` | unplanned | preset list (logged) |
| `apps/api/src/modules/analysis/output-guard.ts` (+ test) | done | D-3, D-6, buyer from `TenderFacts.buyer` (D-23 note) |
| `apps/api/src/modules/scoring/{rubric,score}.ts` (+ tests), `docs/scoring.md` | done | D-4 row and confidence |
| `apps/api/src/infrastructure/llm/prompt.ts` | done | D-17 rule, `analysis-2` |
| `apps/api/src/infrastructure/llm/prompt.test.ts` | absent | plan says "(+ test)"; the rule line is not asserted. The guard enforces the level whatever the model says, so no finding |
| `apps/web/src/strings.pl.ts`, `opportunityCard.ts` (+ test) | done | tender items; "nie podano" only for `absent` |
| `apps/web/src/SourcesPage.tsx`, `.module.css`, `api/sources.ts`, `SourcesPage.test.tsx` | done | tender editor |
| `e2e/` | absent | no sources flow exists; plan's fallback (component test) applies, logged |
| `docs/source-policy.md` | done | BZP, TED, Baza Konkurencyjności, D-16 and manual-first rule |
| `context/test-plan.md` | done | TR-28 and `tenders/` fixtures (logged) |
| `context/roadmap.md` | done | status |
| `context/lessons.md` | unplanned | two proposed lessons from R1 and R2, in their own commit |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | concern | a stored TED token outlives a config change and every failed run (R4) |
| Design | ok | adapters behind the existing port, one mapper per API, and the guard decides level and budget deterministically; the in-day position is opaque to the service |
| Safety | ok | every request goes through the guarded client; POST follows no redirects; the query is built only from validated digits and the country table; the HTML pass is linear; dates are bounded; the stored token is length-capped |
| Tests | concern | the adapters' resume is tested, but nothing tests the service storing and passing `resumeAt` (R5) |
| Simplicity | ok | the BZP and TED adapters duplicate the fetch/backoff loop, which is acceptable for two APIs with different failure rules |
| Plan fidelity | concern | D-9 and D-21 still describe a per-run TED cap and a capped day that stays capped (R6) |
| Agent decisions | ok | D-1, D-2, D-3, D-7 and D-13 each live in one place (registry, column, guard, contract schema, pre-filter) and can be swapped as stated |

## Findings
### R1: A day with more pages than the cap blocks every later day for good
- Severity: major
- Where: `apps/api/src/infrastructure/sources/bzp/adapter.ts:136-140`, `apps/api/src/infrastructure/sources/ted/adapter.ts:142-146`, `apps/api/src/modules/sources/service.ts:285-290`
- Problem: the cap counts requests for the whole run and `resumeFrom` is the start of the day where it was hit. When one UTC day needs more requests than the cap (BZP: more than 1 000 contract notices before the client-side CPV match, the D-21 "known limit"; TED: more than 5 pages), `resumeFrom` equals the day `since` started on, so every later run reads the same day again and stops at the same point. The days after it are never asked for, and every run stays `partial`. The plan says such a day "stays capped on that day", but the effect is that the source stops advancing. Evidence: the existing test `bzp/adapter.test.ts:99-108` already returns `resumeFrom` = the floor of `since`. A scratch run of three consecutive `discover` calls (each `since` = the previous `resumeFrom`, 2026-10-24 always full) asked only for `2026-10-24`, never for 10-25 or 10-26. BZP's server-side filter is only by notice type (the CPV match is client-side), so a busy national day is a realistic input.
- Fix: keep the position inside the day in the cursor (`resumeFrom` + `resumePage`, or the TED `iterationNextToken`), so the next run continues where the cap stopped instead of at the day's start. If that is not wanted, then when a whole run was spent on one day, move `resumeFrom` to the next day and log a `day_capped <date>` gap so the loss is visible. Either way, add a test with two runs over a day that needs more than the cap, followed by a day with a notice that must arrive.
- Effort: medium
- Lesson candidate: A resume cursor must make progress on every run; test the case where one unit of work is larger than the per-run budget.
- Decision: fixed (e0b3f01) + lesson proposed
- Round 3: verified in the adapters (`bzp/adapter.test.ts`, `ted/adapter.test.ts` "continues a day larger than the cap"); the service side is R4 and R5.

### R2: Threshold sentences are read as the notice's estimated value
- Severity: major
- Where: `apps/api/src/infrastructure/sources/tender-text.ts:81-82` (`VALUE_LABEL`), used by `bzp/map-notice.ts:71`
- Problem: the label may be followed by up to 60 arbitrary non-digit characters before the amount. So common Polish procurement phrasing about thresholds matches: `findEstimatedValue('Wartość zamówienia nie przekracza kwoty 130 000 zł netto.')` returns `{ amountMinor: 13000000, currency: 'PLN' }`, and `'Szacunkowa wartość zamówienia jest mniejsza niż 5 538 000 euro.'` returns 5 538 000 EUR (both run against the code). That value becomes `TenderFacts.estimatedValue` with `valueState: 'stated'`. The guard then turns it into `sourceBudget` (D-6), and the card shows it as "Wartość szacunkowa … ze źródła". That is an invented budget shown as a source fact (CLAUDE.md "Truth first", PRD §0), and it also feeds the score.
- Fix: accept only a label directly followed by a separator and the amount, e.g. replace `[^\d\n]{0,60}` with an optional short parenthesised qualifier and a required `:`/`–` (`\s*(?:\([^)\n]{0,40}\)\s*)?[:–-]\s*`). Or reject a match whose gap contains a comparison (`nie przekracza`, `mniejsz`, `poniżej`, `powyżej`, `przekracza`, `prog`). Add both sentences above as `null` cases to `tender-text.test.ts`.
- Effort: small
- Lesson candidate: A pattern that extracts a source fact must have negative tests with the domain's look-alike phrasing (thresholds, limits, ranges), not only with unrelated text.
- Decision: fixed (39bc5e3) + lesson proposed
- Round 3: verified; both sentences are `null` cases in `tender-text.test.ts`, the labelled form still parses.

### R3: TED's page cap makes the first run, and the first run after each UTC midnight, `partial`
- Severity: minor
- Where: `apps/api/src/infrastructure/sources/ted/adapter.ts:13,142-170`
- Problem: in `ITERATION` mode the adapter stops a slice only on an empty page or a missing token. Under the documented behaviour it follows (a token on the last data page, then an empty page; see `ted/adapter.test.ts:90`), every day slice costs at least 2 requests. The window is `lastSuccessAt − 24 h` floored to a UTC day. So it covers 3 slices whenever the last success was on the previous UTC day, and 4 on a first run. That is 6 or 8 requests against `TED_PAGE_CAP = 5`. Such runs end `truncated`/`partial` with a `page_cap` warning even when only a few notices exist. A daily spurious `partial` hides the real truncations that R1 and D-21 rely on the log to show.
- Fix: count the cap per slice (e.g. 5 data pages per day) or exclude the terminating empty page from the cap. Alternatively, size the cap to `2 × slices + headroom`. Add a test: a 3-slice window with one short page plus a token per slice completes as `ok`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (e0b3f01)
- Round 3: verified; `ted/adapter.test.ts` "counts the cap per day slice" makes 6 requests and is not truncated.

### R4: A stored TED token survives a config change and every failed run, so a rejected token stops the source for good
- Severity: major
- Where: `apps/api/src/modules/sources/service.ts:305-310` (passes `previous.resumeAt`), `:270` (`fail` leaves the cursor as it is), `:505-537` (`update` writes `configJson` and leaves the cursor as it is); `apps/api/src/infrastructure/sources/ted/adapter.ts:151`
- Problem: the TED `iterationNextToken` belongs to one query, and the query is built from `countries` and `cpvPrefixes`. Two things go wrong:
  - A PATCH of the tender settings writes a new `configJson` but keeps `resumeAt`. The next run sends the old query's token with the new query.
  - When a resumed run fails, `fail` keeps the cursor. The next run sends the same token again, and so does every run after it. Nothing ever drops the token, and the UI cannot clear it.
  If TED rejects a stale or mismatched token (its pagination behaviour is `UNVERIFIED`), the source fails on every run from then on. If TED accepts it, the first day continues at a position from the old query and skips notices without saying so. Evidence: a scratch integration test (fake TED adapter, run truncated with `resumeAt: 'tok-old'`, then PATCH `{cpvPrefixes:['48'], countries:['DE']}` → 200, then three runs failing `http_status 400`) received `resumeAt` = `[null, "tok-old", "tok-old", "tok-old"]`.
- Fix: in `update`, when `configJson` changes, drop `resumeAt` from the cursor (keep `resumeFrom`, so the day is re-read from its start). In `run`, when a run that was given a `resumeAt` fails, save the cursor without `resumeAt`, so the next run restarts that day from page 1 / no token. That costs one re-read, never a stuck source. Add a service-level test for both cases.
- Effort: small
- Lesson candidate: An opaque continuation token stored across runs must be dropped when the query it belongs to changes and after a failed run that used it.
- Decision: open

### R5: Nothing tests that the service stores and passes `resumeAt`
- Severity: major
- Where: `apps/api/src/modules/sources/service.ts:305-310,382-389`; no test outside the two adapter tests mentions `resumeAt`
- Problem: the R1 fix has two halves. The adapter returns an in-day position, and the service stores it in the cursor and hands it to the next run. Only the adapter half is tested. As a mutation check, I changed `? { resumeAt: outcome.resumeAt }` to `? {}` in `saveCursor`, which brings back R1 in full. All API tests still passed (54 files, 767 tests). So the lesson this change proposes ("test a unit of work larger than the per-run budget") is not met where the cursor lives.
- Fix: add a case to `test/tender-sources.int.test.ts` with the fake adapter recording `context.resumeAt`. A truncated run returns `resumeFrom` + `resumeAt: 'p11'`, and the next run must get `since = resumeFrom` and `resumeAt = 'p11'`. A complete run must clear both. A run that returns `resumeAt` without `resumeFrom`, or one longer than `RESUME_AT_MAX`, must not store it.
- Effort: small
- Lesson candidate: no (covered by the proposed R1 lesson)
- Decision: open

### R6: The plan no longer describes the cursor and the TED cap
- Severity: minor
- Where: `context/changes/public-tenders/plan.md` D-9, D-21 and *Deviations*; `apps/api/src/infrastructure/sources/bzp/adapter.ts:141-155`, `ted/adapter.ts:13-14,153`
- Problem:
  - D-9 says TED stops at 5 pages per run. The code now allows 5 per day slice, so a run's requests grow with the window (a long outage costs up to 5 × days).
  - D-21 still says a day with more than 1 000 notices "stays capped on that day". It also rejected alternative C because the API's page order is `UNVERIFIED`, and so chose day slices that are safe "whatever order the pages come in". The BZP fix now resumes at a page number, which is only safe if that order stays the same between runs at least 60 minutes apart. The request sets no sort parameter. If notices are reordered or withdrawn, a resumed run skips some without saying so.
  - No *Deviations* line records any of this. CLAUDE.md: when the code and an artifact disagree, raise it.
- Fix: update D-9 and D-21 (or add `[minor]` deviations) to cover the per-slice TED cap, the `resumeAt` cursor field and the page-order assumption. Mark that assumption `UNVERIFIED` and add it to the BZP human check. Optionally bound the TED run to a total request budget as well (e.g. 5 × slices, at most 40).
- Effort: small
- Lesson candidate: no
- Decision: open
