# Review: pipeline-and-payments

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (36 files, 444 tests), e2e ok (5 tests), image fail (environment: corepack cannot fetch pnpm 12.15.0 inside the build, "self-signed certificate in certificate chain" from the sandbox proxy, at `RUN pnpm install --frozen-lockfile`, before any project code; the fix commits touch no Dockerfile, `package.json` or lockfile; same failure as round 1), mutation not run (no S-08 module is in *Mutation targets*; no `mutation.md`) · Round: 2

## Re-review of round 1
| Finding | Marked | Verified | Evidence |
|---------|--------|----------|----------|
| R1 | fixed | partly | `NEEDS_VERIFICATION` now starts from rank 0, records `skipped` and stops at `CONTACTED` (`status.ts:96-100`, tests in `status.test.ts` and `pipeline-status.int.test.ts`). The same side door is still open through `REJECTED`/`EXPIRED` (R6) |
| R2 | fixed | yes | D-8, D-9, D-11 are `costly (public API: PipelineResponse)` in `plan.md` |
| R3 | fixed | yes | `CardActions.tsx:128-131` refuses dates without a value with `contractValueRequired` |
| R4 | fixed | yes | `e2e/vertical-main-path.spec.ts:88-93` asserts the `dd` exactly; e2e passes |
| R5 | fixed | yes | `activity-repository.ts:41-44` passes `followUpCleared`; stored as `followUpCleared: true`, rendered by `eventDetails`; positive and negative integration cases |

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/contracts/src/status.ts` | done | `checkMove`, `OPERATOR_TARGETS`, `FOLLOW_UP_STATUSES`, `Contract`, `calendarDate`, `FollowUpRequest`, `PaymentRequest`; `operatorMoves` removed. Plain `z.union` logged as [minor] |
| `packages/contracts/src/status.test.ts` | done | table tests for D-1 and the request refines |
| `packages/contracts/src/opportunities.ts` | done | `ActivityMetadata` (one strict object, logged), `ActivityEvent` fields, `Payment`, `OpportunityDetail.followUpOn/payments` |
| `packages/contracts/src/pipeline.ts` | done | `PIPELINE_STAGES`/`PIPELINE_STAGE_LIMIT` here (logged) |
| `packages/contracts/src/index.ts` | done | exports |
| `apps/api/src/modules/opportunities/{ports,service,routes}.ts` | done | `decide` callback, 409 enum, metadata validated before insert, follow-up and payment routes, clock-based 400s |
| `apps/api/src/infrastructure/db/activity-repository.ts` | done | `note_required`, clears `follow_up_at` outside `FOLLOW_UP_STATUSES` (plan-review 4, logged) |
| `apps/api/src/infrastructure/db/schema.ts`, `migrations/0006_tidy_korvac.sql`, `meta/*` | done | additive: `follow_up_at` + index, `payments` with CHECKs |
| `apps/api/src/modules/shared/warsaw-day.ts` (+ test) | done | DST days 2026-10-25 and 2027-03-28 covered |
| `apps/api/src/infrastructure/db/payment-repository.ts` | done | |
| `apps/api/src/infrastructure/db/opportunity-repository.ts` | done | detail reads follow-up and payments |
| `apps/api/src/modules/pipeline/{ports,service,routes}.ts` | done | |
| `apps/api/src/infrastructure/db/pipeline-repository.ts` | done | `contacted` per the Phase 1 [REVIEW] note, `json_each` guarded by `json_valid` |
| `apps/api/src/app.ts`, `server.ts`, `test/helpers/app.ts` | done | wiring |
| `apps/api/test/pipeline-status.int.test.ts` | done | FR-14 AC1–AC4, FR-15 AC1–AC2, TR-04 under the global `disableNetConnect()` |
| `apps/api/test/opportunity-actions.int.test.ts` | done | plan-review 1 applied; intent kept, `note_required` case added |
| `apps/web/src/CardActions.tsx` | done | `checkMove`, working "Oznacz jako kontakt", "Zmień status" panel |
| `apps/web/src/CardPipeline.tsx` | done | |
| `apps/web/src/api/opportunities.ts`, `api/pipeline.ts` | done | |
| `apps/web/src/opportunityCard.ts` (+ test) | done | `eventDetails` |
| `apps/web/src/OpportunityPage.tsx`, `OpportunityPage.module.css` | done | |
| `apps/web/src/PipelinePage.tsx`, `PipelinePage.module.css` | done | `DueFollowUps` in the same file (logged) |
| `apps/web/src/App.tsx` | done | `/lejek`, nav, "Na dziś" on `/` |
| `apps/web/src/strings.pl.ts` (+ test) | done | `formatMinor` pinned (plan-review 9) |
| `apps/web/src/warsawTime.ts` (+ test) | unplanned | `warsawToday`, `formatCalendarDate`; logged as [minor] in Phase 4 |
| `e2e/main-path.spec.ts` → `e2e/vertical-main-path.spec.ts` | done | renamed for serial order; logged as [minor] |
| `e2e/smoke.spec.ts` | unplanned | plan-review 2; logged as [minor] |
| `playwright.config.ts` | unplanned | `workers: 1`; logged as [minor] |
| `e2e/env.ts` | done | login-budget comment |
| `context/test-plan.md` | done | TR-14 covered |
| `context/roadmap.md` | unplanned | status column only (workflow) |
| `context/changes/pipeline-and-payments/{plan,plan-review}.md`, `evidence/*.jpg` | done | evidence written only with `E2E_EVIDENCE=1` (lesson); images under 300 KB |

## Areas
Round 2 covers the fix commits `c625db4..4c343f0`; the round-1 *Plan vs diff* below still holds for the rest. The fix commits add no file outside that table except `context/lessons.md` (lesson proposal, separate commit `de3bea9`).

| Area | Result (ok / concern / fail) | One-line reason |
|------|------------------------------|-----------------|
| Correctness | concern | R1 closed the `NEEDS_VERIFICATION` door, but `REJECTED`/`EXPIRED` still lead to `MEETING → WON` with no contact recorded (R6) |
| Design | ok | the rule stays in one pure `checkMove`; the follow-up flag is decided in the transaction that clears it |
| Safety | ok | `followUpCleared` is a strict `z.literal(true)` in the stored metadata; nothing new crosses the boundary unvalidated |
| Tests | ok | each fix has a behaviour test (unit, integration, e2e); the R6 path has none |
| Simplicity | ok | small, local fixes |
| Plan fidelity | concern | round-1 deviations sit under *Review response*, not *Deviations*; three plan/doc lines are stale (R7) |
| Agent decisions | ok | D-8, D-9, D-11 now `costly`; D-1 updated in place for R1 |

## Findings
### R1: `NEEDS_VERIFICATION` bypasses "WON/LOST only after CONTACTED" and "moving back needs a note"
- Severity: major
- Where: `packages/contracts/src/status.ts:94` (`if (from === 'NEEDS_VERIFICATION') return forward();`) with `:88` (`ASIDE` from anywhere, no note)
- Problem: the roadmap's user rule (S-08 *Decided up front*) is: forward moves may skip stages and the skipped stages are recorded; moving back needs a note; `WON`/`LOST` only after `CONTACTED`. Probed `checkMove` from the built contracts: `WON → NEEDS_VERIFICATION` is `aside` with no note, then `NEEDS_VERIFICATION → MEETING` is `forward` with `skipped: []` and no note, so a back move WON → MEETING happens without the note that the direct move requires (`WON → MEETING` is `back`, `noteRequired: true`). The same two clicks reopen a `REJECTED` row without a note (`REJECTED → NEEDS_VERIFICATION → SAVED`). And since the mock analysis (and any analysis with gaps) leaves new rows in `NEEDS_VERIFICATION`, `NEEDS_VERIFICATION → MEETING → WON` wins an opportunity that was never contacted, while the history shows no skipped stages. The Phase 1 [REVIEW] deviation acknowledges the missing `CONTACTED` in history and only adjusts the `contacted` count; the note bypass is not logged anywhere.
- Fix: make leaving `NEEDS_VERIFICATION` a main-path move from rank 0: `forward` with `skipped` = the main stages before the target (so `NEEDS_VERIFICATION → MEETING` records `QUALIFIED…REPLIED`, `CONTACTED` included), and refuse `WON`/`LOST` from it as today. Option B (stricter, closes the note bypass too): from `NEEDS_VERIFICATION`, `REJECTED` and `EXPIRED` allow only main targets up to `CONTACTED`, so later stages always pass through a recorded contact. Either way add the two-step cases to `status.test.ts` and record the choice as a *Decisions* row (it changes D-1).
- Effort: small
- Lesson candidate: "When a rule has side doors (states reachable from anywhere), test the rule's invariants over two-step paths, not just single moves."
- Decision: fixed (c625db4, 1ac47dc) + lesson proposed

### R2: The `GET /api/pipeline` contract has no `costly` decision, so it misses *Decisions to confirm*
- Severity: major
- Where: `context/changes/pipeline-and-payments/plan.md:80-83` (D-8, D-9, D-11 marked `cheap`), deviation at `plan.md:290-293`
- Problem: plan-review finding 5 asked to mark D-8/D-9 `costly` (public API: `followUpsDue`, the `totals` semantics) or add one `costly` row for the `PipelineResponse` shape. The plan says only that findings 5 and 6 "stand for the PR", with no reason and no change, while `autonomy.md` §2 makes a public API contract `costly` and D-4/D-7 in the same plan are marked costly for that reason. The lesson "When a plan-review finding is accepted, apply its primary fix or log why not" is not met, and `/pr-body` builds *Decisions to confirm* from the costly rows, so the reviewer will not be asked about the pipeline shape or what "Kontakt (wysłane)" counts.
- Fix: set D-8 and D-9 (and D-11, which shapes `stages`/`otherCounts`) to `costly (public API: PipelineResponse)`; the shape already lives in one file (`packages/contracts/src/pipeline.ts`).
- Effort: small
- Lesson candidate: no (covered by the existing lesson)
- Decision: fixed (plan.md: D-8, D-9, D-11 now costly)

### R3: WON contract dates are dropped without a word when no value is entered
- Severity: minor
- Where: `apps/web/src/CardActions.tsx:128-141`
- Problem: the contract is built only `if (contractValue.trim())`. An operator who fills "Planowany start"/"Planowany koniec" but leaves "Wartość umowy" empty gets a 200 and a WON event with `contract: null`; the dates are gone with no error. The schema needs value and currency together (D-3), so the dates cannot be stored on their own.
- Fix: if either date is set and the value is empty, show an error (e.g. "Podaj wartość umowy, aby zapisać daty.") instead of submitting.
- Effort: small
- Lesson candidate: no
- Decision: fixed (4c343f0)

### R4: The e2e pipeline totals assert substrings, so wrong counts would still pass
- Severity: minor
- Where: `e2e/vertical-main-path.spec.ts:89-92`
- Problem: `total('Wygrane')` is the `div` holding `<dt>Wygrane</dt><dd>0</dd>`, and `toContainText('0')` also passes for 10, 20 or 101; `Kontakt (wysłane)` with `'1'` passes for 10, 11, 21. The integration test pins exact numbers, so this only weakens the UI half of FR-15 AC2.
- Fix: assert the `dd` exactly, e.g. `page.locator('dt', { hasText: 'Wygrane' }).locator('xpath=following-sibling::dd[1]')` with `toHaveText('0')` (and for "Opłacone", the leading count with a regex `^1\b`).
- Effort: small
- Lesson candidate: no
- Decision: fixed (089b2f3)

### R5: A status move clears the follow-up without a history entry
- Severity: minor
- Where: `apps/api/src/infrastructure/db/activity-repository.ts:27`
- Problem: setting and clearing a follow-up by hand each writes a `FOLLOW_UP` event ("ustawiono na …" / "usunięto"), but a move out of `CONTACTED`/`REPLIED`/`MEETING` sets `follow_up_at = null` silently. The history then ends at "ustawiono na 30.10.2026" while the card shows no follow-up, so the operator cannot see why the reminder vanished from "Na dziś".
- Fix: when the move clears a non-null `follow_up_at`, add `followUpCleared: true` to that status event's metadata (or insert a `FOLLOW_UP` `{ on: null }` event in the same transaction) and render it in `eventDetails`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (4c343f0)

### R6: `REJECTED`/`EXPIRED` still lead to `WON` without a recorded contact
- Severity: major
- Where: `packages/contracts/src/status.ts:93` (`if (from === 'REJECTED' || from === 'EXPIRED') return back;`); claim at `context/changes/pipeline-and-payments/plan.md:317-322`
- Problem: the R1 fix capped only `NEEDS_VERIFICATION`. Probed `checkMove` from the built contracts: `NEW → REJECTED` is `aside` (no note), `REJECTED → MEETING` is `back` with `skipped: []` (note only), `MEETING → WON` is `forward`. So a row that was never contacted is won in three moves and its history shows no `CONTACTED` and no skipped stages; `EXPIRED → REPLIED` behaves the same. Round 1's option B named all three off-path states. The plan's R1 entry says "a later stage always passes a recorded contact", which the code does not guarantee, and the new proposed lesson ("test invariants over two-step paths") is not applied to this path. The `contacted` total stays right only because `pipeline-repository.ts:8` counts any move to `REPLIED…LOST`.
- Fix: A (matches option B and the plan's claim): in `checkMove`, from `REJECTED`/`EXPIRED` allow only main targets up to `CONTACTED` (still `back`, note required), and add the three-step case `NEW → REJECTED → MEETING` (refused) to `status.test.ts` and the integration test. B (keeps reopening to any stage with a note as a deliberate correction): leave the code, fix the plan's R1 entry and D-1 to say reopening with a note may skip the contact, and add a test pinning that.
- Effort: small
- Lesson candidate: no (the lesson proposed in round 1 covers it)
- Decision: open

### R7: Round-1 deviations are outside *Deviations*, and three statements are now stale
- Severity: minor
- Where: `context/changes/pipeline-and-payments/plan.md:315-326` (*Review response*), `plan.md:284-289`, `plan.md` D-1 ("`skipped` = ... from a main stage, else `[]`"), `packages/contracts/src/status.ts:67`
- Problem: the R1 `[REVIEW]`, R2 `[REVIEW]` and R5 `[minor]` entries are under *Review response*, which the template reserves for plan-review findings in revise mode; `/pr-body` takes `[REVIEW]` items from *Deviations*, so the D-1 change and its stated remaining gap (`WON → NEEDS_VERIFICATION → SAVED` with no note) may not reach the reviewer. The Phase 1 `[REVIEW]` still says `skipped` "stays `[]` out of `NEEDS_VERIFICATION`", D-1 still says `skipped` is `[]` unless the move starts on a main stage, and the `MoveCheck.skipped` doc comment says the same; all three are false since `c625db4`. The R5 entry also widens D-2's `costly` stored shape and DTO (`followUpCleared`) without naming D-2.
- Fix: move the three entries under *Deviations*; update the Phase 1 note, the D-1 `skipped` sentence and the `status.ts:67` comment to "from a main stage or from `NEEDS_VERIFICATION` (rank 0)"; name D-2 in the R5 entry (additive).
- Effort: small
- Lesson candidate: no
- Decision: open
