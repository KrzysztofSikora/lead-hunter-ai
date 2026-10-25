# Plan: today-brief (S-13)

## Goal and end state
The Start route becomes the Today view (nav "Dziś") and `GET /api/digest/today` returns the daily
brief in the order of PRD brief §11.1:

- source status (OK / error / never-checked counts of the enabled sources), new signals today, new
  opportunities today at or above the threshold;
- TOP: up to 5 open opportunities with score, category, evidence level and the analysis' next step,
  at most 2 near-duplicates, direct requests first (FR-16 AC1, AC2);
- the one best next step; today's LLM cost as "brak danych" with the token count when known
  (FR-16 AC1, FR-09 AC4 wording);
- follow-ups due today or overdue (FR-14 AC4), recent source errors;
- product hypotheses and weak signals only in the separate section
  "Pomysły produktowe / słabe sygnały" (FR-16 AC3);
- with no qualifying opportunity: "Brak zweryfikowanych okazji dla tego okresu", the number of
  sources checked and their errors, nothing generated (FR-12 AC1).

Every value comes from stored rows; nothing is padded, estimated or invented.

## Scope
- In: contract `DigestToday`; route `GET /api/digest/today` (optional `minScore`); a digest module
  (repository, selection rule, service); the Today page at `/` replacing the current Start view and
  absorbing the due follow-ups list; the nav label; the e2e main path step that opens Start.
- Out: money cost of LLM calls (S-05 adds the price table; the field is added then); daily-limit
  counts in the brief (FR-09 AC3, owned by S-05); notifications (FR-29, P1); a plain-text/Markdown
  export of the brief; persisted list filters; Insights (S-14).

## Findings
- The Start route is `StatusView` in `apps/web/src/App.tsx:19-40`: the health line plus
  `DueFollowUps` from `apps/web/src/PipelinePage.tsx:46-70`, which loads the whole
  `GET /api/pipeline` only to show `followUpsDue`. The nav label is `strings.nav.start = 'Start'`
  (`apps/web/src/strings.pl.ts:31`).
- e2e: `e2e/smoke.spec.ts:37,46` expects "Serwer działa" on `/` after login (the health line must
  stay on Today); `e2e/vertical-main-path.spec.ts:83-87` clicks the link "Start" and expects the
  heading "Na dziś: follow-up" with the contacted opportunity. Evidence screenshots are written only
  with `E2E_EVIDENCE=1` (`e2e/smoke.spec.ts:6-12`), so the gate keeps the tree clean (lesson
  "A gate run must not rewrite committed files").
- Follow-ups due: `PipelineRepository.followUpsDue(until)` (`apps/api/src/modules/pipeline/ports.ts:20`,
  `apps/api/src/infrastructure/db/pipeline-repository.ts:67-80`), called with
  `startOfWarsawDay(now)` in `apps/api/src/modules/pipeline/service.ts:43-45`; items use
  `PipelineItem` (`packages/contracts/src/pipeline.ts:20-32`). Reusable as is.
- Source state lives on `sources` (`schema.ts`: `lastAttemptAt`, `lastSuccessAt`,
  `lastErrorReason/Status/At`); a success clears the error
  (`apps/api/src/infrastructure/db/source-repository.ts:116-117`). The empty state's reader
  `createSourceStatusReader` (`apps/api/src/infrastructure/db/source-status-reader.ts`) returns
  `{ checked, errors }` for enabled, attempted sources; contract `SourcesStatus` / `SourceError`
  (`packages/contracts/src/opportunities.ts:333-347`).
- Analysis leaves `businessStatus` unchanged (NEW) for `ANALYSED` and sets `NEEDS_VERIFICATION`
  for insufficient data (`apps/api/src/modules/analysis/service.ts:121-147`). Columns
  `category`, `evidenceLevel`, `score`, `analysisProvider` are on `opportunities`; `nextAction` and
  `buyerOrAudience` exist only in the latest `analyses.result_json` (validated with
  `OpportunityAnalysis` after `upgradeStoredAnalysis`, as `opportunity-repository.ts:165` does).
  DEMO is `isDemo(analysisProvider)` (`apps/api/src/modules/opportunities/service.ts:92`).
- LLM usage: `analyses.input_tokens/output_tokens/created_at`; the mock reports `null` tokens
  (`apps/api/src/infrastructure/llm/mock.ts:102`). No price table exists (S-05 is `todo`); job
  cost is tokens only (`packages/contracts/src/jobs.ts:31`).
- Threshold: `DEFAULT_MIN_SCORE = 65` (`packages/contracts/src/analysis.ts:8`); the profile holds
  no threshold and list filters are per request (`OpportunityListQuery`).
- Categories and evidence levels: `packages/contracts/src/classification.ts`; Polish labels already
  exist in `strings.opportunities` (`strings.pl.ts:219`, `:442`).
- Warsaw day helpers: `startOfWarsawDay`, `instantToWarsawDate`
  (`apps/api/src/modules/shared/warsaw-day.ts`); web formatting `formatCalendarDate`
  (`apps/web/src/warsawTime.ts`).
- Layers: `apps/api/src/modules/**` must not import infrastructure or drivers
  (`eslint.config.*:46-53`); the module gets a port, the repository lives in
  `infrastructure/db`. Routes are guarded by `registerAuth` automatically and the OpenAPI test
  compares routes with the document, so the new route needs a Zod response schema.
- Tests: fake provider via `buildTestApp({ provider })` and `FakeClock`
  (`apps/api/test/helpers/app.ts:75-180`); `analysis()` builder in `apps/api/test/helpers/analysis.ts`.
  Test budget (`context/test-plan.md`): one or two integration tests for the slice's API, no
  component tests, the e2e main path may be extended but no new spec.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Response shape of `GET /api/digest/today` | Structured JSON (`DigestToday`, below); the web app renders the §11.1 order and wording | B: also a `text` field with the §11.1 plain text (ready for Telegram, P1); C: text only | One source of wording (the web strings, as everywhere else); B is additive later when notifications need it | costly (public API contract; additive changes stay cheap) | agent |
| D-2 | What "new" means for signals and opportunities | Created since the start of today's Europe/Warsaw day | B: last 24 h (the 08:00 brief would include yesterday's 18:00 run); C: since the previous brief was opened (needs stored state) | Matches the dated header of §11.1 and the "Codziennie" KPIs of §10.3; no new state | cheap | agent |
| D-3 | Which opportunities can enter TOP and the weak section | Open statuses `NEW`, `QUALIFIED`, `SAVED`, `OFFER_DRAFTED`; `analysisStatus = COMPLETE`; created in the last 7 days (`DIGEST_WINDOW_DAYS`) | B: all open ones regardless of age (old leads pin the top forever); C: only today's (empty most mornings) | A brief is about what to act on now; contacted rows reach Today through their follow-up | cheap | agent |
| D-4 | Main section vs "Pomysły produktowe / słabe sygnały" | Weak = category `PRODUCT_HYPOTHESIS` or evidence `INDIRECT_SIGNAL` / `SPECULATIVE`; everything else is main. Main needs `score >= minScore`; weak shows up to 5 by score with no threshold | B: split by category only (an indirect signal would be shown as a job); C: weak section also thresholded (it would be almost always empty, since the demand caps keep weak signals low) | §7.3: hypotheses "nie mogą udawać aktualnych zleceń"; evidence level is what says how real the demand is | cheap | agent |
| D-5 | Near-duplicate measure (roadmap: agent decides) | Token Jaccard ≥ 0.6 on title + `buyerOrAudience`: NFKD, strip diacritics, lowercase, split on non-alphanumerics, keep tokens of ≥ 3 chars | B: normalised Levenshtein on titles (order sensitive, slower); C: identical normalised title only (misses reworded reposts) | The roadmap names token similarity; cheap, deterministic, language neutral | cheap | agent |
| D-6 | Ordering and "prefer direct, feasible" | Sort by evidence `DIRECT_REQUEST` first, then score desc, `createdAt` desc, id desc; greedy pick up to 5, skipping a candidate that is near-duplicate of 2 already picked | B: score only with directness as a tie-breaker (a 90-point indirect problem would beat a 66-point direct request); C: a weighted bonus (a second, hidden score) | Score already measures feasibility (skill fit, speed); directness is the explicit preference of AC2 and stays visible | cheap | agent |
| D-7 | How many in TOP | Up to 5 of the main section; fewer when fewer qualify, never padded | B: always 3 | PRD says 3–5 and forbids filling; 5 is the ceiling | cheap | agent |
| D-8 | Threshold and filters in the brief (FR-10 AC6) | `minScore` query parameter, default `DEFAULT_MIN_SCORE` (65); no other filter | B: also accept the list's filters (no persisted filters exist yet, the UI would not send them); C: no parameter | The brief honours the same threshold as the list's one-click default; other filters are per-request on the list | cheap | agent |
| D-9 | Today's LLM cost before S-05 | `llm: { analyses, inputTokens, outputTokens }` (tokens `null` when no analysis reported them); the UI always says "brak danych" for the money value, with tokens when known | B: show 0 for the mock (an assumed value); C: estimate from tokens (forbidden by FR-09 AC4) | Honest now; S-05 adds a `cost` field additively | cheap | agent |
| D-10 | The best next step | A due/overdue follow-up first (oldest), else the first TOP item's `nextAction`, else none ("brak") | B: always TOP[0] (an owed follow-up to a contacted client would be buried) | A follow-up is a promise already made to a real person; a new lead can wait a few hours | cheap | agent |
| D-11 | Source status counts | Enabled sources: `ok` = attempted and no current error; `error` = current error; `notChecked` = never attempted; errors list = current errors, newest first | B: count failed job runs of today (a source that failed at 08:00 and recovered at 18:00 would still show as broken) | The current state is what the operator must act on; history stays on Sources | cheap | agent |
| D-12 | Where the follow-ups due come from on Today | In the digest response (reusing `PipelineRepository.followUpsDue` and `PipelineItem`); `DueFollowUps` leaves `PipelinePage.tsx` | B: keep a second request to `GET /api/pipeline` | One request per view; the pipeline summary is heavier | cheap | agent |
| D-13 | Nav label and route | Route `/` stays; the link reads "Dziś"; the health line stays at the top of the view | B: new route `/dzis` with Start kept | PRD §11 names the first view Today; `/` keeps old bookmarks working | cheap | agent |
| D-14 | Which rows are candidates (plan-review 1) | `score`, `category`, `evidenceLevel` all `IS NOT NULL` in the candidate query, in addition to D-3 | B: filter in `select.ts` (the row would still be loaded and could reach `DigestItem`) | A completed INSUFFICIENT_DATA row moved to QUALIFIED/SAVED has none of them and would make `DigestToday.parse` throw (500) | cheap | agent |
| D-15 | Near-duplicate invariant (plan-review 6) | Every TOP item has at most one near-duplicate in TOP (a group of at most 2, also along an A~B~C chain); `pickTop` enforces it | B: at most 2 near-duplicates per item (a group of 3) | Matches the roadmap's "at most 2 near-duplicates"; not transitive Jaccard cannot sneak in a third | cheap | agent |
| D-16 | What `newAboveThreshold` counts (plan-review 7) | Main-section (not weak) rows with a score `>= minScore`, any business status, created since Warsaw midnight | B: only open statuses (a contacted lead from this morning would vanish from the count) | The header says how many good leads arrived today, independent of what the operator did with them | cheap | agent |

## Design

### Contract (`packages/contracts/src/digest.ts`)
```
DigestQuery   = { minScore?: int 0..100 }            // empty string = absent, as in OpportunityListQuery
DigestItem    = { id, title, category: Category, evidenceLevel: EvidenceLevel, score: int 0..100,
                  nextAction: string | null, demo: boolean, businessStatus: BusinessStatus,
                  createdAt: iso }
DigestToday   = {
  date: calendarDate,                                 // today in Europe/Warsaw
  minScore: int,
  sources: { ok, error, notChecked: int>=0, errors: SourceError[] },
  newSignals: int>=0,
  newAboveThreshold: int>=0,
  top: DigestItem[] (max 5),
  bestNextStep: null
    | { kind: 'follow_up', opportunityId, title, followUpOn: calendarDate }
    | { kind: 'opportunity', opportunityId, title, nextAction: string },
  followUpsDue: PipelineItem[],
  llm: { analyses: int>=0, inputTokens: int|null, outputTokens: int|null },
  weakSignals: DigestItem[] (max 5),
}
```
`nextAction` is model output (the UI labels it "wniosek modelu", FR-11 AC3). Every value is parsed
with the schema before it leaves the service (lesson "Validate every value against its contract").

### Module `apps/api/src/modules/digest/`
- `ports.ts`: `DigestRepository` with `sourceHealth()`, `countSignalsSince(ms)`,
  `countScoredSince(ms, minScore)`, `candidates(sinceMs, limit)` → rows with id, title, category,
  evidenceLevel, score, businessStatus, createdAt, provider, and `buyer` / `nextAction` read from
  the latest analysis (null when the stored JSON does not validate), `llmUsageSince(ms)`.
- `select.ts` (pure): `isWeak(row)`, `tokens(text)`, `nearDuplicate(a, b)`, `pickTop(rows, minScore)`,
  `pickWeak(rows)`; constants `TOP_LIMIT = 5`, `MAX_NEAR_DUPLICATES = 2`, `SIMILARITY = 0.6`,
  `DIGEST_WINDOW_DAYS = 7`, `CANDIDATE_LIMIT = 200`.
- `service.ts`: `createDigestService({ repository, pipeline, clock })` → `today(query)`; computes
  `startOfWarsawDay(now)`, calls the repository, applies `select.ts`, builds `bestNextStep`
  (D-10), returns `DigestToday.parse(...)`.
- `routes.ts`: `GET /api/digest/today`, `querystring: DigestQuery`, `response: { 200: DigestToday }`.

### Repository `apps/api/src/infrastructure/db/digest-repository.ts`
Plain Drizzle queries over `sources`, `raw_signals.fetched_at`, `opportunities`
(`created_at`, `score`, statuses), latest `analyses` row per candidate (max id), `analyses.created_at`
for usage (`sum` of tokens, `null` when every row is null). Candidate query bounded by
`CANDIDATE_LIMIT`, ordered by score desc, so the work per request is bounded.

### Error model
No new error type: a database failure is a 500 like every other route; an invalid `minScore` is the
shared 400 from the Zod handler. Rows whose stored analysis JSON fails validation keep their
columns and get `nextAction: null`, `buyer: null` (shown as "brak").

### Web
`apps/web/src/TodayPage.tsx` (+ `TodayPage.module.css`) renders, in order: heading
`Dziś — DD.MM.YYYY`, health line (moved from `StatusView`), "Weryfikacja: …", "Nowe sygnały: n",
"Nowe okazje spełniające próg (≥ 65): n", "TOP n:" ordered list `[84/100] title — category — next step`
(title links to the card; DEMO / MOCK badge when `demo`), "Najlepszy następny krok: …",
"Koszt analizy dzisiaj: brak danych (tokeny: …)", "Na dziś: follow-up" list, "Błędy źródeł",
"Pomysły produktowe / słabe sygnały". Empty TOP → the FR-12 empty-state text with sources checked
and errors.

## Phases

### Phase 1: Digest API
- Files:
  - `packages/contracts/src/digest.ts`: new schemas. Contract: `DigestQuery`, `DigestItem`,
    `DigestToday` as in *Design*.
  - `packages/contracts/src/index.ts`: export them.
  - `apps/api/src/modules/digest/ports.ts`, `select.ts`, `service.ts`, `routes.ts`: as in *Design*.
    Contract: route `GET /api/digest/today`; invariant: `top.length <= 5`, no `top` item is weak,
    no item of `top` has more than 2 near-duplicates in `top`, `weakSignals` holds only weak items.
  - `apps/api/src/infrastructure/db/digest-repository.ts`: `createDigestRepository(db)`.
  - `apps/api/src/app.ts`: `AppDeps.digest: DigestDeps`; `registerDigestRoutes`.
  - `apps/api/src/server.ts`, `apps/api/test/helpers/app.ts`: wire the repository, the pipeline
    repository and the clock.
  - `apps/api/test/digest.int.test.ts`: one integration file, fake provider returning chosen
    analyses, `FakeClock`:
    1. fresh DB → empty TOP, zero counts, `sources` counts, `llm` tokens null (FR-12 AC1, FR-16 AC1);
    2. a seeded day: two enabled sources (one OK, one with a mocked 500 through a source run), signals
       today and yesterday, three near-identical direct requests, one lower-scored direct request, one
       higher-scored `EXPLICIT_PROBLEM`, one `PRODUCT_HYPOTHESIS`, one `SPECULATIVE`, one contacted with
       a follow-up due today → counts, TOP order (direct first), exactly 2 of the 3 near-duplicates,
       weak items only in `weakSignals`, `bestNextStep.kind = 'follow_up'`, `followUpsDue` holds the
       contacted row, source error listed (FR-16 AC1–AC3, FR-14 AC4);
    3. `minScore=90` narrows `top` and `newAboveThreshold`; `minScore=abc` → 400 (FR-10 AC6 for the brief).
- Proves: FR-16 AC1, AC2, AC3; FR-12 AC1 for Today's API; FR-14 AC4 (due follow-up in Today's data);
  integration level. The route-table 401 test and the OpenAPI comparison cover the new route
  automatically.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Today view
- Files:
  - `apps/web/src/api/digest.ts`: `fetchDigest(): Promise<DigestToday>` through the shared client.
  - `apps/web/src/TodayPage.tsx`, `apps/web/src/TodayPage.module.css`: the view in *Design*;
    phone-width layout without horizontal scroll (FR-11 AC4).
  - `apps/web/src/App.tsx`: `/` renders `TodayPage`; `StatusView` folds into it.
  - `apps/web/src/PipelinePage.tsx`: remove `DueFollowUps` (moved; the `Item` rendering is reused
    by exporting it or copied as a small list in Today, whichever keeps the diff smaller).
  - `apps/web/src/strings.pl.ts`: `nav.start` → `'Dziś'`; new `today` group; the due strings move
    from `pipeline` to `today`.
  - `e2e/vertical-main-path.spec.ts`: click "Dziś" instead of "Start"; also expect the
    "Nowe sygnały: 1" line and the "Na dziś: follow-up" heading (unchanged), keep `assertNoOverflow`.
- Proves: FR-16 AC1 rendered (e2e main path step), FR-11 AC4 for Today (360 px overflow assertion).
  The Today step's `evidence(...)` call writes to `context/changes/today-brief/evidence/today-360.jpg`
  (the helper takes the directory per call); the committed S-08 images are not touched.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`; then `E2E_EVIDENCE=1 pnpm e2e`
  once for the Today screenshot, followed by `git restore` of any other change's evidence file the
  run rewrote, so only `today-brief/evidence/` is committed.
- Human checks:
  - Open Today at 360 px and on a laptop with a few demo imports: sections in §11.1 order, wording
    reads naturally in Polish, the "wniosek modelu" label on next steps is clear.
  - With no opportunities: the empty-state text, source count and errors appear and nothing else
    pretends to be a lead.

## Risks and unknowns
- Jaccard 0.6 may be too strict or too loose for real Polish/English titles; it is one constant in
  `select.ts` (D-5). Real feeds are a human check, not a gate.
- `buyerOrAudience` is often null; then similarity rests on the title alone. Acceptable for AC2.
- The candidate cap (200, by score) could hide a direct request ranked below 200 higher-scored rows
  of the last 7 days; at the PRD's volume (≤ 20 analyses a day) the window holds at most ~140.
- `E2E_EVIDENCE=1` rewrites every screenshot of both specs, including other changes' committed
  ones; Phase 2 restores those files after the one evidence run. A plain `pnpm e2e` writes nothing.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Digest API
- [x] Phase 2: Today view

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->
- [ ] (Phase 2) Today at 360 px and on a laptop with a few demo imports: sections in §11.1 order, Polish wording reads naturally, the "wniosek modelu" label on next steps is clear — run: `docker compose up --build`, log in, open `/` after importing a few DEMO posts on `/import` — evidence: `context/changes/today-brief/evidence/today-360.jpg` (360 px, one contacted lead with a follow-up due)
- [ ] (Phase 2) With no opportunities: the empty-state text, source count and errors appear and nothing else pretends to be a lead — run: open `/` on a fresh database — evidence: none (asserted by `e2e/smoke.spec.ts` step 1)

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] Phase 1 integration tests seed `raw_signals`, `opportunities`, `analyses` and `sources` rows directly instead of running a fake provider: scores come from the scoring rules, so chosen scores/categories are only reachable by writing the stored rows the read model reads. The digest query is what is under test.
- [minor] `toItem` is exported from `modules/pipeline/service.ts` and reused by the digest service (plan-review 8); `type SourceError` is now exported from the contracts (it was only a value).
- [minor] The digest service takes `PipelineRepository` and `Clock` as `DigestDeps`; `isDemo` of the opportunities module is private, so the digest compares the provider with `'mock'` itself.
- [REVIEW] plan-review 4: Phase 1 covers FR-10 AC6 for the brief only for the minimum score (D-8); excluded industries, source age, amount, job type, language and geography are not applied to the brief. The PR must state this partial coverage. Alternative: accept the list's filter subset in `DigestQuery`.
- [FOLLOW-UP] Persisted filters (FR-10 AC6) applied to the brief once they exist.
- [minor] plan-review 2, 3, 5 concern Phase 2 and are answered there: the main path asserts `/Nowe sygnały: \d+/` (not a hard-coded 1), the smoke step asserts the empty-state text on `/`, and `evidence` gets an optional directory argument so the S-08 `today-360.jpg` is restored, not overwritten.
- [FOLLOW-UP] FR-09 AC3 wants the brief to show how much work waits for the next day when a daily
  limit is reached; `AnalysisServiceStatus.waiting` exists, but limits belong to S-05. Add the count
  to `DigestToday` there.
- [FOLLOW-UP] A plain-text rendering of the brief (D-1 B) when Telegram/e-mail notifications (FR-29)
  are built.

- [minor] Phase 2: `Item` of `PipelinePage.tsx` is exported and reused for the due follow-ups (smaller diff than a copy); the strings `dueTitle` / `dueNone` moved to the `today` group, `dueLoadFailed` was dropped (the digest has one load-failure text). The health line loads independently of the digest, so a failing digest keeps it visible.
- [minor] Phase 2: with a non-empty TOP the "Błędy źródeł" section follows the follow-ups; with an empty TOP the errors are part of the FR-12 empty-state block, so they are not repeated.
- [minor] Phase 2: the e2e `evidence()` of the main path takes an optional directory; the Today screenshot goes to `today-brief/evidence/`, and the S-08 `today-360.jpg` stays as committed (now stale, showing the old Start view). The evidence run rewrote other changes' screenshots, which were restored with `git restore`.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
