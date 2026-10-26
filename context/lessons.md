# Lessons

Rules from reviews. Binding for planning, implementing and reviewing once accepted at a PR.

## When a plan-review finding is accepted, apply its primary fix or log why not, and never let a comment describe config that does not exist
- Why: a half-applied finding left `.env.example` claiming compose pins HOST/DATA_DIR while it did not, so a copied template could break the container.
- Seen in: repo-skeleton, R1
- Scope: plans, config templates, compose/Docker files
- Status: accepted (PR #18)

## Validate every value against its contract schema before storing it, not only when reading it back
- Why: a generated justification longer than the contract allowed was saved unchecked, then silently turned into `null` on read, so a scored row showed no breakdown.
- Seen in: analysis-and-scoring, R1
- Scope: services that persist generated or derived data (`apps/api/src/modules/*/service.ts`)
- Status: proposed in the PR for analysis-and-scoring

## A guard that verifies a quote must also verify the values derived from it
- Why: checking only that a quote occurs in the source let a model attach invented amounts to a real, unrelated phrase and show them as "ze źródła".
- Seen in: analysis-and-scoring, R2
- Scope: `apps/api/src/modules/analysis/output-guard.ts` and any provider-output check
- Status: proposed in the PR for analysis-and-scoring

## A gate run must not rewrite committed files
- Why: `pnpm e2e` saved evidence screenshots of earlier changes on every run, so each later run left a dirty tree and fix-review got stuck on files it must not touch.
- Seen in: analysis-and-scoring, fix-review
- Scope: `e2e/**`, `scripts/**`, any gate command
- Status: accepted (user rule: fast MVP; fixed in the analysis-and-scoring PR)

## Store every billed provider answer with its usage and cost, whatever its outcome
- Why: refusals, truncations and non-JSON answers were billed but stored without cost, so the monthly cap under-counted real spend.
- Seen in: llm-providers, R2
- Scope: `apps/api/src/infrastructure/llm/**`, `apps/api/src/modules/analysis/service.ts`
- Status: proposed in the PR for llm-providers

## When a rule has side doors, test its invariants over two-step paths, not only single moves
- Why: `checkMove` was right for every single move, yet `WON → NEEDS_VERIFICATION → MEETING` skipped the note and `NEEDS_VERIFICATION → MEETING → WON` won a row that was never contacted.
- Seen in: pipeline-and-payments, R1
- Scope: transition and state-machine code (`packages/contracts/src/status.ts` and its tests)
- Status: proposed in the PR for pipeline-and-payments

## Bound every CPU-bound step on untrusted input, or run it where the deadline can stop it
- Why: Readability is superlinear in nesting depth, so a 22 KB page blocked the single Node process for two minutes; an `AbortSignal` deadline cannot interrupt synchronous code. The parser itself (linkedom) was superlinear too, so bound the input before the first parse, and test with a body of the maximum allowed size, not a small one.
- Seen in: url-import-guard, R1, R5
- Scope: `apps/api/src/infrastructure/sources/**` and any parser or extractor of fetched content
- Status: proposed in the PR for url-import-guard

## Bound every date or time that comes from a source to the range the contract can serialise before storing it
- Why: a feed date and a `Retry-After` date in year 12026 were stored as valid, then made `GET /api/opportunities` and `GET /api/sources` answer 500 for good.
- Seen in: rss-sources, R1, R2
- Scope: parsers and services that store source-supplied dates, delays or counts (`apps/api/src/infrastructure/sources/**`, `apps/api/src/modules/sources/**`)
- Status: proposed in the PR for rss-sources

## Answer every plan-review finding of major or above with a Decisions row or a Deviations line before implementing
- Why: a major plan-review finding left unanswered reached the review as a correctness defect (a dropped scheduled slot).
- Seen in: scheduler-and-jobs, R1
- Scope: `context/changes/*/plan.md`, `/plan` revise mode and `/implement`
- Status: proposed in the PR for scheduler-and-jobs

## When a per-source rule writes to a shared, deduplicated record, decide and test what a second source that disagrees does
- Why: the first source to store an item decided it for every later source, depending on run order, and nothing recorded or tested that.
- Seen in: demand-sources, R1
- Scope: `apps/api/src/modules/sources/`, `apps/api/src/modules/signals/`
- Status: proposed in the PR for demand-sources

## For every on/off switch an acceptance criterion names, test the off state with input that the on state would reject
- Why: an off state tested only with empty settings or duplicate input leaves the switch unchecked, so dropping it breaks nothing.
- Seen in: demand-sources, R2
- Scope: integration tests for settings with an `enabled` flag
- Status: proposed in the PR for demand-sources

## Assert the exact outcome of a race test, and check it fails when the guard it names is removed
- Why: a test whose assertion accepts either branch (`<= 1`) passed while the guard it was written for was never exercised.
- Seen in: analysis-observability, R2
- Scope: `apps/api/test/**`
- Status: proposed in the PR for analysis-observability

## A resume cursor must make progress on every run; test a unit of work larger than the per-run budget
- Why: a cursor that restarts the capped unit re-reads it forever and never reaches later units.
- Seen in: public-tenders, R1
- Scope: `apps/api/src/infrastructure/sources/**`, `apps/api/src/modules/sources/service.ts`
- Status: proposed in the PR for public-tenders

## A pattern that extracts a source fact needs negative tests with the domain's look-alike phrasing
- Why: threshold sentences ("nie przekracza kwoty ...") were read as an estimated value and shown as a source fact.
- Seen in: public-tenders, R2
- Scope: `apps/api/src/infrastructure/sources/**` text extraction
- Status: proposed in the PR for public-tenders

## Drop a stored opaque continuation token when its query changes and after a failed run that used it
- Why: a token that belongs to one query, kept across a settings change or a failure, is sent again forever or skips notices silently.
- Seen in: public-tenders, R4
- Scope: `apps/api/src/modules/sources/service.ts`, `apps/api/src/infrastructure/sources/**`
- Status: proposed in the PR for public-tenders

## A test that names a cross-record situation must create the real link the production path creates, not a look-alike row
- Why: a look-alike row (an unused identity instead of the evidence link) lets the assertion pass under any rule, so the test proves nothing
- Seen in: insights, R1
- Scope: `apps/api/test/**`
- Status: proposed in the PR for insights
