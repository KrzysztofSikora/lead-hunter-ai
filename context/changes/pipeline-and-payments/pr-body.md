# feat(pipeline-and-payments): pipeline stages, follow-ups, wins and payments

Roadmap item S-08. The operator can now move an analysed opportunity through the §10.1 stages under the user's transition rule, record contact, a follow-up date, a win with contract value and real payments (kept apart from `WON`), and see contacted / won / paid counted separately in a Pipeline view (`/lejek`). Covers FR-14 AC1–AC3 and AC4's first half (follow-up on the day, nothing sent) and FR-15 AC1–AC2. The main-path e2e passes, minus the draft step (D-13).
Closes #9

> **Status:** Ready for review

## ⚠ Needs your decision
- **D-2 (costly):** where skipped stages live → chose **`metadata_json.skipped` written at move time; `ActivityMetadata` is one stored object, DTO `ActivityEvent` gains `skipped`, `contract`** (review R5 added `followUpCleared`). Alternatives: B: one extra `STATUS_CHANGE` row per skipped stage (invents moves that never happened); C: derive from from/to on read (a later rank change would rewrite history). Switching costs: stored JSON shape, API DTO.
- **D-3 (costly):** WON contract data → chose **in the `WON` event's `metadata_json.contract`** (PRD data model). Alternatives: B: columns on `opportunities` (easier SQL for S-14, second copy of event data); C: a `contracts` table. Switching costs: stored data shape, migration.
- **D-4 (costly):** status request shape → chose **widen `StatusChangeRequest` additively; 409 `note_required` / `transition_not_allowed`**. Alternatives: B: 400 for a missing note; C: one endpoint per status. Switching costs: public API, `packages/contracts`, web client.
- **D-5 (costly):** calendar dates → chose **`YYYY-MM-DD` as a Europe/Warsaw day; `follow_up_at` and `paid_at` store that day's Warsaw midnight as UTC epoch ms**. Alternatives: B: store `YYYY-MM-DD` text (breaks "UTC in the database" literally); C: full instants from the client. Switching costs: persisted data, migration.
- **D-7 (costly):** follow-up model → chose **one `opportunities.follow_up_at` column + `PUT /api/opportunities/:id/follow-up`; cleared on every move outside CONTACTED/REPLIED/MEETING**. Alternatives: B: events only; C: a `follow_ups` table with several reminders. Switching costs: migration, public API.
- **D-8 (costly):** due follow-ups before S-13 → chose **`followUpsDue` inside `GET /api/pipeline`, shown as "Na dziś: follow-up" on the start view**. Alternatives: B: a separate `GET /api/follow-ups/due`; C: wait for S-13. Switching costs: public API (`PipelineResponse`).
- **D-9 (costly):** what "sent, won, paid" count → chose **`contacted` = distinct opportunities with a move to CONTACTED (or later, or CONTACTED in `skipped`); `won` = status is `WON`; `paid` = opportunities with ≥ 1 payment plus per-currency sums, never converted; UI label "Kontakt (wysłane)"**. Alternatives: B: `sent` from `SENT_MANUALLY` drafts (the PRD's meaning, impossible before S-07); C: `won` = ever won. Switching costs: public API (`PipelineResponse`).
- **D-10 (costly):** payment lifecycle → chose **append-only `payments` table with CHECKs, allowed in every status, no edit/delete**. Alternatives: B: delete with confirmation (S-15 owns deletes); C: only after `WON`. Switching costs: migration.
- **D-11 (costly):** Pipeline view → chose **seven stages with up to 50 items each, the other five as counts linking to `/okazje?status=…`**. Alternatives: B: all twelve stages with items; C: a kanban board. Switching costs: public API (`PipelineResponse`).
- **[REVIEW] R1 / D-1:** `NEEDS_VERIFICATION` was a free pass around "WON/LOST only after CONTACTED". Leaving it is now a forward move from rank 0 (stages passed over are recorded in `skipped`) and reaches only stages up to `CONTACTED`. Alternative: record skipped but allow any target. Remaining gap: `WON → NEEDS_VERIFICATION → SAVED` is two legal moves with no note; closing it needs history-aware rules (D-1 option C).
- **[REVIEW] R6 / D-1:** `REJECTED`/`EXPIRED` could be reopened to `MEETING` and won with no contact. A reopen now reaches only stages up to `CONTACTED` (still needs a note). Alternative: reopen to any stage with a note, and change the claim instead.
- **[REVIEW] Phase 1, plan-review finding 3:** moves out of `REJECTED`/`EXPIRED` record no `skipped`, so `contacted` counts any operator move to CONTACTED, REPLIED, MEETING, WON or LOST, or CONTACTED in `skipped`. Alternative: invent skipped stages for reopen moves.
- **[REVIEW] Phase 2 / plan-review 5, 6:** the S-08 roadmap acceptance is met minus the draft step, because S-08 depends on S-06 only (D-13). D-8, D-9, D-11 were marked costly after review R2.
- **Plan review / review leftovers:** None. Plan review READY WITH NOTES (10 findings; those applied are logged as [minor] deviations in the plan); review round 2 ended with 0 open findings.

Reply in a review comment, e.g. `D-3: take B`, `R4: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 4) Card at 360 px and on a laptop: "Zmień status" wording, required-note hint on a back move, WON contract fields, follow-up and payment forms; typing "1234,50" PLN shows "1 234,50 PLN". Run: `docker compose up --build`, import a DEMO post, open its card at /okazje/<id>, Zapisz → Oznacz jako kontakt → Zmień status → Wygrana. Evidence: [card-contacted-360.jpg](evidence/card-contacted-360.jpg) (from the main-path e2e; the plan listed none for this check)
- [ ] (Phase 5) Pipeline view (`/lejek`) and the "Na dziś" list on the start view at 360 px and on a laptop: wording "Kontakt (wysłane)", per-currency sums, counts-only rows linking to the filtered list. Run: `docker compose up --build`, import a DEMO post, Zapisz → Oznacz jako kontakt → follow-up → payment, then open / and /lejek. Evidence: [card-contacted-360.jpg](evidence/card-contacted-360.jpg), [today-360.jpg](evidence/today-360.jpg), [pipeline-360.jpg](evidence/pipeline-360.jpg)

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-1 | The transition rule | One pure `checkMove(from, to)` in `packages/contracts/src/status.ts`, shared by API and web; `operatorMoves` removed | B: explicit 12×12 allow table; C: "ever contacted" read from history |
| D-6 | Time of a status event | Server time, no backdating | B: optional `occurredAt` on every change |
| D-12 | FR-14 AC4 follow-up suggestion for `SENT_MANUALLY` drafts | Not built (no drafts until S-07); nothing is suggested or sent | B: build it against a stub draft status |
| D-13 | Draft step of the e2e main path | Spec skips `OFFER_DRAFTED` and asserts "Przygotuj ofertę" is still disabled | B: wait for S-07; C: a fake draft step |
| D-14 | Card UI for status changes | Working "Oznacz jako kontakt" + "Zmień status" panel driven by `checkMove`; follow-up and payment forms on the card | B: one button per status; C: status only on the Pipeline view |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (36 files, 444 tests), e2e ok (5 tests), **image fail (environment)**: corepack cannot fetch pnpm 12.15.0 inside the build ("self-signed certificate in certificate chain" from the sandbox proxy, at `RUN pnpm install --frozen-lockfile`, before any project code); the change touches no Dockerfile, `package.json` or lockfile; same failure in both rounds. Worth a build on a machine without the proxy.
- Review: APPROVE WITH FOLLOW-UPS, round 2: round 1 fixed 5 (R1–R5), round 2 fixed 2 (R6, R7), deferred 0, rejected 0. See [review.md](review.md).
- Mutation: skipped: no S-08 module is in *Mutation targets* in `context/test-plan.md`, so there is no `mutation.md`; `bug` mutants: none.
- Proposed lessons: "When a rule has side doors, test its invariants over two-step paths, not only single moves" (commit `de3bea9`; drop it to reject the lesson).

## Follow-ups
- [FOLLOW-UP] S-07: insert the draft step ("Przygotuj ofertę" → … → "Oznacz jako wysłane") into `e2e/vertical-main-path.spec.ts` (D-13) and add the follow-up suggestion for `SENT_MANUALLY` drafts (FR-14 AC4 second half, D-12).
- [FOLLOW-UP] S-14: "sent" should count `SENT_MANUALLY` drafts once they exist (D-9); weekly figures read the WON event's contract metadata (D-3).
- Payments cannot be edited or deleted here (D-10); corrections are an additive follow-up (S-15 owns deletes).

## Commits
```
5312b35 docs(pipeline-and-payments): triage review round 2
bcb7215 fix(pipeline-and-payments): reopening REJECTED/EXPIRED stops at CONTACTED (R6)
0ac3ae0 docs(pipeline-and-payments): review
a597858 docs(pipeline-and-payments): triage review round 1
de3bea9 docs(pipeline-and-payments): propose lessons
4c343f0 fix(pipeline-and-payments): contract dates need a value; history says when a move cleared the follow-up (R3, R5)
089b2f3 fix(pipeline-and-payments): assert exact pipeline totals in the e2e (R4)
1ac47dc fix(pipeline-and-payments): format checkMove (R1)
c625db4 fix(pipeline-and-payments): leaving NEEDS_VERIFICATION records skipped stages and stops at CONTACTED (R1)
5856a73 docs(pipeline-and-payments): review
b7c29b6 feat(pipeline-and-payments): pipeline view, follow-ups on the start view and the main-path e2e
ca670a7 feat(pipeline-and-payments): card status panel, contact, follow-up and payments
c70a6fd feat(pipeline-and-payments): pipeline summary API
6d11f84 feat(pipeline-and-payments): follow-ups and payments
3af2570 feat(pipeline-and-payments): transition rules and the widened status API
d593047 docs(pipeline-and-payments): plan-review
b4361d8 docs(pipeline-and-payments): plan
```

<details><summary>Run</summary>

Ship run S-08, base `main`, no stops. Steps (all attempt 1, all success): plan (opus, $1.52) → plan-review (opus, $0.92, READY WITH NOTES) → implement ×5 phases (sonnet, $0.54 + $0.57 + $0.44 + $0.57 + $0.45) → review round 1 (opus, $1.45, APPROVE WITH FOLLOW-UPS, 5 open) → fix-review (sonnet, $0.50) → review round 2 (opus, $0.71, 2 open) → fix-review (sonnet, $0.20) → pr-body. Phases ticked 5/5; open findings 0. Total about $7.87 before pr-body.
</details>

https://claude.ai/code/session_01L7xnPWXcnFkaxbXFZSCLFq
