# feat(opportunity-card): full twelve-element opportunity card with provenance tags and working actions

Roadmap S-06. The *Okazja* view (`/okazje/:id`) now shows the full PRD §8 card (twelve elements, in order, each under its own heading) on a 360 px phone and on a laptop. Every value carries a text tag (`ze źródła`, `wniosek modelu`, `szacunek (hipoteza)`, `wyliczone regułami`, `brak danych`). `Zapisz`, `Odrzuć` (with a §10.2 reason) and `Dodaj notatkę` work and are recorded in a status history; `Przygotuj ofertę` and `Oznacz jako kontakt` are shown disabled ("dostępne w kolejnej wersji"). Covers PRD FR-11 AC2–AC4.
Closes #7

> **Status:** Ready for review

## ⚠ Needs your decision
- **Image gate failed (environment), not a code result.** `pnpm docker:build` fails at `RUN pnpm install --frozen-lockfile`: corepack cannot fetch pnpm 12.15.0, "self-signed certificate in certificate chain" from the sandbox proxy, before any project code. The Dockerfile is not part of this diff; the same failure was in the analysis-and-scoring review. Please run the image build once outside the sandbox.
- **D-2 (costly):** where MVP scope and exclusions come from → chose **analysis schema v2** (required `mvpScope: string[]`, `exclusions: string[]`; stored v1 rows upgraded on read with empty lists, shown as "brak danych"). Alternatives: B: show `solutionApproach` as MVP scope and "brak danych" for exclusions (no schema change, AC2 never met); C: optional fields with `.default([])` (no upgrade step, a v2 provider could omit them unnoticed). Switching costs: `packages/contracts/src/analysis.ts`, the `upgradeStoredAnalysis` call site in the opportunities service, mock provider, stored JSON/schema version. S-05 prompts must ask for both fields.
- **D-4 (costly):** where status changes and notes live → chose **new table `activity_events`** (migration `0005`, additive, FK cascade, index `(opportunity_id, occurred_at)`), the PRD's *Activity event* shape; S-08 adds event types. Alternatives: B: notes as JSON on `opportunities` (no table, no history, S-08 would migrate); C: wait for S-08 (roadmap needs working actions and history now). Switching costs: migration, `activity-repository.ts`, `opportunity-repository.ts`, `analysis-repository.ts`.
- **D-5 (costly):** actions API → chose **`POST /api/opportunities/:id/status`** (`{status:'SAVED', note?}` or `{status:'REJECTED', reason, note?}`) and **`POST /api/opportunities/:id/notes`** (`{text}`); both return 200 with the updated `OpportunityDetail`; 404 / 409 `transition_not_allowed` / 400. Alternatives: B: one endpoint per action (simpler bodies, S-08 adds a route per status); C: `PATCH /api/opportunities/:id` (generic, hides that a change writes an event). Switching costs: `routes.ts`, contracts, web API client, integration tests.
- **D-7 (costly):** rejection reason required from now on → chose the §10.2 list (`NO_BUDGET`, `POOR_FIT`, `OUTDATED`, `LOW_POTENTIAL`, `NO_CONTACT`, `HIGH_COMPETITION`, `OTHER`; `OTHER` needs a non-empty note), stored in `activity_events.reason`. Alternative: B: no reason until S-08 (rejections made meanwhile would break FR-14 AC2). Switching costs: API contract and stored values.
- **D-1 departs from a roadmap AC (plan review #8):** the roadmap asks for "component tests for each of the twelve elements". The plan uses a pure `buildCard(detail)` model with a table-driven unit test (four states, tag per value) plus an e2e check at 360 px, because the test-plan budget forbids component tests. Alternatives: B: React component tests per element; C: e2e only. Cheap to change.
- **[FOLLOW-UP → your call] Card dropped source type, `fetchedAt`, availability and last verification** (FR-06 AC3 fields shown by the old page) and review R2 chose not to restore them in this PR; see Follow-ups. Say `R2: restore them` if you want them in element 2 now.

Reply in a review comment, e.g. `D-2: take B`, `R2: restore them`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 3) Open a mock-analysed card at 360×740 and at laptop width; judge that facts, inferences, estimates and rule results are told apart by tag text and border, and that the Polish reads naturally. Run: `pnpm dev`, import a pasted ad on /import, open /okazje/<id>. Evidence: [card-360.jpg](context/changes/opportunity-card/evidence/card-360.jpg) (from `E2E_EVIDENCE=1 pnpm e2e`).
- [ ] (Phase 4) On a phone, reject an opportunity with "inne" and a note, then add a note; check the history reads correctly and the disabled buttons read as "not yet", not broken. Run: `pnpm dev`, import a pasted ad on /import, open /okazje/<id>. Evidence: [card-actions-360.jpg](context/changes/opportunity-card/evidence/card-actions-360.jpg).

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-3 | Element 9 mapping | `uncertainties` → Ryzyka, `unknowns` → Brakujące informacje, `requiredClarifications` → Pytania do klienta | B: a new `risks` field |
| D-6 | Which moves the operator may make | Shared `operatorMoves(status)` in contracts: `SAVED` from `NEW`/`QUALIFIED`/`NEEDS_VERIFICATION`; `REJECTED` from any status but `REJECTED`; conditional update in one transaction | B: any move; C: only from `NEW`; D: `allowedMoves` computed in the API and carried in the DTO |
| D-8 | System status moves in the history | Analysis repository writes an `actor = 'system'` `STATUS_CHANGE` event (cause `prefilter` + rule, or `insufficient_data`) only when the status moved from `NEW`; no backfill | B: operator events only; C: backfill in migration (would invent times) |
| D-9 | Provenance tags | Five text tags with solid / dashed / dotted / double / none borders; app records carry no tag | B: one tag per section |
| D-10 | Long source text and history on a phone | First 600 characters, rest behind "Pokaż całość"; history newest first, all entries | B: always full text |
| D-11 | Notes | Append-only, trimmed, 1–2000 characters | B: editable notes |
| D-12 | Laptop layout | One column to 959 px; from 960 px two-column grid, max width 1200 px | B: one column everywhere |
| D-13 | Disabled actions | Visible `disabled` buttons with "dostępne w kolejnej wersji" | B: hide them |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (34 files, 406 tests), e2e ok (4 tests), image **fail (environment, see above)**, mutation not run.
- Plan review: READY WITH NOTES (8 findings: 2 major, 6 minor; the two major ones, test fixtures and the element 7 mapping, are covered by the plan; #5 was recorded later as D-6 alternative D).
- Review: APPROVE, round 1: fixed 7 (R1–R7, all minor), deferred 0, rejected 0. R2 was fixed by deleting the orphaned strings/CSS, not by restoring the dropped source fields (FOLLOW-UP below).
- Mutation: skipped: S-06 has no module in *Mutation targets* of the test plan; no `mutation.md`.
- Proposed lessons: none committed. R2 listed a lesson candidate ("When a rewrite removes something the UI used to show, log it as a deviation and delete what it orphaned.") but `context/lessons.md` has no such entry.

## Follow-ups
- [FOLLOW-UP] Show source availability ("niedostępne") and last verification on the card; S-09 sets availability for URLs and needs a place in element 2.
- [minor] The mock's MVP scope/exclusions are generic per-category texts; they show layout, not quality. S-05 must make real providers return `mvpScope` and `exclusions` (D-2).
- [minor] S-08 replaces `operatorMoves` with the full §10.1 table; rows created here stay valid under the roadmap rules.

## Commits
```
879e8d2 docs(opportunity-card): triage review round 1
2a566ec fix(opportunity-card): remove strings and CSS orphaned by the card rewrite (R2)
a315fbd fix(opportunity-card): check note form overflow in e2e (R7)
bf19ec6 fix(opportunity-card): type and validate system event cause (R6)
ed95999 fix(opportunity-card): tag assumptions as inference, cut excerpt by code point (R3, R4)
e613c90 fix(opportunity-card): separate note and rejection text state (R1)
b2f3681 docs(opportunity-card): review
8631fa9 feat(opportunity-card): card actions, status history and e2e
2ac91a5 feat(opportunity-card): twelve-element card with provenance tags
b7e5836 feat(opportunity-card): activity events and operator actions API
439ce6b feat(opportunity-card): analysis schema v2 with MVP scope and exclusions
4a74f77 docs(opportunity-card): plan-review
99214ba docs(opportunity-card): plan
```

<details><summary>Run</summary>

Branch `change/opportunity-card`, base `main`, no failed step, no draft reason. Phases ticked 4/4.

| Step | Model | Attempts | Cost |
|------|-------|----------|------|
| plan | opus | 1 | $1.62 |
| plan-review | opus | 1 | $0.65 |
| implement (4 phases) | sonnet | 1 each | $0.34 + $0.49 + $0.47 + $0.43 |
| review | opus | 1 | $1.61 |
| fix-review | sonnet | 1 | $0.26 |

Total before pr-body: about $5.87.
</details>
