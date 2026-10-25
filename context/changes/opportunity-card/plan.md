# Plan: opportunity-card (S-06)

## Goal and end state
The *Okazja* view (`/okazje/:id`) shows the full §8 card on a 360 px phone and on a laptop, with
every value marked by where it comes from, and three actions that work.

Observable when done:
- FR-11 AC2: the card shows all twelve §8 elements, in §8 order, each under its own heading:
  1. title, category, business status;
  2. original link or import method ("wklejony tekst"), publication date (or "nieznana"),
     detection date;
  3. source excerpt (the full text behind "Pokaż całość") and evidence level;
  4. score 0–100, the five components with points/maximum and justification, confidence;
  5. who has the problem (and whether the buyer is confirmed), what the problem is;
  6. what can be sold: deliverable, approach, MVP scope, exclusions;
  7. matched skills and the skill-fit justification;
  8. billing model, price and time estimate, assumptions, and the budget the source stated (with
     its quote) when there is one;
  9. risks, missing information, questions for the client;
  10. one next step;
  11. actions `Zapisz`, `Odrzuć`, `Dodaj notatkę` (working) and `Przygotuj ofertę`,
      `Oznacz jako kontakt` (shown disabled with the text "dostępne w kolejnej wersji" until
      S-07/S-08);
  12. status history (newest first: status changes by the operator and by the system, notes) and
      a link to the source ("Przejdź do źródła", or "wklejony tekst — brak linku").
  Without an analysis (pending, skipped, failed, insufficient data) elements 4–10 still appear
  and say why they are empty; nothing is filled in.
- FR-11 AC3: every value has a text tag next to it: `ze źródła` (source text, guard-verified
  quotes), `wniosek modelu` (model output), `szacunek (hipoteza)` (price, hours),
  `wyliczone regułami` (score, components, confidence), `brak danych` (null/empty). Tags differ by
  text and border style, not by colour (NFR-07). The `DEMO / MOCK` banner stays for mock results.
- FR-11 AC4: login, *Start*, *Okazje*, *Import*, *Profil* and the card (including the open reject
  and note forms) have no horizontal scroll at 360 px.

## Scope
- In: analysis schema v2 (`mvpScope`, `exclusions`) with read-time upgrade of stored v1 results;
  mock provider fills the new fields; `activity_events` table (migration `0005_*`); operator
  actions API (status change to `SAVED`/`REJECTED`, notes); activity in the opportunity detail;
  system status moves of the analysis runner recorded as events; the card UI (pure card model,
  page, actions, CSS, strings); e2e smoke extension; README.
- Out: the full §10.1 transition table, back moves with notes, contact/follow-up/won/lost,
  payments, Pipeline view (S-08); offer drafts (S-07); editing or deleting notes; real-provider
  prompts asking for `mvpScope`/`exclusions` (S-05 builds prompts against schema v2); backfilling
  history for status changes made before this migration (their times are unknown, D-8).

## Findings
- The current detail page (`apps/web/src/OpportunityPage.tsx:60-253`) already renders source
  facts, the analysis, the breakdown and evidence, with inline text tags via `labelled()`
  (`:113-117`) using `strings.opportunity.modelInference` / `fromSource` / `hypothesis`
  (`apps/web/src/strings.pl.ts:162-190`). Missing for §8: MVP scope and exclusions (6), skill-fit
  justification next to skills (7), billing model and assumptions (8), risks and client questions
  (9), actions (11), status history and an explicit source link (12). Several values have no tag
  (title, score, components, unknowns, guard notes).
- Analysis schema v1 (`packages/contracts/src/analysis.ts:72-98`, strict object) follows §6.1 and
  has no MVP-scope or exclusions field; §6.1 has none either, but FR-11 AC2 and §8 item 6 require
  them. `uncertainties`, `unknowns`, `requiredClarifications` exist and map to element 9.
  `ANALYSIS_SCHEMA_VERSION = 1` (`:5`) is stored per attempt in `analyses.schema_version`
  (`apps/api/src/infrastructure/db/schema.ts:96`).
- Stored results are re-parsed on read and silently become `null` if they do not parse
  (`apps/api/src/modules/opportunities/service.ts:98-125`), so a new required field without an
  upgrade step would blank every existing analysis (same failure as the lesson
  "validate before storing").
- The provider output is validated with `OpportunityAnalysis.safeParse` before storing
  (`apps/api/src/modules/analysis/service.ts:110`); the mock builds its `ANALYSED` object in
  `apps/api/src/infrastructure/llm/mock.ts:104-133`.
- System status moves: the pre-filter (`analysis-repository.ts:45-58`, not in a transaction) and
  insufficient-data results (`:79-116`, in a transaction) move `businessStatus` only from `NEW`
  through a SQL `CASE` (`:28-29`, S-04 D-17). S-04 D-17 left history to S-08; no events table
  exists.
- Opportunity routes: `GET /api/opportunities`, `GET /api/opportunities/:id`
  (`apps/api/src/modules/opportunities/routes.ts:15-38`). Auth and OpenAPI tests iterate the route
  table, so new routes are covered without edits (S-03/S-04 findings). Web POSTs go through
  `apiFetch` with JSON (`apps/web/src/api/signals.ts:8-22`).
- `BusinessStatus` enum and Polish labels exist (`packages/contracts/src/opportunities.ts:14-28`,
  `apps/web/src/strings.pl.ts:80-95`).
- Test budget (`context/test-plan.md` *Test budget*): no component tests in `apps/web`; unit tests
  only for rules a `test` risk names; one or two integration tests per slice; e2e at most two
  specs. Risks owned here: TR-01 (`test`: "card shows 'wniosek modelu' for every inferred field"),
  TR-24 (`human`). The roadmap's "component tests for each of the twelve elements" predates that
  budget (see D-1).
- e2e: `e2e/smoke.spec.ts` runs at 360×740, already opens the card after a mock analysis
  (`:128-148`) and has `assertNoOverflow`; it uses four of the five logins the throttle allows
  (`:91`), so the card checks extend that test instead of adding a login.
- No third-party API or new dependency is needed.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | How the twelve elements and labels are tested | A pure card model `buildCard(detail)` in `apps/web/src/opportunityCard.ts` turns the DTO into the twelve sections with a provenance tag per value; the page only renders it. A table-driven unit test covers all twelve sections and the tag of every value in four states (analysed, insufficient data, pending, skipped). The e2e smoke checks the rendered card at 360 px | B: React component tests per element, as the roadmap says (tests what is rendered, but the test-plan budget, a later user decision, forbids component tests); C: e2e only (fewest files, but TR-01 is a `test` risk and e2e covers one state) | The test budget is the later user decision; one renderer for tags makes the model test meaningful | cheap | user (test-plan budget) |
| D-2 | Where MVP scope and exclusions come from | Analysis schema v2: `ANALYSED` gains required `mvpScope: string[]` and `exclusions: string[]` (≤ 20 items, ≤ 500 chars). The provider must return them. Stored v1 results are upgraded on read with empty lists (`upgradeStoredAnalysis(json, schemaVersion)` in contracts), shown as "brak danych" | B: show `solutionApproach` as MVP scope and "brak danych" for exclusions (no schema change, but AC2 would never be met); C: optional fields with `.default([])` in one schema (no upgrade step, but a v2 provider could omit them unnoticed) | AC2 asks for both; required in new output, tolerant for old rows | costly (stored JSON, schema version) | agent |
| D-3 | Element 9 mapping | `uncertainties` → "Ryzyka", `unknowns` → "Brakujące informacje", `requiredClarifications` → "Pytania do klienta" | B: a new `risks` field (exact name, one more schema field the model has to fill) | Existing v1 fields carry this meaning already | cheap | agent |
| D-4 | Where status changes and notes are stored | New table `activity_events(id, opportunity_id FK cascade, type, actor, from_status, to_status, reason, note, metadata_json, occurred_at)`, index `(opportunity_id, occurred_at)`. `type` ∈ `STATUS_CHANGE`, `NOTE` here; S-08 adds contact/follow-up/win/loss. Matches the PRD *Activity event* shape | B: notes as JSON on `opportunities` (no table, but no history and S-08 would migrate it); C: wait for S-08 (no new table now, but the roadmap needs working actions and history in S-06) | The PRD names the entity; additive; S-08 adds types without a migration | costly (data shape, migration) | agent |
| D-5 | Actions API | `POST /api/opportunities/:id/status` with `{ status: 'SAVED', note? }` or `{ status: 'REJECTED', reason, note? }`; `POST /api/opportunities/:id/notes` with `{ text }`. Both answer 200 with the updated `OpportunityDetail`; 404 for an unknown id; 409 `{ error: 'transition_not_allowed' }`; 400 through the shared validation shape. S-08 widens the `status` union | B: one endpoint per action (`/save`, `/reject`; simpler bodies, but S-08 would add one route per status); C: `PATCH /api/opportunities/:id` (generic, but hides that a change writes an event) | One status route grows with S-08 additively; returning the detail saves a reload | costly (public API) | agent |
| D-6 | Which moves the operator may make in this item | Shared rule `operatorMoves(status)` in `packages/contracts/src/status.ts`, used by API (409) and web (button enabled): `SAVED` from `NEW`, `QUALIFIED`, `NEEDS_VERIFICATION`; `REJECTED` from every status except `REJECTED`. The update is conditional on the status read in the same transaction | B: allow any move now (fewer lines, but S-08's rules would reject rows S-06 created); C: only from `NEW` (stricter, but a pre-filtered `NEEDS_VERIFICATION` post could not be saved) | Follows the roadmap S-08 rule (REJECTED from any stage, forward only); S-08 replaces the table in one file | cheap | agent |
| D-7 | Rejection reason | Required now: §10.2 list `NO_BUDGET`, `POOR_FIT`, `OUTDATED`, `LOW_POTENTIAL`, `NO_CONTACT`, `HIGH_COMPETITION`, `OTHER`; `OTHER` needs a non-empty `note`. Stored in `activity_events.reason` | B: no reason until S-08 (less UI, but rejections made meanwhile would break FR-14 AC2) | One rule from the start keeps the data valid | costly (API contract, stored values) | prd |
| D-8 | System status moves in the history | The analysis repository writes a `STATUS_CHANGE` event with `actor = 'system'` and `metadata_json = { cause: 'prefilter', rule }` or `{ cause: 'insufficient_data' }` in the same transaction, only when the status actually moved from `NEW`. Changes made before this migration have no event; the history starts with "Wykryto" at `createdAt` (a fact, not an event row) | B: operator events only (no change to S-04 code, but a pre-filter rejection would be missing from the "history of status changes"); C: backfill events in the migration (complete, but the time of the old move is unknown and would be invented) | An honest history without inventing times | cheap | agent |
| D-9 | Provenance tags | Five tags as text: `ze źródła`, `wniosek modelu`, `szacunek (hipoteza)`, `wyliczone regułami`, `brak danych`; borders solid / dashed / dotted / double / none. App records (status, dates, history) carry no tag | B: one tag per section (less noise, but a section mixes facts and inferences, e.g. element 8) | AC3 is per value; text first, style second | cheap | agent |
| D-10 | Long source text and history on a phone | Excerpt = first 600 characters; the rest behind `<details>` "Pokaż całość". History newest first, all entries | B: always full text (simpler, but a 20 000-character post pushes elements 4–12 far down) | Card stays scannable; nothing hidden that cannot be opened | cheap | agent |
| D-11 | Notes | Append-only, trimmed, 1–2000 characters; no edit or delete in this item | B: editable notes (more UI; an edited history is less trustworthy) | History is a record | cheap | agent |
| D-12 | Laptop layout | One column up to 959 px; from 960 px a two-column grid (elements 1–4 and 10–12 full width, 5–9 in two columns), max width 1200 px | B: one column everywhere (simplest, wastes laptop width) | Small CSS, reversible | cheap | agent |
| D-13 | Disabled actions | `Przygotuj ofertę` and `Oznacz jako kontakt` as `disabled` buttons with the visible text "dostępne w kolejnej wersji" | B: hide them (cleaner, but §8 item 11 lists them and the roadmap asks for disabled) | Roadmap acceptance | cheap | agent |

## Design

### Contracts
- `packages/contracts/src/analysis.ts`: `ANALYSIS_SCHEMA_VERSION = 2`; `AnalysedResult` +
  `mvpScope: shortList`, `exclusions: shortList`; `upgradeStoredAnalysis(value: unknown,
  schemaVersion: number): unknown` adds `mvpScope: []`, `exclusions: []` to a v1 `ANALYSED`
  object, otherwise returns the value unchanged.
- `packages/contracts/src/status.ts` (new): `RejectionReason` enum (D-7);
  `operatorMoves(status: BusinessStatus): readonly ('SAVED' | 'REJECTED')[]` (D-6);
  `StatusChangeRequest` = `discriminatedUnion('status', [{ status: 'SAVED', note? },
  { status: 'REJECTED', reason, note? }])`, strict, `note` trimmed 1–2000, refine `OTHER` → note;
  `NoteRequest = { text }` trimmed 1–2000.
- `packages/contracts/src/opportunities.ts`: `ActivityEvent = { id, type: 'STATUS_CHANGE' |
  'NOTE', actor: 'operator' | 'system', fromStatus | null, toStatus | null, reason | null,
  note | null, cause: { kind: 'prefilter', rule } | { kind: 'insufficient_data' } | null,
  occurredAt }`; `OpportunityDetail` + `activity: ActivityEvent[]` (newest first).

### Data (`apps/api/migrations/0005_*`, additive, generated by drizzle-kit)
`activity_events(id INTEGER PK AUTOINCREMENT, opportunity_id INTEGER NOT NULL FK → opportunities
ON DELETE CASCADE, type TEXT NOT NULL, actor TEXT NOT NULL, from_status TEXT NULL, to_status TEXT
NULL, reason TEXT NULL, note TEXT NULL, metadata_json TEXT NULL, occurred_at INTEGER NOT NULL)`,
index `activity_events_opportunity_idx (opportunity_id, occurred_at)`. UTC epoch ms.

### API flow
`POST /status`: validate body → transaction: read status (404 if missing) → `operatorMoves`
check (409) → update `business_status`, `updated_at` where `business_status = <read>` → insert
event → return `get(id)`. `POST /notes`: 404 check → insert `NOTE` event → return `get(id)`. Both
through a new `ActivityRepository` port (`modules/opportunities/ports.ts`), implemented in
`infrastructure/db/activity-repository.ts`; values validated with the contract schema before
storing (lesson). Notes and reasons are operator text, never logged.

### Web
- `apps/web/src/opportunityCard.ts`: `buildCard(detail): CardSection[]`; `CardSection = { key:
  CardElement, title, items: CardItem[] }`, `CardElement` = the twelve keys in §8 order;
  `CardItem = { label, value: string | string[] | null, tag: Provenance | null }`; `null` or `[]`
  → tag `unknown` ("brak danych"). Breakdown, actions and history are typed items the page renders
  specially. Everything from `latestAnalysis.result` is `inference` except `sourceFacts` and
  `sourceBudget` (`source`, guard-verified), `proposedPrice` / `estimatedHours` (`estimate`);
  score, components, confidence are `rules`.
- `apps/web/src/OpportunityPage.tsx`: renders the sections; `apps/web/src/CardActions.tsx`:
  buttons, reject form (reason `<select>`, note), note form; `apps/web/src/api/opportunities.ts`:
  `changeStatus`, `addNote`.
- Errors: 409 → "Tej zmiany nie można wykonać z obecnego statusu."; 400 → field messages; other →
  "Nie udało się zapisać."; the card keeps its data on failure.

## Phases
### Phase 1: Analysis schema v2 with MVP scope and exclusions
- Files:
  - `packages/contracts/src/analysis.ts`: version 2, two fields, `upgradeStoredAnalysis`.
    Contract: `OpportunityAnalysis` (`ANALYSED` variant), `ANALYSIS_SCHEMA_VERSION`.
  - `packages/contracts/src/analysis.test.ts`: v1 object upgrades and parses; v2 without the
    fields fails.
  - `apps/api/src/modules/opportunities/service.ts`: `toLatestAnalysis` parses
    `upgradeStoredAnalysis(JSON.parse(resultJson), row.schemaVersion)`. Invariant: a stored v1
    result still reads as non-null.
  - `apps/api/src/infrastructure/llm/mock.ts` (+ `mock.test.ts` if it pins the output): category
    tables for `mvpScope` and `exclusions`, prefixed `DEMO / MOCK:`.
  - `apps/api/test/opportunities.int.test.ts` (or `analysis.int.test.ts`): one case, a seeded v1
    `analyses` row still appears in the detail with empty lists.
  - `docs/scoring.md` or `README.md`: one line on schema v2 if the schema is described there.
- Proves: D-2 (unit + integration); prerequisite for FR-11 AC2 element 6.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Activity events and the actions API
- Files:
  - `packages/contracts/src/status.ts` (new), `index.ts` export: D-6, D-7 contracts.
  - `packages/contracts/src/opportunities.ts`: `ActivityEvent`, `OpportunityDetail.activity`.
  - `apps/api/src/infrastructure/db/schema.ts` + `apps/api/migrations/0005_*` (+ meta): the
    table.
  - `apps/api/src/infrastructure/db/activity-repository.ts` (new): `changeStatus(id, from, to,
    event)`, `addNote(id, text, at)`, `list(id)`.
  - `apps/api/src/infrastructure/db/opportunity-repository.ts`: `get` returns activity rows.
  - `apps/api/src/infrastructure/db/analysis-repository.ts`: system events in `savePrefilter`
    (now in a transaction) and `saveComplete` when the status moved from `NEW` (D-8).
  - `apps/api/src/modules/opportunities/{ports,service,routes}.ts`: the two routes, 404/409, detail
    with `activity`.
  - `apps/api/src/server.ts`, `apps/api/test/helpers/app.ts`: wire the repository.
  - `apps/api/test/opportunity-actions.int.test.ts` (new): main path — import → save (event,
    status `SAVED`) → note → reject with `POOR_FIT` → detail `activity` newest first with actor,
    from/to, reason, note; reject without reason and `OTHER` without note → 400; save from
    `REJECTED` → 409, status unchanged, no event; unknown id → 404; a pre-filter rejection shows a
    `system` event with its rule.
- Proves: FR-11 AC2 element 11 (actions) and 12 (history), D-5…D-8 (integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 3: The twelve-element card with provenance tags
- Files:
  - `apps/web/src/opportunityCard.ts` (new): `buildCard` (D-1, D-9, D-10).
  - `apps/web/src/opportunityCard.test.ts` (new): table over four states (analysed with budget,
    insufficient data, pending, pre-filter skipped): twelve sections in §8 order; every value from
    `result` carries `inference` except source facts / budget (`source`) and price / hours
    (`estimate`); score and components `rules`; null and empty → `unknown`; no section invents a
    value when the analysis is absent. Uses a `DEMO` fixture DTO.
  - `apps/web/src/OpportunityPage.tsx`, `OpportunityPage.module.css`: render sections and tags,
    two-column layout from 960 px (D-12), wrapping for long URLs and text; element 11 shows the
    buttons in their final place, wired in phase 4.
  - `apps/web/src/strings.pl.ts`: section titles, tags, element texts.
- Proves: FR-11 AC2 (elements 1–10, 12 display), FR-11 AC3, TR-01 card part (unit).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: open a mock-analysed card on a phone (or DevTools 360×740) and on a laptop
  width; judge that facts, inferences and estimates are told apart at a glance and the wording
  reads naturally in Polish (evidence: `E2E_EVIDENCE=1` screenshots from phase 4).

### Phase 4: Card actions, history and e2e
- Files:
  - `apps/web/src/api/opportunities.ts`: `changeStatus(id, body)`, `addNote(id, text)` returning
    `OpportunityDetail` or field errors / `conflict`.
  - `apps/web/src/CardActions.tsx` (new) and CSS: `Zapisz`, `Odrzuć` (inline form: reason select,
    note, "Potwierdź odrzucenie"), `Dodaj notatkę` (textarea, "Zapisz notatkę"), disabled
    `Przygotuj ofertę` / `Oznacz jako kontakt` (D-13); buttons enabled by `operatorMoves`.
  - `apps/web/src/OpportunityPage.tsx`: replace the detail after an action; history list.
  - `apps/web/src/strings.pl.ts`: reason labels, action and error texts.
  - `e2e/smoke.spec.ts`: in the existing import test (no new login): the twelve section headings
    visible; `Zapisz` → status "Zapisana" and a history entry; add a note → shown in history;
    open the reject form → `assertNoOverflow`; evidence `card-360.png`, `card-actions-360.png`
    under this change's `evidence/` only with `E2E_EVIDENCE=1`.
  - `README.md`: *Co działa* gains the card, actions and history.
- Proves: FR-11 AC2 element 11 in the UI, FR-11 AC4 (e2e at 360 px).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`; `pnpm e2e` if Chromium is
  installed (otherwise at `/review`).
- Human checks: on a phone, reject an opportunity with "inne" and a note, then add a note; check
  the history reads correctly and the disabled buttons are clearly "not yet" rather than broken.

## Risks and unknowns
- Schema v2 changes the contract S-05 prompts are written against; S-05 must ask for `mvpScope`
  and `exclusions`. Recorded in D-2 so the S-05 plan picks it up.
- S-08 replaces `operatorMoves` with the full §10.1 table; rows created here (`SAVED`, `REJECTED`
  with reason) are valid under the S-08 rules decided in the roadmap.
- The mock's MVP scope/exclusions are generic per-category texts; they show layout, not quality.
- `pnpm e2e` login budget: the smoke run already uses four of five logins; the plan adds none.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Analysis schema v2 with MVP scope and exclusions
- [x] Phase 2: Activity events and the actions API
- [ ] Phase 3: The twelve-element card with provenance tags
- [ ] Phase 4: Card actions, history and e2e

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] Phase 1: `apps/api/test/analysis.int.test.ts` pinned `schemaVersion: 1`; now 2. `docs/scoring.md` does not describe the analysis schema, so no doc line was added.
- [minor] Phase 2: `ActivityRepository` has no `list`; `OpportunityRepository.get` returns the activity rows (one read path for the detail). System events follow plan-review #3 (status read in the same transaction; no event when the operator moved the row first, covered by an integration case). `refine` for `OTHER` sits on the `REJECTED` member with `path: ['note']` (plan-review #6).

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
