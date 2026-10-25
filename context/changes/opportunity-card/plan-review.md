# Plan review: opportunity-card

Verdict: READY WITH NOTES

| # | Severity | Check | Finding | Suggested change |
|---|----------|-------|---------|------------------|
| 1 | major | Grounding / Phasing | Phase 1 makes `mvpScope`/`exclusions` required, but its file list leaves out the shared ANALYSED fixture `apps/api/test/helpers/analysis.ts:10` (`verdict: 'ANALYSED'`) and lists `apps/api/test/opportunities.int.test.ts` only as "(or ...)". Both build ANALYSED objects, so integration tests that parse them against v2 fail and Phase 1 does not leave the build green. | Add `apps/api/test/helpers/analysis.ts` (and every fixture found by `grep -rn "verdict: 'ANALYSED'" apps packages`) to Phase 1 files. Make the v1-row test seed a raw v1 JSON so it does not reuse the v2 helper. |
| 2 | major | Traceability | Element 7 needs a "skill-fit justification", but schema v1 has no such field: `relevantSkills` is a list, and `rationale` is the overall rationale. The only per-skill justification is `ScoreBreakdown` component `skillFit` (`packages/contracts/src/analysis.ts:120,142`), a rules value. The plan's Findings call it "missing" and give no source, so `buildCard` has nothing defined to show and the tag (`rules` or `inference`) is open. | State the mapping in Design/Web, e.g. element 7 = `relevantSkills` (`wniosek modelu`) + `breakdown.skillFit.justification` (`wyliczone regułami`). Add that case to the `opportunityCard.test.ts` table. |
| 3 | minor | Failure paths / Design | D-8 records a system event "only when the status actually moved from NEW", but the move happens inside the SQL `CASE` (`analysis-repository.ts:28-29`), and the statement does not say whether it moved. The plan does not say how the repository finds out. If it guesses from `moveTo !== null`, it would write a false event after an operator already saved the row (`SAVED` → CASE keeps `SAVED`). | In the same transaction, read `business_status` before the update and insert the event only when it was `NEW` and `moveTo` is non-null. Add an integration case: operator saves first, then a pre-filter/insufficient-data result writes no system event. |
| 4 | minor | Design | The S-08 rule decided up front (`context/roadmap.md:178`) says "skipped stages are recorded in the history". D-6 lets `NEW → SAVED` skip `QUALIFIED`, and the plan does not say whether the event marks the skipped stage. It also does not say whether leaving `NEEDS_VERIFICATION` for `SAVED` counts as a forward move. | One line in D-6: from/to in the event is enough to rebuild skipped stages (or add `metadata_json.skipped`), and leaving `NEEDS_VERIFICATION` counts as forward. That way S-08 does not reinterpret S-06 rows. |
| 5 | minor | Design | `operatorMoves` is a business rule placed in `packages/contracts`, which tech-stack describes as "Zod schemas and DTO types shared by api and web" (`context/tech-stack.md:160`). Simpler alternative: the detail DTO carries `allowedMoves`, computed in the API module, and the web only reads it. Then S-08 swaps the table in one API file, and the rule stays out of the client. | Either keep it and record it as a decision with that alternative, or add `allowedMoves` to `OpportunityDetail`. |
| 6 | minor | Grounding | "refine `OTHER` → note" on a `discriminatedUnion` member: with zod 4.6.7 (`packages/contracts/package.json:17`), a refine on the member object works. A refine on the union must keep `path: ['note']` so the shared 400 shape points at the field. Neither placement is stated. | Say "refine on the REJECTED member object with `path: ['note']`". |
| 7 | minor | Phasing | Phase 3 puts the element 11 buttons "in their final place, wired in phase 4". So the Phase 3 commit ships live-looking buttons that do nothing. | Render them `disabled` in Phase 3, and Phase 4 enables them through `operatorMoves`. |
| 8 | minor | Traceability | D-1 departs from the roadmap acceptance ("component tests for each of the twelve elements", `context/roadmap.md:151`). This is justified by the later test budget (`context/test-plan.md:25`), but it is still a change to a roadmap AC. | List D-1 under *Decisions to confirm* in the PR, even though it is `cheap`. |

## Decisions the PR reviewer should look at
- D-2: schema v2 with required fields plus a read-time upgrade changes the stored-JSON contract that S-05 prompts must follow.
- D-4: the new `activity_events` table shape, which S-08 builds on (type set, `metadata_json` for cause).
- D-5: the public `POST /status` / `POST /notes` contract, and 200 returning the full detail.
- D-7: rejection reasons as stored enum values, required from now on.
- D-1: replaces the roadmap's component tests with a pure card model test plus e2e.

## What is good
- The findings are accurate: the cited lines in `service.ts` (silent `null` on parse failure), `analysis-repository.ts` (non-transactional `savePrefilter`, `moveFromNew`), `routes.ts`, `smoke.spec.ts` (4/5 logins) and the enum files all check out.
- The v1 → v2 upgrade on read applies the "validate before storing" lesson and avoids blanking existing analyses.
- The pure `buildCard` model makes TR-01's "wniosek modelu for every inferred field" testable without component tests, which respects the test budget.
- Evidence screenshots only with `E2E_EVIDENCE=1` follow the "gate must not rewrite committed files" lesson.
- D-8 does not backfill history with times it does not know, which keeps it honest.
- Scope is tight: no Pipeline, no drafts, no §10.1 table, and the disabled buttons match the roadmap.
