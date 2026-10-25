# Plan: pipeline-and-payments (S-08)

## Goal and end state
The vertical slice is complete (brief phase 1 DoD): from an imported, analysed opportunity the
operator moves it through the §10.1 stages, records contact, a follow-up date, a win with
contract value and real payments, and sees a simple Pipeline view.

Observably true when done:
- `POST /api/opportunities/:id/status` accepts every §10.1 status except `NEW` and enforces the
  user's transition rule (roadmap *Decided up front*); each change is an `activity_events` row
  with time, optional note and the stages it skipped; `analysisStatus` is never touched
  (FR-14 AC1).
- A rejection needs a §10.2 reason, `OTHER` needs a note (FR-14 AC2, kept from S-06).
- `WON` can carry contract value (integer minor units), currency and expected start/end dates;
  it creates no payment (FR-14 AC3).
- The operator sets a follow-up date on a contacted opportunity; on that date (and after, until
  cleared) it is listed under "Na dziś" on the start view; nothing is sent (FR-14 AC4).
- `POST /api/opportunities/:id/payments` records a payment (amount in minor units > 0, PLN/EUR/USD,
  date, note) as its own row, in any status, independent of `WON` (FR-15 AC1).
- `GET /api/pipeline` and the Pipeline view count contacted, won and paid separately, with paid
  sums per currency (FR-15 AC2).
- `e2e/main-path.spec.ts` passes: import → analysis (mock) → card → contacted (+ follow-up) →
  payment, at 360 px (D-13 explains the draft step).

## Scope
- In: full transition table; status form on the card (incl. "Oznacz jako kontakt", WON contract
  fields, back-move note); follow-up date; payments (record, list); `GET /api/pipeline`;
  Pipeline view (`/lejek`); "Na dziś" follow-up list on the start view; the main-path e2e spec.
- Out: offer drafts and the `SENT_MANUALLY` follow-up suggestion (S-07, see D-12); Today brief
  and `/api/digest/today` (S-13); weekly/monthly insights (S-14); editing or deleting payments
  and notes (D-10); backdating status events (D-6); delete of opportunities (S-15).

## Findings
- Status rule today: `operatorMoves(status)` in `packages/contracts/src/status.ts:23` allows only
  `SAVED`/`REJECTED`; the comment says S-08 replaces it. Used by the API
  (`apps/api/src/modules/opportunities/service.ts` `changeStatus`) and the web
  (`apps/web/src/CardActions.tsx:31`).
- `StatusChangeRequest` (`packages/contracts/src/status.ts:35`) is a discriminated union on
  `status` with `SAVED` and `REJECTED` (+ refine: `OTHER` needs a note). S-06 D-5 planned to widen
  it additively.
- `activity_events` (`apps/api/src/infrastructure/db/schema.ts`, migration 0005) already has
  `type`, `actor`, `from_status`, `to_status`, `reason`, `note`, `metadata_json`, `occurred_at`;
  the comment says S-08 adds event types. System events store `ActivityCause`
  (`{ kind: 'prefilter', rule } | { kind: 'insufficient_data' }`) in `metadata_json`
  (`packages/contracts/src/opportunities.ts:180`); the service parses it for every row
  (`service.ts` `toActivity`).
- `createActivityRepository.changeStatus` (`apps/api/src/infrastructure/db/activity-repository.ts`)
  already reads the status, calls `allowed(from)`, updates conditionally on the read status and
  inserts the event in one transaction; the `to` type is `'SAVED' | 'REJECTED'`.
- System moves (`analysis-repository.ts:30`) only move a row from `NEW` (to `REJECTED` or
  `NEEDS_VERIFICATION`); they never touch rows the operator moved. No code sets `QUALIFIED`.
- The 409 body is a strict literal `{ error: 'transition_not_allowed' }`
  (`apps/api/src/modules/opportunities/routes.ts`).
- Money input: `inputToMinor` / `minorToInput` in `apps/web/src/profileForm.ts:33-40` (string
  arithmetic, D-7 of operator-profile); `Currency` enum in `packages/contracts/src/profile.ts:10`.
- Warsaw days: `startOfWarsawDay(instant)` in `apps/api/src/modules/shared/warsaw-day.ts` (tested
  in `warsaw-day.test.ts`); web has `apps/web/src/warsawTime.ts`.
- The card has disabled "Przygotuj ofertę" and "Oznacz jako kontakt" buttons (S-06 D-13,
  `CardActions.tsx`). The start route `/` renders only `StatusView` (`apps/web/src/App.tsx`).
- e2e: one server for all specs (`playwright.config.ts`, one temp `DATA_DIR`); the login throttle
  allows 5 attempts per 15 min for all clients and `e2e/smoke.spec.ts` already uses 4
  (`e2e/env.ts` comment). The main-path spec may log in exactly once and must import a text that
  differs from the smoke spec's post (shared database).
- Test budget (`context/test-plan.md`): TR-14 is a `test` risk (transition table, payment as a
  separate event, sent/won/paid separate); TR-04 (no outbound call in pipeline flows) is a `test`
  risk owned partly by S-08; e2e at most 2 specs, the main path being the second.
- S-07 (offer drafts) is not done; S-08 depends only on S-06 in the roadmap, but its acceptance
  names a draft step in the e2e main path.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | The transition rule (user rule, exact reading) | Pure `checkMove(from, to)` in `packages/contracts/src/status.ts`, shared by API and web, returning `{ allowed: false } \| { allowed: true, kind: 'forward' \| 'back' \| 'aside', skipped: BusinessStatus[], noteRequired: boolean }`. Main path ranks `NEW 0, QUALIFIED 1, SAVED 2, OFFER_DRAFTED 3, CONTACTED 4, REPLIED 5, MEETING 6, WON/LOST 7`. Rules: `to = from` never; `to = NEW` never (system start state); `REJECTED`, `EXPIRED`, `NEEDS_VERIFICATION` from any other status (`aside`, no note); `WON`/`LOST` only from `CONTACTED`, `REPLIED`, `MEETING` (forward) or from each other (`back`, note); another main stage: rank up = `forward`, rank down = `back` (note); leaving `NEEDS_VERIFICATION` = `forward`; leaving `REJECTED`/`EXPIRED` = `back` (reopen, note). `skipped` = main stages strictly between the ranks on a forward move from a main stage, else `[]`. `operatorMoves` is removed | B: an explicit 12×12 allow table (every cell visible, but the user's rule is a rule, and a table invites drift from it); C: "WON/LOST only after CONTACTED" read as "ever contacted" from history (closer to the words, but the rule then depends on history and the client cannot compute it) | Follows the user's rule; one pure function is the TR-14 unit-test target and the only place to change | cheap | user (roadmap) + agent |
| D-2 | How skipped stages are stored | In the event's `metadata_json` as `{ "skipped": [...] }` (written at move time, never derived on read). `metadata_json` becomes one stored object `ActivityMetadata`: system rows keep their existing `{ kind, ... }` (ActivityCause); operator rows use `{ skipped?, contract? }`. The service parses by `actor`. The DTO `ActivityEvent` gains `skipped: BusinessStatus[]` and `contract: Contract \| null` | B: one extra `STATUS_CHANGE` row per skipped stage (history reads like real moves, but invents moves that never happened); C: derive from from/to on read (no storage, but a later rank change would rewrite old history) | The user asked for skipped stages in the history; storing what was skipped is honest and stable | costly (stored JSON shape, API DTO) | agent |
| D-3 | Where WON contract data lives | In the `WON` event's `metadata_json.contract = { valueMinor, currency, expectedStartOn?, expectedEndOn? }` (PRD data model: "metadata (e.g. contract value for a win)"); all optional as a group, value > 0 and currency required together, end ≥ start. The card shows the latest WON event's contract | B: columns on `opportunities` (`contract_value_minor`, ...; easy SQL for S-14, but a second copy of event data and a wider migration); C: a `contracts` table (most structured; more than the MVP needs) | PRD names this place; additive; S-14 can read the latest WON event per opportunity | costly (stored data shape) | prd |
| D-4 | Status request shape | `StatusChangeRequest` widened additively: `{ status: 'REJECTED', reason, note? }` (unchanged), `{ status: 'WON', note?, contract? }`, and `{ status: <any other target>, note? }`. A back move without a note answers 409 `{ error: 'note_required' }`; an illegal move 409 `{ error: 'transition_not_allowed' }` (409 body becomes an enum of the two) | B: 400 for a missing note (a validation error, but the body alone cannot tell; the rule needs the stored status); C: one endpoint per status (S-06 D-5 rejected it) | Keeps S-06's route and shapes; the client already knows `noteRequired` from D-1 and asks first | costly (public API) | agent |
| D-5 | Calendar dates (follow-up, payment date, expected dates) | API and UI use `YYYY-MM-DD` meaning a Europe/Warsaw calendar day. Columns that are queried (`opportunities.follow_up_at`, `payments.paid_at`) store the UTC epoch ms of that day's Warsaw midnight (new helpers `warsawDateToInstant` / `instantToWarsawDate` next to `startOfWarsawDay`). Expected dates in the WON metadata stay `YYYY-MM-DD` strings | B: store `YYYY-MM-DD` text everywhere (simplest, but breaks the "UTC in the database" rule literally); C: store full instants from the client (keeps time of day nobody entered) | Honors CLAUDE.md, compares with `startOfWarsawDay(now)` directly, reuses the tested DST trick | costly (persisted) | agent |
| D-6 | Time of a status event | Server time (`clock.now()`), as in S-06. No backdating in this item | B: optional `occurredAt` on every status change (brief §10.2 "data kontaktu"; more validation and a non-monotonic history) | Additive later; the follow-up date covers the "next contact" half of §10.2 now | cheap | agent |
| D-7 | Follow-up model | Column `opportunities.follow_up_at INTEGER NULL` (+ index) holds the one current follow-up; `PUT /api/opportunities/:id/follow-up { on: 'YYYY-MM-DD' \| null }` sets or clears it and writes a `FOLLOW_UP` activity event with `metadata_json = { on }` (null = cleared). Allowed while status ∈ `CONTACTED`, `REPLIED`, `MEETING` (else 409 `transition_not_allowed`); dates in the past are refused (400). A move to `WON`, `LOST`, `REJECTED`, `EXPIRED` clears it in the same transaction | B: follow-ups only as events (no column; "due today" becomes a scan of events); C: a `follow_ups` table with several open reminders (CRM-like, beyond §10.2) | One reminder per opportunity matches §9.3/§10.2; the column makes the due query one index scan; additive | costly (migration, public API) | agent |
| D-8 | Where due follow-ups appear "in Today" before S-13 | `GET /api/pipeline` returns `followUpsDue` (follow_up_at ≤ start of today in Warsaw, open stages, overdue first); the start view `/` shows them as "Na dziś: follow-up" under the server status. S-13 moves the list into the Today brief | B: a separate `GET /api/follow-ups/due` (cleaner split, one more route for S-13 to fold away); C: wait for S-13 (AC4 would not be met in this item) | AC4 is in scope; one endpoint for the new data | cheap | agent |
| D-9 | What "sent, won, paid" count in this item (FR-15 AC2) | `GET /api/pipeline` `totals`: `contacted` = distinct opportunities with a `STATUS_CHANGE` event to `CONTACTED` or with `CONTACTED` in `skipped`; `won` = opportunities whose status is `WON`; `paid` = distinct opportunities with ≥ 1 payment, plus `paidSums: [{ currency, totalMinor, count }]` per currency, never converted. All time; weekly figures are S-14. UI label "Kontakt (wysłane)" until drafts exist | B: `sent` from `SENT_MANUALLY` drafts (the PRD's meaning, but drafts do not exist yet); C: `won` = ever won (from history; a later `LOST` correction would still count) | Uses only recorded facts; the three numbers come from three different tables/columns so one cannot imply another | cheap | agent |
| D-10 | Payment lifecycle | Append-only: table `payments(id, opportunity_id FK cascade, amount_minor INTEGER NOT NULL CHECK > 0, currency TEXT NOT NULL CHECK IN ('PLN','EUR','USD'), paid_at INTEGER NOT NULL, note TEXT NULL, created_at INTEGER NOT NULL)`; allowed in every status; `paidOn` not in the future; amount ≤ 100 000 000 000 (same bound as the profile). No edit/delete here | B: delete with confirmation (corrects typos; one more route and UI, and S-15 owns deletes); C: allow only after `WON` (stricter, but AC1 says independent of `WON`, and advance payments exist) | AC1 needs a separate, independent record; corrections are a cheap additive follow-up | costly (migration) | agent |
| D-11 | Pipeline view contents | `/lejek` ("Lejek" in the nav): one section per stage `SAVED`, `OFFER_DRAFTED`, `CONTACTED`, `REPLIED`, `MEETING`, `WON`, `LOST`, each with its count and up to 50 newest-updated items (title link, score, follow-up date, paid sum); `NEW`, `QUALIFIED`, `NEEDS_VERIFICATION`, `REJECTED`, `EXPIRED` only as counts with a link to `/okazje?status=…`; totals of D-9 on top | B: all twelve stages with items (thousands of `NEW` rows would bury the funnel); C: a kanban board (drag and drop; not "prosta lista etapów", poor at 360 px) | Brief §11 item 4 "prosta lista etapów"; bounded response for NFR-02 | cheap | agent |
| D-12 | FR-14 AC4 "follow-up suggestions only for `SENT_MANUALLY` drafts" | No suggestion feature in this item: there are no drafts until S-07, so no suggestion can exist and nothing is suggested or sent. Logged as `[FOLLOW-UP]` for S-07 | B: build the suggestion now against a stub draft status (code with no data behind it) | Nothing can satisfy the condition yet; the safe half of the AC (nothing automatic) holds | cheap | agent |
| D-13 | Draft step of the e2e main path (S-07 not done) | `e2e/main-path.spec.ts` runs import → analysis (mock) → card → Zapisz → Oznacz jako kontakt (skips `OFFER_DRAFTED`, asserted in the history) → follow-up today → visible on start view → payment → Pipeline totals; it asserts "Przygotuj ofertę" is still disabled. `[FOLLOW-UP]` for S-07 to insert the draft step | B: wait for S-07 (blocks the slice on an item the roadmap does not make a dependency); C: a fake draft step (asserts nothing real) | The roadmap dependency is S-06 only; the spec grows by one step later | cheap | agent |
| D-14 | Card UI for status changes | "Oznacz jako kontakt" becomes a working shortcut to `CONTACTED`; a new "Zmień status" panel lists the targets `checkMove` allows, shows the note field as required when `noteRequired`, the §10.2 reason for `REJECTED` and the contract fields for `WON`. "Zapisz" and "Odrzuć" keep working as today. "Przygotuj ofertę" stays disabled (S-07). Follow-up and payments are two small forms on the card next to the history | B: one button per status (12 buttons at 360 px); C: status only on the Pipeline view (no history context) | Reuses the S-06 panel pattern; the rule drives what is offered | cheap | agent |

## Design

### Contracts (`packages/contracts`)
- `status.ts`: `MAIN_PATH` ranks; `checkMove(from, to)` (D-1); `OPERATOR_TARGETS` = every status
  but `NEW`; `Contract = { valueMinor: int 1…1e11, currency: Currency, expectedStartOn?,
  expectedEndOn? }` strict, refine end ≥ start; `StatusChangeRequest` (D-4) as a discriminated
  union: `REJECTED`, `WON`, and one member per remaining target built from a list;
  `FollowUpRequest = { on: calendarDate | null }`; `PaymentRequest = { amountMinor, currency,
  paidOn: calendarDate, note? }`. `calendarDate` = `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` plus a
  real-date refine. `operatorMoves` removed.
- `opportunities.ts`: `ActivityEvent.type` + `'FOLLOW_UP'`; new fields `skipped`, `contract`,
  `followUpOn: string | null` (for `FOLLOW_UP` events); `OpportunityDetail` + `followUpOn:
  string | null`, `payments: Payment[]` (`{ id, amountMinor, currency, paidOn, note, createdAt }`,
  newest paid first).
- `pipeline.ts` (new): `PipelineResponse = { stages: [{ status, count, items: PipelineItem[] }],
  otherCounts: [{ status, count }], followUpsDue: PipelineItem[], totals: { contacted, won, paid,
  paidSums: [{ currency, totalMinor, count }] } }`; `PipelineItem = { id, title, businessStatus,
  score, followUpOn, updatedAt, paid: [{ currency, totalMinor }] }`.

### Data (`apps/api/migrations/0006_*`, additive, generated by drizzle-kit)
- `opportunities.follow_up_at INTEGER NULL`, index `opportunities_follow_up_idx (follow_up_at)`.
- `payments` (D-10) with index `(opportunity_id, paid_at)`.
- No change to `activity_events` columns; new `type` value `FOLLOW_UP`, new metadata keys (D-2,
  D-3, D-7).

### API
- `POST /api/opportunities/:id/status`: transaction: read status → `checkMove` → 409
  `transition_not_allowed` / `note_required` → conditional update (+ clear `follow_up_at` on
  `WON|LOST|REJECTED|EXPIRED`) → insert event with `metadata_json = { skipped?, contract? }`
  (omitted when both empty) → 200 detail. `ActivityRepository.changeStatus(id, to, decide, event)`
  where `decide(from)` returns the `checkMove` result; metadata validated with its schema before
  insert (lesson).
- `PUT /api/opportunities/:id/follow-up`: 404 / 409 (status) / 400 (past date by Warsaw today) →
  update column + `FOLLOW_UP` event → 200 detail.
- `POST /api/opportunities/:id/payments`: 404 / 400 (future date, bounds) → insert → 200 detail.
- `GET /api/pipeline`: `modules/pipeline/{routes,service,ports}.ts` + `infrastructure/db/pipeline-repository.ts`;
  aggregates per D-9/D-11 in SQL (`GROUP BY business_status`, `GROUP BY currency`, a `json_each`
  over `metadata_json.skipped` for contacted).
- OpenAPI: routes registered through the typed provider; the existing OpenAPI test covers drift.
- Operator text (notes) never logged; no outbound calls anywhere in these flows (TR-04).

### Web (`apps/web`)
- `CardActions.tsx`: uses `checkMove` (replaces `operatorMoves`); "Oznacz jako kontakt" enabled;
  new "Zmień status" panel (D-14). Errors: 409 `note_required` → "Cofnięcie wymaga notatki.".
- `CardPipeline.tsx` (new): follow-up form (date input, clear) and payments (list + form; amount
  through `inputToMinor`, currency select, date default today in Warsaw, note).
- `opportunityCard.ts`: history entries render skipped stages ("pominięto: …"), contract and
  follow-up events.
- `PipelinePage.tsx` (new, `/lejek`), `api/pipeline.ts`, nav link "Lejek"; `App.tsx` start view adds
  the "Na dziś" follow-up list (D-8).
- `strings.pl.ts`: all new Polish text; amounts formatted per currency without conversion.

## Phases
### Phase 1: Transition rules and the widened status API
- Files:
  - `packages/contracts/src/status.ts`: `checkMove`, `OPERATOR_TARGETS`, `Contract`, widened
    `StatusChangeRequest`; remove `operatorMoves`. Contract: D-1, D-4.
  - `packages/contracts/src/status.test.ts` (new): table-driven `checkMove` over every
    (from, to) pair class: forward skips with `skipped`, back moves need a note, aside targets from
    every status, `WON`/`LOST` only from `CONTACTED|REPLIED|MEETING` (and each other with note),
    `to = from` and `to = NEW` refused; `StatusChangeRequest` refines (OTHER note, contract
    end ≥ start, value > 0). TR-14.
  - `packages/contracts/src/opportunities.ts`: `ActivityEvent` + `skipped`, `contract`,
    `followUpOn`, type `FOLLOW_UP`; `ActivityMetadata` stored schema (D-2).
  - `packages/contracts/src/index.ts`: exports.
  - `apps/api/src/modules/opportunities/{ports,service,routes}.ts`: `changeStatus` takes any
    target and a `decide` callback; 409 enum body; metadata built and validated in the service;
    `toActivity` parses metadata by actor.
  - `apps/api/src/infrastructure/db/activity-repository.ts`: writes `metadata_json`, outcome
    `'note_required'`.
  - `apps/api/test/pipeline-status.int.test.ts` (new): main path NEW → SAVED → CONTACTED (skipped
    `OFFER_DRAFTED` in history) → WON with contract → back move without note 409, with note 200;
    WON from SAVED 409; analysisStatus unchanged after every move. FR-14 AC1–AC3.
  - `apps/api/test/opportunity-actions.int.test.ts`: adjust only if a shape it asserts changed
    (new DTO fields); never weaken an assertion.
  - `apps/web/src/CardActions.tsx`: switch `operatorMoves` → `checkMove` so the build stays green
    (no new UI yet).
- Proves: FR-14 AC1, AC2, AC3 (unit + integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Follow-ups and payments
- Files:
  - `apps/api/src/infrastructure/db/schema.ts` + `apps/api/migrations/0006_*` (drizzle-kit
    generate): `follow_up_at`, `payments` (D-7, D-10).
  - `apps/api/src/modules/shared/warsaw-day.ts` (+ test cases in `warsaw-day.test.ts` for
    2026-10-25 and 2027-03-28): `warsawDateToInstant(date)`, `instantToWarsawDate(ms)` (D-5).
  - `packages/contracts/src/status.ts`: `FollowUpRequest`, `PaymentRequest`, `calendarDate`.
  - `packages/contracts/src/opportunities.ts`: `Payment`, `OpportunityDetail.followUpOn`,
    `payments`.
  - `apps/api/src/infrastructure/db/payment-repository.ts` (new) and
    `activity-repository.ts` (`setFollowUp`, follow-up cleared on terminal moves).
  - `apps/api/src/infrastructure/db/opportunity-repository.ts`: detail reads `follow_up_at` and
    payments.
  - `apps/api/src/modules/opportunities/{ports,service,routes}.ts`: `PUT …/follow-up`,
    `POST …/payments`.
  - `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/test/helpers/app.ts`: wiring.
  - `apps/api/test/pipeline-status.int.test.ts`: follow-up set on CONTACTED (200), on SAVED (409),
    past date (400), cleared by a move to `LOST`; payment recorded on a `CONTACTED` row stays a
    separate row, status unchanged, `WON` creates no payment; amount 0 / future date → 400; the
    run with `MockAgent.disableNetConnect()` (global setup) shows no outbound call. FR-14 AC3–AC4,
    FR-15 AC1, TR-04.
- Proves: FR-14 AC4 (storage and API half), FR-15 AC1 (integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 3: Pipeline summary API
- Files:
  - `packages/contracts/src/pipeline.ts` (new) + `index.ts`: `PipelineResponse` (Design).
  - `apps/api/src/modules/pipeline/{ports,service,routes}.ts` (new): `GET /api/pipeline`; due
    follow-ups use `startOfWarsawDay(clock.now())`.
  - `apps/api/src/infrastructure/db/pipeline-repository.ts` (new): counts per status, newest 50
    items per D-11 stage, totals D-9, paid sums per currency.
  - `apps/api/src/app.ts`, `server.ts`, `test/helpers/app.ts`: wiring.
  - `apps/api/test/pipeline-status.int.test.ts`: opportunity A contacted and paid 100 PLN without
    `WON`, B won without payment, C paid 50 EUR and 20 EUR → `contacted`, `won`, `paid` counted
    separately, sums per currency never merged; a follow-up due today and one tomorrow (fake
    clock) → only today's in `followUpsDue`. FR-15 AC2, FR-14 AC4.
- Proves: FR-15 AC2, FR-14 AC4 (Today list source) (integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 4: Card: status panel, contact, follow-up, payments
- Files:
  - `apps/web/src/CardActions.tsx`: "Oznacz jako kontakt" works; "Zmień status" panel (D-14).
  - `apps/web/src/CardPipeline.tsx` (new): follow-up and payments forms and list.
  - `apps/web/src/api/opportunities.ts`: `setFollowUp`, `addPayment`; status error kinds.
  - `apps/web/src/opportunityCard.ts` (+ cases in `opportunityCard.test.ts` only for the new
    history rendering of skipped stages, since that is TR-14's "skipped stages recorded"):
    history items for skipped stages, contract, follow-up.
  - `apps/web/src/OpportunityPage.tsx`, `OpportunityPage.module.css`, `strings.pl.ts`.
- Proves: FR-14 AC1–AC4, FR-15 AC1 in the UI (covered end to end in phase 5).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: the card at 360 px and on a laptop: status panel wording, required-note hint,
  WON contract fields, payment form (amount "1234,50" → 1 234,50 PLN).

### Phase 5: Pipeline view, "Na dziś" and the main-path e2e
- Files:
  - `apps/web/src/PipelinePage.tsx`, `PipelinePage.module.css` (new), `apps/web/src/api/pipeline.ts`
    (new), `apps/web/src/App.tsx` (route `/lejek`, nav "Lejek", start view "Na dziś" list),
    `apps/web/src/strings.pl.ts`.
  - `e2e/main-path.spec.ts` (new, the second and last spec): one login; import a new DEMO post →
    wait for "Analiza: gotowa" → open card → Zapisz → Oznacz jako kontakt → history shows the
    skipped "Oferta przygotowana" → follow-up today → start view lists it under "Na dziś" →
    payment 1500 PLN → Pipeline shows Kontakt 1, Wygrane 0, Opłacone 1 / 1 500,00 PLN; no
    horizontal scroll at 360 px; "Przygotuj ofertę" disabled (D-13). Evidence screenshots only with
    `E2E_EVIDENCE=1` into `context/changes/pipeline-and-payments/evidence/` (lesson: gate runs
    never rewrite committed files).
  - `e2e/env.ts`: update the login-budget comment (smoke 4 + main path 1 = 5).
  - `context/test-plan.md`: TR-14 status → `covered (S-08)`.
- Proves: roadmap acceptance (e2e main path), FR-15 AC2 and FR-14 AC4 in the UI (e2e).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`.
- Human checks: Pipeline view and the "Na dziś" list at 360 px and on a laptop (wording "Kontakt
  (wysłane)", per-currency sums, counts-only rows link to the filtered list).

## Risks and unknowns
- e2e login budget: the throttle is shared by all specs on one server; with the main-path spec
  the run uses all 5 attempts. A retry of a failed login test would hit the throttle. If that
  happens, the plan's fallback is a `[REVIEW]` deviation, not raising the limit silently.
- `json_each` over `metadata_json` for the contacted count depends on SQLite JSON1 (built into
  better-sqlite3's bundled SQLite); if it is missing, count from events in TypeScript instead
  ([minor]).
- Removing `operatorMoves` touches web and API in phase 1; both are in the same phase so the build
  stays green.
- D-9 counts contacts, not sent offers; S-07/S-14 must revisit the "sent" figure once drafts exist.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [ ] Phase 1: Transition rules and the widened status API
- [ ] Phase 2: Follow-ups and payments
- [ ] Phase 3: Pipeline summary API
- [ ] Phase 4: Card: status panel, contact, follow-up, payments
- [ ] Phase 5: Pipeline view, "Na dziś" and the main-path e2e

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [FOLLOW-UP] S-07: insert the draft step ("Przygotuj ofertę" → … → "Oznacz jako wysłane") into
  `e2e/main-path.spec.ts` (D-13) and add the follow-up suggestion for `SENT_MANUALLY` drafts
  (FR-14 AC4 second half, D-12).
- [FOLLOW-UP] S-14: "sent" should count `SENT_MANUALLY` drafts once they exist (D-9); weekly
  figures read the WON event's contract metadata (D-3).

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
