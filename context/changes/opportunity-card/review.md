# Review: opportunity-card

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (34 files, 406 tests), e2e ok (4 tests), image fail (environment: corepack cannot fetch pnpm 12.15.0 inside the build, "self-signed certificate in certificate chain" from the sandbox proxy, at `RUN pnpm install --frozen-lockfile`, before any project code; the Dockerfile is not part of this diff, same failure as in the analysis-and-scoring review), mutation not run (S-06 has no module in *Mutation targets*; no `mutation.md`) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/contracts/src/analysis.ts` | done | v2, `mvpScope`/`exclusions` as `shortList`, `upgradeStoredAnalysis` |
| `packages/contracts/src/analysis.test.ts` | done | v1 upgrade, v2 without the fields fails, 500-char limit |
| `apps/api/src/modules/opportunities/service.ts` | done | upgrade on read; `changeStatus`/`addNote`; detail with `activity` |
| `apps/api/src/infrastructure/llm/mock.ts` | done | per-category `DEMO / MOCK:` lists |
| `apps/api/src/infrastructure/llm/mock.test.ts` | absent | "if it pins the output"; it parses with the schema only, so no change was needed |
| `apps/api/test/opportunities.int.test.ts` | done | seeded v1 row still reads with empty lists |
| `apps/api/test/helpers/analysis.ts` | done | plan-review #1 |
| `apps/api/test/analysis.int.test.ts` | unplanned | `schemaVersion` 1 → 2; logged under *Deviations* |
| `docs/scoring.md` | absent | logged: it does not describe the schema |
| `packages/contracts/src/status.ts`, `index.ts` | done | D-6, D-7; refine on the REJECTED member with `path: ['note']` |
| `packages/contracts/src/opportunities.ts` | done | `ActivityCause`, `ActivityEvent`, `OpportunityDetail.activity` |
| `apps/api/src/infrastructure/db/schema.ts`, `migrations/0005_*`, meta | done | additive table + index, FK cascade |
| `apps/api/src/infrastructure/db/activity-repository.ts` | done | no `list` (logged); one transaction, conditional update |
| `apps/api/src/infrastructure/db/opportunity-repository.ts` | done | activity newest first, tie on id |
| `apps/api/src/infrastructure/db/analysis-repository.ts` | done | `savePrefilter` in a transaction; system event only when the status read was `NEW` (plan-review #3) |
| `apps/api/src/modules/opportunities/{ports,routes}.ts` | done | 200/400/404/409 as D-5 |
| `apps/api/src/server.ts`, `apps/api/test/helpers/app.ts` | done | wiring |
| `apps/api/test/opportunity-actions.int.test.ts` | done | all planned cases, plus operator-first then insufficient-data |
| `apps/web/src/opportunityCard.ts` | diverged | `pricingAssumptions` tagged `estimate`, Design says `inference` (R3); excerpt sliced by UTF-16 unit (R4) |
| `apps/web/src/opportunityCard.test.ts` | done | four states, tags per value, no invented values |
| `apps/web/src/OpportunityPage.tsx`, `OpportunityPage.module.css` | diverged | renders the card; also drops source type, `fetchedAt`, availability and last verification from the page without a deviation (R2) |
| `apps/web/src/strings.pl.ts` | done | new texts; ~24 old keys now unused (R2) |
| `apps/web/src/api/opportunities.ts` | done | `changeStatus`, `addNote`, outcome union |
| `apps/web/src/CardActions.tsx` | done | buttons by `operatorMoves`, D-13; shared textarea state (R1) |
| `e2e/smoke.spec.ts` | done | twelve headings, save, note, reject form + overflow; evidence only with `E2E_EVIDENCE=1` |
| `README.md` | done | *Co działa* updated |
| `context/changes/opportunity-card/evidence/*.jpg` | done | JPEG logged under *Deviations* |
| `context/roadmap.md` | unplanned | status column only |

## Areas
| Area | Result (ok / concern / fail) | One-line reason |
|------|------------------------------|-----------------|
| Correctness | ok | ACs met; status move and event in one transaction, conditional update, system events only from `NEW`; v1 rows keep reading |
| Design | ok | Card model pure and separate from rendering; one route grows with S-08; repository port small |
| Safety | ok | Bodies validated by strict Zod at the boundary; notes never logged; source text rendered as text; links `noopener noreferrer nofollow` |
| Tests | concern | Behavioural and deterministic; the open note form is never checked for overflow (R6) |
| Simplicity | concern | Dead strings and one dead CSS block after the page rewrite (R2) |
| Plan fidelity | concern | Two unlogged divergences in the web card (R2, R3); plan-review #5 neither applied nor logged (R5) |
| Agent decisions | ok | D-2 lives in `analysis.ts` + one call site; D-4/D-5/D-7 in contracts, one repository, one routes file; swappable as claimed |

## Findings
### R1: Note and rejection forms share one textarea state
- Severity: minor
- Where: `apps/web/src/CardActions.tsx:28`, `:55`
- Problem: both forms bind the same `text` state and `open()` does not clear it. Typing "X" under *Dodaj notatkę*, then clicking *Odrzuć* shows "X" in the rejection note and *Potwierdź odrzucenie* stores it as the rejection's `note`, not as a `NOTE` event. It is visible, so nothing is silent, but the operator's text changes meaning when switching panels.
- Fix: keep separate `noteText` / `rejectNote` state, or clear `text` in `open()` when the panel changes.
- Effort: small
- Lesson candidate: no
- Decision: fixed (e613c90)

### R2: Card rewrite dropped source fields without a deviation and left dead strings and CSS
- Severity: minor
- Where: `apps/web/src/OpportunityPage.tsx` (old `:70-91`), `apps/web/src/strings.pl.ts:141-162`, `:244`, `:282-300`, `apps/web/src/OpportunityPage.module.css:63-75`
- Problem: the old detail page showed source type, `fetchedAt`, availability and last verification time (FR-06 AC3 fields). The new card shows none of them, and *Deviations* does not mention it. S-09 will set availability for URLs, and the card will have nowhere to show "niedostępne". The rewrite also left these keys unused: `modelInference`, `fromSource`, `sourceSection`, `sourceUrl`, `noText`, `fetchedAt`, `availability`, `availabilityValues`, `lastVerifiedAt`, `never`, `analysisSection`, `noAnalysis`, `historyEmpty`, `sourceBudgetTitle`, `noBudget`, `estimatedPrice`, `hypothesis`, `estimatedHours`, `unknownsTitle`, `guardNotesTitle`, `insufficientData`, `failedReason`, `prefilterSkipped`, `nextAction`. The `.components` CSS rule is also unused (checked with grep over `apps/web/src`).
- Fix: add the four source fields to element 2 as untagged app records (or `source` for type), and delete the unused keys and the `.components` rule. Option B: log the removal as a `[minor]` deviation and only delete the dead code.
- Effort: small
- Lesson candidate: When a rewrite removes something the UI used to show, log it as a deviation and delete what it orphaned.
- Decision: fixed (2a566ec; dead code removed, source fields not restored: logged in plan.md, FOLLOW-UP for availability)

### R3: Pricing assumptions tagged `szacunek (hipoteza)`, against the plan's tag rule
- Severity: minor
- Where: `apps/web/src/opportunityCard.ts:222`, `apps/web/src/opportunityCard.test.ts` (`['price', 'hours', 'assumptions']`)
- Problem: the plan's *Design / Web* says everything from `result` is `inference` except source facts/budget (`source`) and `proposedPrice`/`estimatedHours` (`estimate`). FR-11 AC3 lists `szacunek (hipoteza)` for price and hours. `pricingAssumptions` is model output, but it is tagged `estimate`, and the unit test pins that. TR-01 asks for "wniosek modelu" on every inferred field. This is defensible, but it is an unlogged divergence.
- Fix: tag it `inference` and move it to the inference list in the test. Option B: keep `estimate` and record it as a `[minor]` deviation.
- Effort: small
- Lesson candidate: no
- Decision: fixed (ed95999)

### R4: Excerpt cut at 600 UTF-16 units can split an emoji
- Severity: minor
- Where: `apps/web/src/opportunityCard.ts:97-98`
- Problem: `source.snippet.slice(0, 600)` cuts by code unit. With an emoji at positions 599/600, the excerpt ends in a lone surrogate and renders as "�". Checked with `node`: `('a'.repeat(599)+'😀b').slice(0,600).isWellFormed()` is `false`. The API's list excerpt (`service.ts:101`) and `deriveTitle` already cut by code point (`Array.from`), and the second one has a test for it.
- Fix: `const chars = Array.from(source.snippet); excerpt = chars.slice(0, 600).join(''); rest = chars.length > 600`. Add an emoji case to the long-text test.
- Effort: small
- Lesson candidate: no
- Decision: fixed (ed95999)

### R5: Plan-review #5 (where `operatorMoves` lives) neither applied nor logged
- Severity: minor
- Where: `context/changes/opportunity-card/plan.md:94` (D-6), `packages/contracts/src/status.ts:23`
- Problem: plan-review #5 asked to either move the rule into the API (`allowedMoves` on the detail DTO) or record that alternative in D-6. The code keeps the rule in `packages/contracts`, which is fine, but D-6's alternatives do not name `allowedMoves`, and neither *Review response* nor *Deviations* mentions #5. Every other plan-review finding is traceable. If #5 counts as accepted, this is the pattern in the first lesson.
- Fix: add "D: `allowedMoves` computed in the API and carried in `OpportunityDetail` (keeps the rule out of the client; one more DTO field)" to D-6's alternatives.
- Effort: small
- Lesson candidate: no (covered by the existing lesson)
- Decision: fixed (plan.md D-6 alternatives)

### R6: System-event cause is typed `object` and stored unchecked
- Severity: minor
- Where: `apps/api/src/infrastructure/db/analysis-repository.ts:46`
- Problem: `recordSystemMove(..., cause: object, ...)` writes `JSON.stringify(cause)` to `metadata_json`. On read, `toActivity` parses it with `ActivityCause` and silently turns a mismatch into `cause: null`. Today both call sites pass correct literals, but a typo such as `{ kind: 'pre_filter' }` would typecheck and quietly drop the cause from the history. That is the failure mode of the "validate before storing" lesson.
- Fix: type the parameter as `ActivityCause` (from `@lead-hunter/contracts`) so the compiler checks it. Optionally run `ActivityCause.parse(cause)` before the insert.
- Effort: small
- Lesson candidate: no (covered by the existing lesson)
- Decision: fixed (bf19ec6)

### R7: The open note form is not checked for horizontal overflow
- Severity: minor
- Where: `e2e/smoke.spec.ts:172-175`
- Problem: the plan's end state for FR-11 AC4 says the card "including the open reject and note forms" has no horizontal scroll at 360 px. The smoke test opens the note form but calls `assertNoOverflow` only after the reject form is open.
- Fix: call `await assertNoOverflow(page)` after `getByLabel('Notatka', { exact: true })` is visible, before filling it.
- Effort: small
- Lesson candidate: no
- Decision: fixed (a315fbd)
