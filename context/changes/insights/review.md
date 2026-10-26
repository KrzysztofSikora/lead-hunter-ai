# Review: insights

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (1065 passed), e2e ok (5 passed), image not run (no Docker daemon in this environment; the diff touches no Docker files), image smoke not run (same) · Round: 2

## Round 2 (re-review after fix-review)
Commits since round 1: `d28ae40` (R1), `26ba30a` (R2), `940ca50` (lesson), `5886114` (triage). No other code changed.

| Finding | Check | Result |
|---------|-------|--------|
| R1 | `apps/api/test/insights.int.test.ts:270-296` now inserts an `opportunity_evidence` row (`REPEAT_IMPORT`, as `modules/signals/ingest.ts:66` does) linking a Feed B signal to the opportunity; the opportunity has three transitions, so an evidence-based attribution would add a Feed B group and fail `before.bySource == [Feed A]` and `after.bySource` length 1; the new assertion ties the Feed A group to the totals; `corrected` renamed to `before` | fixed |
| R2 | `grep -rn paymentsCount apps/web/src` finds nothing | fixed |
| Lesson | `context/lessons.md` gains the R1 rule, `Status: proposed in the PR for insights`, same shape as the other entries | ok |

No new findings in round 2.

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/contracts/src/insights.ts` | done | `InsightsQuery`, `Insights`, `IsoWeek`/`IsoMonth`; `isoWeeksInYear` here is a logged deviation |
| `packages/contracts/src/index.ts` | done | exports |
| `packages/contracts/src/status.ts` | done | `WorkCost`, `WorkRequest` (D-6) |
| `packages/contracts/src/opportunities.ts` | done | `ActivityMetadata.minutes/cost`, `ActivityEvent` `WORK` + `work` |
| `apps/api/src/modules/shared/warsaw-day.ts` | done | ISO-week helpers, `addCalendarDays` (logged) |
| `apps/api/src/modules/shared/warsaw-day.test.ts` | done | year-end rows, reason recorded in Deviations |
| `apps/api/src/modules/insights/{ports,calculate,service,routes}.ts` | done | D-1…D-5, D-8…D-11; all-time status events filtered in the calculator (logged deviation) |
| `apps/api/src/infrastructure/db/insights-repository.ts` | done | primary-signal join only (D-8) |
| `apps/api/src/infrastructure/db/activity-repository.ts` | done | `addWork` |
| `apps/api/src/modules/opportunities/{ports,service,routes}.ts` | done | `POST /api/opportunities/:id/work`, metadata parsed before insert (lesson) |
| `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/test/helpers/app.ts` | done | wiring |
| `apps/api/test/insights.int.test.ts` | done | four cases; D-8 case links the second source through `opportunity_evidence` (R1 fixed in round 2) |
| `apps/api/test/opportunity-actions.int.test.ts` | absent | planned "only if" a shape it asserts changed; not needed |
| `apps/web/src/api/insights.ts` | done | |
| `apps/web/src/InsightsPage.tsx`, `InsightsPage.module.css` | done | D-12 |
| `apps/web/src/App.tsx` | done | route and nav |
| `apps/web/src/strings.pl.ts` | done | unused string removed (R2 fixed); `formatMinor` sign fix logged |
| `apps/web/src/CardPipeline.tsx` | done | "Czas i koszty" form |
| `apps/web/src/api/opportunities.ts` | done | `addWork` |
| `apps/web/src/opportunityCard.ts` | done | `WORK` history line |
| `apps/web/src/OpportunityPage.tsx` | done | `WORK` label (plan-review 4, logged) |
| `apps/web/src/opportunityCard.test.ts` | done | `work: null` + one row (plan-review 3, logged) |
| `apps/web/src/profileForm.ts`, `profileForm.test.ts` | unplanned | `hoursToMinutes`; logged under Deviations (Phase 4) |
| `apps/web/src/strings.pl.test.ts` | unplanned | negative amount row; logged (Phase 3) |
| `e2e/vertical-main-path.spec.ts` | done | offers sent, contact, "brak danych", payment sum, no overflow; evidence only with `E2E_EVIDENCE=1` |
| `README.md` | done | *Co działa* |
| `context/roadmap.md` | unplanned | status column only |
| `context/changes/insights/evidence/insights-360.jpg` | done | human-check evidence |

## Areas
| Area | Result (ok / concern / fail) | One-line reason |
|------|------------------------------|-----------------|
| Correctness | ok | Checked D-2…D-10 against `checkMove`: contacts, replies via `skipped`, latest-WON wins, per-currency sums, `[from, to)` Warsaw bounds, year-end keys; no wrong number found |
| Design | ok | Follows the digest module pattern; pure calculator over fact rows; contract in one file |
| Safety | ok | Query and body strict Zod schemas, metadata validated before insert, notes not logged, route behind auth (TR-13 test) |
| Tests | ok | Round 2: the D-8 test now links Feed B through `opportunity_evidence` (R1 fixed) |
| Simplicity | ok | Round 2: the unused string is gone (R2 fixed) |
| Plan fidelity | ok | Every divergence is logged under Deviations |
| Agent decisions | ok | D-1/D-10 (`Insights` shape) live in `packages/contracts/src/insights.ts`; D-6 in `WorkRequest`/`ActivityMetadata` and `addWork`; option B (a table) would replace only the repository's `workEntries` and `addWork` |

## Findings
### R1: The primary-source test does not attach the second source's signal
- Severity: major
- Where: `apps/api/test/insights.int.test.ts:270-291`
- Problem: The case says "Feed B saw the same item later; it attaches to the opportunity of Feed A", but it inserts a `signal_identities` row with the value `https://example.invalid/b`, which no signal has, and then a Feed B `raw_signals` row (`canonicalUrl https://example.invalid/<n>`) with no `opportunity_evidence` row. In the real attach path (`signal-repository.ts`, `insertEvidence`) a later signal is linked through `opportunity_evidence.raw_signal_id`. Here nothing links the Feed B signal to the opportunity, so the assertion that only Feed A appears holds for any attribution rule. An attribution through evidence (count under every source, or under the latest signal) would pass the same test. This breaks the lesson "When a per-source rule writes to a shared, deduplicated record, decide and test what a second source that disagrees does", which the plan cites for D-8. The variable `corrected` (line 286) also holds the result from before the correction, which makes the case harder to read.
- Fix: Insert an `opportunity_evidence` row that links the Feed B signal to the opportunity (or let a second signal arrive through the real ingest path with the same canonical URL), give Feed B a payment or move that would show up if attribution followed evidence, and assert that `bySource` still holds only Feed A and that the groups still sum to the totals. Rename `corrected` to `before`.
- Effort: small
- Lesson candidate: A test that names a cross-record situation must create the real link the production path creates, not a look-alike row
- Decision: fixed (d28ae40) + lesson proposed

### R2: Unused string `insights.paymentsCount`
- Severity: minor
- Where: `apps/web/src/strings.pl.ts:241`
- Problem: `paymentsCount: (n) => \`${n}\`` is never referenced (`grep -rn paymentsCount apps/web/src` finds only its definition). It is dead code in the file that holds all UI text.
- Fix: Remove it.
- Effort: small
- Lesson candidate: no
- Decision: fixed (26ba30a)
