# Review: public-tenders

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (72 files, 1028 tests), e2e ok (5), image not run (no Docker daemon in this session), image smoke not run (no Docker daemon) · Round: 2

Base: `2b2dd45` (branch point on `main`), head `c475b69`, five phase commits; the code is unchanged since `2716067`.

Round 2: the run resumed at the review step. The earlier `/fix-review` and `/pr-body` attempts ended on a provider usage limit (`.workflow/logs/public-tenders/09-12`), so no round-1 finding has been worked on and none is marked `fixed`. Since round 1, only `review.md`, `pr-body.md` and the roadmap status have changed. I re-checked R1-R3 against the current code. R1 and R3: `bzp/adapter.ts:136-140` and `ted/adapter.ts:142-146` are unchanged. R2: running `findEstimatedValue` again returns 13 000 000 minor PLN and 553 800 000 minor EUR for the two threshold sentences. A second reading of the service cursor, the guard, the TED mapper, the prompt and the Sources editor found no new defect that I could demonstrate. All gates were re-run on this head; the tree stayed clean.

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/contracts/src/opportunities.ts` | done | `SourceType` += `bzp`/`ted`, `TenderFacts` (+ `valueState`, D-22), `SourceFacts.tender` |
| `packages/contracts/src/sources.ts` | done | `SourceKind`, `BzpConfig`, `TedConfig`, `TenderSettings`, `TED_COUNTRY_CODES` (D-26), `SourcePreset.type/tender`, PATCH `tender` |
| `packages/contracts/src/sources.test.ts` | done | prefix, duplicate, country and `TenderFacts` bounds |
| `packages/contracts/src/classification.ts` | done | `PUBLIC_TENDER` |
| `packages/contracts/src/index.ts` | unplanned | re-exports only |
| `apps/api/src/infrastructure/db/schema.ts`, `migrations/0012_*` (+ meta) | done | nullable `tender_json` |
| `apps/api/src/modules/sources/ports.ts` | done | generic `SourceAdapter<C>`, `DiscoverContext`, `truncated`/`resumeFrom` (D-21) |
| `apps/api/src/modules/sources/service.ts` | done | registry, `since`, `resumeFrom` cursor, `checkTender`, tagged `update` outcome (logged deviation) |
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
| `apps/api/src/infrastructure/sources/bzp/{adapter,map-notice}.ts` (+ tests) | done | day slices (logged [REVIEW] deviation), 2 100 ms, 403 → `rate_limited`; see R1, R2 |
| `apps/api/src/infrastructure/sources/tender-text.ts` (+ test) | done | linear HTML pass, value pattern; see R2 |
| `apps/api/src/infrastructure/sources/ted/{adapter,map-notice,query}.ts` (+ tests) | done | day slices (logged), `ITERATION`, cap 5; see R1, R3 |
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

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | concern | a day with more pages than the cap stops the window for good (R1); threshold phrases become an estimated value (R2) |
| Design | ok | adapters behind the existing port, one mapper per API, the guard decides level and budget deterministically |
| Safety | ok | every request on the guarded client, POST without redirects, query built only from validated digits and the country table, linear HTML pass, bounded dates |
| Tests | ok | behaviour asserted through `MockAgent` and the injected clock; failure paths, off-state filter and two-source cases covered; synthetic shapes are marked |
| Simplicity | ok | BZP and TED adapters duplicate the fetch/backoff loop, acceptable for two APIs with different failure rules |
| Plan fidelity | ok | every deviation is logged; plan-review majors answered by D-21…D-26 |
| Agent decisions | ok | D-1, D-2, D-3, D-7, D-13 each live in one place (registry, column, guard, contract schema, pre-filter) and can be swapped as stated |

## Findings
### R1: A day with more pages than the cap blocks every later day for good
- Severity: major
- Where: `apps/api/src/infrastructure/sources/bzp/adapter.ts:136-140`, `apps/api/src/infrastructure/sources/ted/adapter.ts:142-146`, `apps/api/src/modules/sources/service.ts:285-290`
- Problem: the cap counts requests for the whole run and `resumeFrom` is the start of the day where it was hit. When one UTC day needs more requests than the cap (BZP: more than 1 000 contract notices before the client-side CPV match, the D-21 "known limit"; TED: more than 5 pages), `resumeFrom` equals the day `since` started on, so every later run reads the same day again and stops at the same point. The days after it are never asked for, and every run stays `partial`. The plan says such a day "stays capped on that day", but the effect is that the source stops advancing. Evidence: the existing test `bzp/adapter.test.ts:99-108` already returns `resumeFrom` = the floor of `since`. A scratch run of three consecutive `discover` calls (each `since` = the previous `resumeFrom`, 2026-10-24 always full) asked only for `2026-10-24`, never for 10-25 or 10-26. BZP's server-side filter is only by notice type (the CPV match is client-side), so a busy national day is a realistic input.
- Fix: keep the position inside the day in the cursor (`resumeFrom` + `resumePage`, or the TED `iterationNextToken`), so the next run continues where the cap stopped instead of at the day's start. If that is not wanted, then when a whole run was spent on one day, move `resumeFrom` to the next day and log a `day_capped <date>` gap so the loss is visible. Either way, add a test with two runs over a day that needs more than the cap, followed by a day with a notice that must arrive.
- Effort: medium
- Lesson candidate: A resume cursor must make progress on every run; test the case where one unit of work is larger than the per-run budget.
- Decision: fixed (e0b3f01) + lesson proposed

### R2: Threshold sentences are read as the notice's estimated value
- Severity: major
- Where: `apps/api/src/infrastructure/sources/tender-text.ts:81-82` (`VALUE_LABEL`), used by `bzp/map-notice.ts:71`
- Problem: the label may be followed by up to 60 arbitrary non-digit characters before the amount. So common Polish procurement phrasing about thresholds matches: `findEstimatedValue('Wartość zamówienia nie przekracza kwoty 130 000 zł netto.')` returns `{ amountMinor: 13000000, currency: 'PLN' }`, and `'Szacunkowa wartość zamówienia jest mniejsza niż 5 538 000 euro.'` returns 5 538 000 EUR (both run against the code). That value becomes `TenderFacts.estimatedValue` with `valueState: 'stated'`. The guard then turns it into `sourceBudget` (D-6), and the card shows it as "Wartość szacunkowa … ze źródła". That is an invented budget shown as a source fact (CLAUDE.md "Truth first", PRD §0), and it also feeds the score.
- Fix: accept only a label directly followed by a separator and the amount, e.g. replace `[^\d\n]{0,60}` with an optional short parenthesised qualifier and a required `:`/`–` (`\s*(?:\([^)\n]{0,40}\)\s*)?[:–-]\s*`). Or reject a match whose gap contains a comparison (`nie przekracza`, `mniejsz`, `poniżej`, `powyżej`, `przekracza`, `prog`). Add both sentences above as `null` cases to `tender-text.test.ts`.
- Effort: small
- Lesson candidate: A pattern that extracts a source fact must have negative tests with the domain's look-alike phrasing (thresholds, limits, ranges), not only with unrelated text.
- Decision: fixed (39bc5e3) + lesson proposed

### R3: TED's page cap makes the first run, and the first run after each UTC midnight, `partial`
- Severity: minor
- Where: `apps/api/src/infrastructure/sources/ted/adapter.ts:13,142-170`
- Problem: in `ITERATION` mode the adapter stops a slice only on an empty page or a missing token. Under the documented behaviour it follows (a token on the last data page, then an empty page; see `ted/adapter.test.ts:90`), every day slice costs at least 2 requests. The window is `lastSuccessAt − 24 h` floored to a UTC day. So it covers 3 slices whenever the last success was on the previous UTC day, and 4 on a first run. That is 6 or 8 requests against `TED_PAGE_CAP = 5`. Such runs end `truncated`/`partial` with a `page_cap` warning even when only a few notices exist. A daily spurious `partial` hides the real truncations that R1 and D-21 rely on the log to show.
- Fix: count the cap per slice (e.g. 5 data pages per day) or exclude the terminating empty page from the cap. Alternatively, size the cap to `2 × slices + headroom`. Add a test: a 3-slice window with one short page plus a token per slice completes as `ok`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (e0b3f01)
