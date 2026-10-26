# Plan: insights (S-14)

## Goal and end state
The operator sees whether the work pays: per ISO week (Europe/Warsaw) and per calendar month,
numbers that come only from recorded facts, never filled-in zeros or assumed outcomes.

Observably true when done:
- `GET /api/insights?week=YYYY-Www` (default: the current week) and
  `GET /api/insights?month=YYYY-MM` return, for that period: stage transitions (total and per
  target stage), offers sent, contacts, replies with a reply rate, meetings, wins, payments
  received (count and sum per currency), and the same metrics per source and per category
  (FR-19 AC1).
- A metric that cannot be computed is `null` in the API and "brak danych" in the UI: a reply
  rate without any contact whose outcome is known, a payment sum without payments; nothing is
  shown as 0 PLN or 0 % by assumption (FR-19 AC2).
- The monthly view sums revenue per currency without conversion; time spent and costs appear
  only when the operator entered them on an opportunity, and the result (revenue minus entered
  costs) only for currencies with entered costs (FR-19 AC3).
- The operator can record time spent and/or a cost on the opportunity card
  (`POST /api/opportunities/:id/work`); it appears in the history (D-6).
- A *Wyniki* view (`/wyniki`) shows the week and month with previous/next navigation, usable
  at 360 px.

## Scope
- In: `GET /api/insights` (week and month); ISO-week helpers in Europe/Warsaw; time and cost
  entries on an opportunity (API, card form, history line); the *Wyniki* view and nav link; one
  step in the e2e main path; README *Co działa*.
- Out: LLM cost in Insights (already reported by S-05/S-13; `[FOLLOW-UP]` if wanted); contract
  values of wins; editing/deleting work entries (like payments, S-08 D-10); charts; per-source
  breakdown of time and costs; currency conversion (never); backdating work entries (D-7).

## Findings
- Roadmap *Decided up front*: weeks are ISO weeks in Europe/Warsaw (`context/roadmap.md:268`).
- Test budget: TR-15 (insights "brak danych", per-currency sums) is a `none` risk
  (`context/test-plan.md:50`), so per the budget one or two integration tests for the API main
  path, no unit-test suite for the calculator; e2e stays at 2 specs (extend
  `e2e/vertical-main-path.spec.ts`, do not add a spec).
- Facts available:
  - Status changes: `activity_events` (`apps/api/src/infrastructure/db/schema.ts:228`), type
    `STATUS_CHANGE`, `actor` `operator`/`system`, `from_status`, `to_status`, `occurred_at`
    (server time, S-08 D-6), `metadata_json` = `ActivityMetadata` for operator rows
    (`packages/contracts/src/opportunities.ts:273`) with `skipped` stages; system rows store an
    `ActivityCause` (pre-filter rejections, insufficient data) and only move rows out of `NEW`.
  - Contacts: S-08 D-9 counts an opportunity as contacted when an operator status event goes to
    `CONTACTED|REPLIED|MEETING|WON|LOST` or skips `CONTACTED`
    (`apps/api/src/infrastructure/db/pipeline-repository.ts:8,98-109`, `json_each` guarded by
    `json_valid`).
  - Offers sent: `offer_drafts.status = 'SENT_MANUALLY'`; `SENT_MANUALLY` is terminal (S-07 D-3),
    so `status_changed_at` is the sent time (`schema.ts:309-345`,
    `apps/api/src/infrastructure/db/offer-draft-repository.ts:64`). "Oznacz jako wysłane" also
    moves the opportunity forward to `CONTACTED` (S-07 D-4, `modules/offers/service.ts:288`).
    S-07 left `[FOLLOW-UP] S-14: "sent" should count SENT_MANUALLY drafts`
    (`context/changes/offer-drafts/plan.md:387`).
  - Payments: `payments(amount_minor, currency PLN|EUR|USD, paid_at = Warsaw midnight of the day
    paid)` (`schema.ts:290`), append-only, independent of `WON`.
  - Wins: `WON` events; `WON → LOST` (correction) and back moves are allowed with a note
    (`packages/contracts/src/status.ts` `checkMove`).
  - Source of an opportunity: its primary signal's `source_id` (null for manual imports) and
    `source_type` (`manual_text|manual_url|manual_fetch|rss|bzp|ted`); sources are never deleted
    (no delete route in `modules/sources/routes.ts`). Later signals of other sources attach to
    the same opportunity through `signal_identities` (first seen owns it, D-14 of S-03).
  - Category: `opportunities.category`, null while the analysis is pending/failed.
- Nothing stores time spent or costs today (data model in `context/prd.md:268-290` has neither);
  AC3 "shown only if entered" needs a way to enter them (D-6).
- Warsaw helpers: `startOfWarsawDay`, `startOfWarsawMonth`, `warsawDateToInstant`,
  `instantToWarsawDate` (`apps/api/src/modules/shared/warsaw-day.ts`), with DST cases in
  `warsaw-day.test.ts`. ISO weeks need new helpers; computing on calendar dates and converting
  with `warsawDateToInstant` keeps DST out of the arithmetic.
- Module pattern to copy: `modules/digest/{ports,routes,service}.ts` +
  `infrastructure/db/digest-repository.ts`, wired in `apps/api/src/app.ts:40-41`,
  `apps/api/src/server.ts:156-160`, `apps/api/test/helpers/app.ts:213-217`; the response is
  parsed with its contract before it is returned (`modules/digest/service.ts:62`).
  The OpenAPI drift test and the route-table 401 test (TR-13) pick up new routes by themselves.
- Web: routes and nav in `apps/web/src/App.tsx:23-46`; API wrappers in `apps/web/src/api/*.ts`;
  all Polish text in `apps/web/src/strings.pl.ts`; money input `inputToMinor` in
  `apps/web/src/profileForm.ts`; the card's follow-up and payment forms live in
  `apps/web/src/CardPipeline.tsx`; history lines in `apps/web/src/opportunityCard.ts`.
- Indexes: `activity_events` is indexed by `(opportunity_id, occurred_at)` only, `payments` by
  `(opportunity_id, paid_at)`. A week query scans these small tables; no new index (Risks).

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | API shape | One route `GET /api/insights` with exactly one of `week=YYYY-Www` or `month=YYYY-MM` (none → current ISO week; both → 400). Response `Insights` (Design) is the same for both kinds, tagged by `period.kind` | B: two routes `/api/insights/weekly` and `/monthly` (clearer names, but the PRD §15 names one route); C: arbitrary `from`/`to` ranges (flexible, but weeks would no longer be ISO weeks) | PRD §15 lists `GET /api/insights`; one calculator serves both periods | costly (public API) | prd + agent |
| D-2 | What a "stage transition" is | Every operator `STATUS_CHANGE` event in the period, counted per event (a back-and-forth counts twice), plus a per-target-stage breakdown `transitionsTo` in the totals. System moves (pre-filter rejections, insufficient data) are excluded | B: include system moves (would bury the funnel under automatic `NEW → REJECTED`); C: distinct opportunities per stage (hides corrections) | §10.3 is about the operator's funnel work; a system move is not a sales step | cheap | agent |
| D-3 | "Offers sent" vs. contacts | Two separate numbers: `offersSent` = drafts that reached `SENT_MANUALLY` in the period (by `status_changed_at`, the S-07 follow-up); `contacted` = opportunities whose **first** recorded contact (S-08 D-9 rule) falls in the period. The reply rate uses `contacted` as its cohort | B: one number from drafts only (misses messages the operator wrote without a draft, which "Oznacz jako kontakt" records); C: one number from contacts only (ignores the PRD's "offers sent") | Both are recorded facts and mean different things; keeping them apart never makes one imply the other (as S-08 D-9) | cheap | agent + prd |
| D-4 | Reply rate without assuming outcomes (AC2, §10.3 "nie zakłada porażki") | Cohort = opportunities first contacted in the period. Each is, as of now: `replied` (any operator event, at any time, to `REPLIED`, `MEETING` or `WON`, or with `REPLIED` in `skipped`), `noReply` (not replied and now `LOST`, `REJECTED` or `EXPIRED`), else `awaiting`. `rate = replied / (replied + noReply)`, `null` when that is 0. The UI shows "2 z 3 z wynikiem (1 bez wyniku)" next to the percentage | B: `replied / contacted` (always computable, but counts every unanswered contact as a failure, which §10.3 forbids); C: replies in the period / contacts in the period (mixes cohorts, can exceed 100 %) | Only known outcomes enter the rate; the awaiting count shows how much is unknown. A past week's rate can still change as outcomes arrive, which the UI says | cheap | prd + agent |
| D-5 | Meetings, wins and "brak danych" for counts | `meetings` = distinct opportunities with an operator event to `MEETING` (or `MEETING` skipped) in the period; `wins` = distinct opportunities whose **latest** `WON` event is in the period **and** current status `WON` (a later correction removes it; a re-win counts in the week of the last one only, plan-review 8). Counts of recorded events are shown as numbers (0 is a true count of records); sums and rates that have no input are `null` → "brak danych". `payments.sums` is `[]` with `count: 0`, shown as "brak danych", never "0 zł" | B: whole period "brak danych" when it has no records at all (hides real zero activity); C: wins from events only (a corrected win still counts) | Matches TR-15 ("zero offers → brak danych", per-currency sums) without hiding that nothing was recorded | cheap | agent |
| D-6 | Where time spent and costs are entered (AC3) | New operator activity event type `WORK` on an opportunity: `POST /api/opportunities/:id/work { minutes?, cost?: { amountMinor, currency }, note? }`, at least one of `minutes`/`cost`; minutes 1…100 000, cost bounds as `PaymentRequest`. Stored in `activity_events` (`type = 'WORK'`, `metadata_json = { minutes?, cost? }`, validated by `ActivityMetadata` before insert, lesson). `ActivityEvent` gains type `WORK` and `work: { minutes, cost } \| null`. No migration | B: a `work_entries` table (plain SQL sums, but a migration and a second place for operator events); C: no entry, monthly view always says "nie wpisano" (cheapest, but AC3's condition could never be met) | Additive in the existing event log; the PRD data model already says events carry metadata; dropping the feature means ignoring one type | costly (stored JSON shape, public API) | agent |
| D-7 | Date of a work entry | Server time (`occurred_at = now`), like status events (S-08 D-6); no backdating | B: an optional `on` date (entries made at month end land in the right month, but history order and a second date field) | Additive later; consistent with every other operator event | cheap | agent |
| D-8 | Per-source attribution | An opportunity counts under the source of its **primary** signal only: `{ kind: 'source', id, name, type }` for `source_id`, one bucket `{ kind: 'manual' }` for all `manual_*` imports. A later signal from another source never moves or duplicates it. Groups appear only when they have a non-zero metric in the period | B: count under every source that saw it (sums of groups exceed the totals); C: per `source_type` (merges two RSS feeds the operator wants to compare) | Lesson "a second source that disagrees": decided here and tested (Phase 1); groups then sum to the totals | cheap | lesson + agent |
| D-9 | Per-category attribution | `opportunities.category` as stored now; `null` (analysis pending/failed) is its own group "bez kategorii" | B: drop uncategorised rows from the breakdown (groups no longer sum to the totals) | Nothing disappears; the group is honest about missing analysis | cheap | agent |
| D-10 | Time and costs in the response | `work: { minutes: int \| null, costs: [{ currency, totalMinor }], net: [{ currency, totalMinor (may be negative) }] }` for both period kinds, totals only. `minutes` is `null` when no entry has minutes; `costs`/`net` are `[]` without costs; `net` = payments − entered costs, only for currencies with entered costs. The UI shows the block only when something was entered (AC3) | B: monthly only (the PRD names it for the month; a second shape for one route); C: profit as one number (would need conversion) | One shape keeps the calculator simple; nothing is shown that was not entered | costly (public API shape; with D-1, D-4, D-8 it is the `Insights` contract, kept in `packages/contracts/src/insights.ts`) | agent |
| D-11 | ISO-week validation and range | `week` matches `^(\d{4})-W(\d{2})$`, week 01…52/53 by the year's real week count, year 2000…2100; `month` `^(\d{4})-(0[1-9]\|1[0-2])$`, same years; a future period is allowed and simply has no records. `period` returns `from`/`to` (inclusive Warsaw calendar days), `previous`/`next` keys (`null` outside 2000…2100) and `current` (the period contains today) | B: refuse future periods with 400 (the UI already stops at the current one) | Bounded and serialisable (lesson on serialisable dates); simplest | cheap | agent |
| D-12 | UI | Route `/wyniki`, nav "Wyniki" after "Lejek". Tabs "Tydzień" / "Miesiąc", previous/next buttons (next disabled at the current period), a metrics list for the totals, then tables "Według źródła" and "Według kategorii" in a container that scrolls horizontally on its own (no page scroll at 360 px). The work form "Czas i koszty" sits on the card next to the payment form (hours as decimal input → minutes, cost via `inputToMinor`) | B: charts (a library and more review for a handful of numbers); C: per-group cards instead of tables (no scroll, but hard to compare sources) | Brief §11 item 7 "proste KPI i tygodniowe podsumowania" | cheap | agent |

## Design

### Contracts (`packages/contracts`)
- `insights.ts` (new):
  - `InsightsQuery = { week?: IsoWeek, month?: IsoMonth }` strict; refine: not both (D-1, D-11).
  - `InsightsMetrics = { transitions, offersSent, contacted, replies: { replied, noReply,
    awaiting, rate: number 0…1 | null }, meetings, wins, payments: { count, sums: PaidSum[] } }`.
  - `InsightsSource = { kind: 'source', id, name, type: SourceType } | { kind: 'manual' }`.
  - `Insights = { period: { kind: 'week' | 'month', key, from, to, previous, next },
    totals: InsightsMetrics, transitionsTo: [{ status, count }], bySource: [{ source, metrics }],
    byCategory: [{ category: Category | null, metrics }], work: { minutes, costs, net } }`.
- `status.ts`: `WorkRequest` (D-6), refine at least one of `minutes`/`cost`.
- `opportunities.ts`: `ActivityMetadata` + `minutes?`, `cost?`; `ActivityEvent.type` + `'WORK'`,
  field `work: { minutes: int | null, cost: { amountMinor, currency } | null } | null`.

### Period helpers (`apps/api/src/modules/shared/warsaw-day.ts`)
- `isoWeekOf(date: 'YYYY-MM-DD') → { year, week }`, `isoWeekStartDate(year, week) →
  'YYYY-MM-DD'` (Monday), `isoWeeksInYear(year)`; pure calendar arithmetic on UTC dates, then
  `warsawDateToInstant` for the bounds `[from, nextFrom)`.

### Data flow (`modules/insights`, `infrastructure/db/insights-repository.ts`)
- Repository returns plain fact rows for `[from, to)` (UTC ms), each with the opportunity's
  attribution (`sourceId`, `sourceName`, `sourceType`, `category`, `businessStatus`):
  `statusEvents(from, to)` (operator `STATUS_CHANGE` in range, with `toStatus` and `skipped`),
  `firstContacts(from, to)` (opportunities whose first contact event is in range, plus
  `replied: boolean` over all their events), `sentDrafts(from, to)`, `payments(from, to)`,
  `workEntries(from, to)`. `skipped` is read with `ActivityMetadata.safeParse`; unreadable
  metadata counts as no skipped stages.
- `calculate.ts`: pure `calculateInsights(facts) → { totals, transitionsTo, bySource,
  byCategory, work }` applying D-2…D-10; groups keyed by attribution, sorted by name/category.
- `service.ts`: resolves the query to a period with the clock (current ISO week by default),
  calls the repository and calculator, parses with `Insights` before returning.
- `routes.ts`: `GET /api/insights` with `querystring: InsightsQuery`, `200: Insights`,
  `400: ValidationError`.
- Work entry: `opportunities/service.ts` `addWork(id, request)`, `activity-repository.ts`
  `addWork(id, metadata, note, at)`, `routes.ts` `POST /api/opportunities/:id/work` → 200
  `OpportunityDetail` / 400 / 404 (like payments). Notes never logged.

### Web (`apps/web`)
- `api/insights.ts`, `InsightsPage.tsx` + `.module.css`, route and nav in `App.tsx`.
- `CardPipeline.tsx`: "Czas i koszty" form; `opportunityCard.ts`: `WORK` history line
  ("Czas: 1 h 30 min · koszt: 120,00 zł").
- `strings.pl.ts`: all new Polish text; percentages and sums formatted per currency.

## Phases
### Phase 1: Insights API for weeks and months
- Files:
  - `packages/contracts/src/insights.ts` (new), `packages/contracts/src/index.ts`: contracts of
    the Design. Contract: `InsightsQuery`, `Insights`.
  - `apps/api/src/modules/shared/warsaw-day.ts`: ISO-week helpers. Contract: `isoWeekOf`,
    `isoWeekStartDate`, `isoWeeksInYear`.
  - `apps/api/src/modules/shared/warsaw-day.test.ts`: rows for the existing table only: the week
    containing 2026-10-25 (DST end, Sunday of W43), 2026-12-31 → 2026-W53, 2027-01-01 →
    2026-W53, 2027-W01 starts 2027-01-04.
  - `apps/api/src/modules/insights/{ports,calculate,service,routes}.ts` (new): D-1…D-5, D-8,
    D-9, D-11 (the `work` block returns `{ minutes: null, costs: [], net: [] }` until Phase 2).
  - `apps/api/src/infrastructure/db/insights-repository.ts` (new): fact queries.
  - `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/test/helpers/app.ts`: wiring.
  - `apps/api/test/insights.int.test.ts` (new), fake clock in week 2026-W44: (1) empty database
    → counts 0, `replies.rate` null, `payments.sums` [] (AC2); (2) a seeded week through the
    public routes: two opportunities from two RSS sources and one manual import; moves
    `SAVED → CONTACTED` (skips `OFFER_DRAFTED`), `→ REPLIED → MEETING → WON`; one contacted and
    `LOST`; one contacted and awaiting; payments in PLN and EUR → exact totals, `transitionsTo`,
    `replies { replied: 1, noReply: 1, awaiting: 1, rate: 0.5 }`, sums per currency never
    merged, the same metrics per source and per category summing to the totals, a pre-filter
    system rejection not counted (AC1); (3) a second source's signal attached to an
    opportunity leaves it under the primary source (D-8, lesson); (4) a `WON → LOST` correction
    removes the win; (5) `?month=2026-10` sums only October payments; `?week=2026-W54`,
    `?week=2026-W44&month=2026-10` → 400.
- Proves: FR-19 AC1, AC2, AC3 (revenue per currency) at integration level.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Time and cost entries
- Files:
  - `packages/contracts/src/status.ts`: `WorkRequest`. Contract: D-6.
  - `packages/contracts/src/opportunities.ts`: `ActivityMetadata.minutes?`, `.cost?`;
    `ActivityEvent.type` + `WORK`, field `work`.
  - `apps/api/src/infrastructure/db/activity-repository.ts`: `addWork`.
  - `apps/api/src/modules/opportunities/{ports,service,routes}.ts`: `POST
    /api/opportunities/:id/work`; `toActivity` maps `work` (null for other types).
  - `apps/api/src/infrastructure/db/insights-repository.ts`, `modules/insights/calculate.ts`:
    `workEntries`, the `work` block (D-10).
  - `apps/api/test/insights.int.test.ts`: case "a month without entries has `minutes: null`,
    `costs: []`, `net: []`; after entering 90 min and a 120,00 PLN cost on one opportunity and
    a 50,00 EUR cost on another, `minutes: 90`, costs per currency, `net` = PLN payments −
    12000 and EUR payments − 5000, nothing for USD"; `{}` and `minutes: 0` → 400; the entry
    appears in the opportunity's history.
  - `apps/api/test/opportunity-actions.int.test.ts`: only if a shape it asserts changed (new
    `work` field); never weaken an assertion.
- Proves: FR-19 AC3 (integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 3: Wyniki view
- Files:
  - `apps/web/src/api/insights.ts` (new): `getInsights({ week } | { month })`.
  - `apps/web/src/InsightsPage.tsx`, `InsightsPage.module.css` (new): D-12; "brak danych" for
    every `null` and for an empty `sums`; reply line "X z Y z wynikiem (Z bez wyniku)"; work
    block only when entered.
  - `apps/web/src/App.tsx`: route `/wyniki`, nav "Wyniki".
  - `apps/web/src/strings.pl.ts`: Insights strings.
  - `e2e/vertical-main-path.spec.ts`: after the payment step, open "Wyniki" and assert the
    payment sum of the current week and "brak danych" for the reply rate (the contact is still
    awaiting).
- Proves: FR-19 AC1, AC2 in the UI (e2e step).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`; `pnpm e2e` runs in `/review`.
- Human checks: *Wyniki* at 360 px: totals readable, the per-source table scrolls inside its
  box without page scroll; wording of the reply line and of "brak danych".

### Phase 4: Time and cost form on the card, docs
- Files:
  - `apps/web/src/CardPipeline.tsx`: "Czas i koszty" form (hours `1,5` → 90 min, cost amount +
    currency, note); errors shown like the payment form.
  - `apps/web/src/api/opportunities.ts`: `addWork`.
  - `apps/web/src/opportunityCard.ts`: `WORK` history line.
  - `apps/web/src/strings.pl.ts`: form and history strings.
  - `README.md`: *Co działa* gains Insights and time/cost entries.
- Proves: FR-19 AC3 entry path in the UI (human check; the API is covered in Phase 2).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: enter "1,5" h and "120" PLN on a card → history shows the entry and *Wyniki* →
  Miesiąc shows 1 h 30 min, the cost and the result in PLN only.

## Risks and unknowns
- The reply rate of a recent week rises as outcomes are recorded (D-4); the UI says so. If the
  operator never closes unanswered contacts, the rate stays "brak danych" or optimistic; the
  awaiting count makes that visible.
- `activity_events` and `payments` have no index on time alone; with the expected volume (tens
  of events a week, NFR-02 measured with 10 000 signals) a scan is cheap. If a Pi measurement
  shows otherwise, an index is an additive migration (`[FOLLOW-UP]` then).
- Every number is derived on read from events, drafts and payments that earlier items already
  store, so existing data needs no backfill; operator events stored before S-08 have no
  `skipped` and count by `to_status` only.
- Week 2026-W44 (26 Oct – 1 Nov) spans two months; the Phase 1 month case puts one payment on
  31 October and one on 1 November to prove the bounds.
- Week keys near year ends (W53, 1 January in the previous ISO year) are the most likely
  off-by-one; covered by the helper rows in Phase 1.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Insights API for weeks and months
- [x] Phase 2: Time and cost entries
- [ ] Phase 3: Wyniki view
- [ ] Phase 4: Time and cost form on the card, docs

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] (Phase 1) Plan says the repository returns status events for `[from, to)`; the first contact and the reply of a cohort need an opportunity's earlier events, so `operatorStatusEvents()` returns every operator status change (oldest first) and `calculate.ts` filters by range. Consequence: one scan of `activity_events` per request (tens of events a week; see Risks).
- [minor] (Phase 1) `isoWeeksInYear` lives in `packages/contracts/src/insights.ts` (the query schema needs it to refuse `2027-W53`) and `warsaw-day.ts` re-exports it; `addCalendarDays` was added to `warsaw-day.ts` for the period bounds.
- [minor] (Phase 1) Plan-review 7: the five integration cases are three `it` blocks (empty and 400s; the week main path with month bounds, offers sent, system rejection; primary source and `WON → LOST`). The ISO-week helper rows stay because a year end is where the week number and week-year disagree with the calendar (2026-W53, 2027-W01). The `SENT_MANUALLY` draft is produced in the main-path case, which answers plan-review 1 for the API; the Phase 3 e2e step should also assert `offersSent` 1.
- [minor] (Phase 1) Plan-review 6: payments are dated by advancing the fake clock (31 October, then 1 November) because a future `paidOn` is refused.
- [minor] (Phase 2) Plan-review 3: `apps/web/src/opportunityCard.test.ts` gets `work: null` on its `ActivityEvent` literal (the new required field); no assertion changed.
- [minor] (Phase 2) `WorkCost` is defined once in `status.ts` and reused by `ActivityMetadata` and `WorkRequest`; an unreadable `WORK` metadata row counts as no entry. The `OpportunityPage` history label for `WORK` stays in Phase 4 (plan-review 4).

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
