# Review: code-bounties

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (71 files, 1048 tests), image not run (no Docker daemon in the sandbox), image smoke not run (same), e2e ok (5/5), mutation reward.ts 96.50 % (target 80 %; 138 killed, 4 survived, 1 no coverage, all five decided in mutation.md) · Round: 2

Round 2 re-checks the fixes for R2–R6 (commits `2f9f5c4`, `000a4f7`, `a576990`, `8620d20`). R2, R4, R5 and R6 are fixed as described. R3 is fixed, but the fix widened D-5 beyond what R3 asked (R7). R1 stays deferred: the same three commits still carry the trailer, and no later commit has one.

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/contracts/src/opportunities.ts` | done | `SourceType` += `github`, `opire`; strict `BountyFacts` with the planned bounds |
| `packages/contracts/src/sources.ts`, `sources.test.ts` | done | `SourceKind`, `GITHUB_LANGUAGES`, `GithubSearchConfig` (incl. the query-length refine from plan-review 11), `OpireConfig`, `Source.github`, `SourcePreset.type`, `UpdateSourceRequest.github` |
| `packages/contracts/src/index.ts` | done | exports |
| `packages/config/src/env.ts`, `env.test.ts`, `.env.example` | done | `GITHUB_TOKEN` → `config.github.token` |
| `apps/api/src/infrastructure/db/schema.ts`, `migrations/0012_bounty_facts.sql`, `migrations/meta/*` | done | nullable `raw_signals.bounty_json` |
| `apps/api/src/modules/sources/ports.ts` | done | generic port, `DiscoverContext.seen`, `truncated`, `checkedKeys` (D-16) |
| `apps/api/src/modules/sources/service.ts` | done | registry by type, bounty facts validated before ingest, `createTyped`, PATCH `github`, per-type endpoint |
| `apps/api/src/modules/sources/routes.ts` | done | `not_github_source` → 400 (deviation logged) |
| `apps/api/src/modules/signals/ingest.ts`, `ports.ts` | done | `bountyJson` |
| `apps/api/src/infrastructure/db/signal-repository.ts` | absent | not needed: `insertSignal` spreads `NewSignal`, so the new field is stored without a change |
| `apps/api/src/infrastructure/db/source-repository.ts` | done | type from the row, `insert(type)`, `update(configJson)` |
| `apps/api/src/infrastructure/sources/rss/adapter.ts` | done | `SourceAdapter<RssConfig>` |
| `apps/api/src/infrastructure/sources/compose.ts` | done | registers `rss`, `github`, `opire`; `adapters` and `profile` |
| `apps/api/src/infrastructure/sources/http/client.ts`, `test/http-client.int.test.ts` | done | headers on first hop and same-origin hops only, dropped for good after an origin change |
| `apps/web/src/strings.pl.ts` | done | type labels and editor texts |
| `apps/api/src/infrastructure/sources/github/reward.ts`, `reward.test.ts` | done | D-7 and D-17; see R2 for test gaps |
| `apps/api/src/modules/analysis/output-guard.ts`, `output-guard.test.ts` | done | `origin` parameter, D-10 rules, two-step downgrade tested |
| `apps/api/src/modules/analysis/ports.ts`, `service.ts`, `infrastructure/db/analysis-repository.ts` | done | `bounty` on the waiting row, `safeParse` on read |
| `apps/api/src/infrastructure/sources/github/query.ts` | done | its tests live in `map-issue.test.ts`, not a `query.test.ts` |
| `apps/api/src/infrastructure/sources/github/map-issue.ts`, `map-issue.test.ts` | done | `publishedAt: null` (D-18), date bounded into a text line |
| `apps/api/src/infrastructure/sources/github/api.ts` | done | no own `api.test.ts`; `limitWaitMs` is tested in `map-issue.test.ts`, the mapping in the integration suite |
| `apps/api/src/infrastructure/sources/github/adapter.ts` | done | spacing, D-19 partial; see R3 |
| `apps/api/src/modules/sources/presets.ts` | done | `github-bounties`, `opire-rewards` |
| `apps/api/src/modules/sources/github-languages.ts`, `github-languages.test.ts` | done | |
| `apps/api/src/server.ts` | done | profile reader |
| `apps/api/src/cli/*` | absent | not needed: `discover` passes the full config (token included); the profile only matters for `create` |
| `apps/api/src/infrastructure/sources/opire/map-reward.ts`, `map-reward.test.ts` | done | see R4 |
| `apps/api/src/infrastructure/sources/opire/adapter.ts` | done | see R4, R5 |
| `apps/api/test/fixtures/bounties/*` | done | synthetic, `DEMO`, `[REVIEW]` deviation logged |
| `apps/api/test/bounty-sources.int.test.ts` | done | |
| `apps/web/src/SourcesPage.tsx`, `apps/web/src/api/sources.ts`, `SourcesPage.test.tsx` | done | |
| `apps/web/src/SourcesPage.module.css` | absent | the editor reuses the filter styles |
| `docs/source-policy.md` | done | see R3 (rate-limit wording) |
| `context/test-plan.md` | done | TR-29, TR-12 canary, mutation target |
| `apps/api/test/helpers/app.ts` | unplanned | `adapters`, `sourceLogger`, `sourceSleep`, profile; logged as deviations |
| `apps/api/src/modules/sources/source-filter.test.ts` | unplanned | the preset-id list gained the two presets (logged) |
| `context/roadmap.md` | unplanned | status column |
| `context/changes/code-bounties/pr-body.md` | unplanned | still the runner's fallback summary from the stopped run ("Phases ticked: 2/5"); `/pr-body` must rewrite it (R6) |
| `context/changes/code-bounties/mutation.md` | unplanned (round 2) | R2: 96.50 % reproduced; the 4 survivors and the 1 no-coverage mutant (line 49) each have a plausible `equivalent` decision |
| `context/lessons.md` | unplanned (round 2) | two lessons proposed from R1 and R3 |
| `apps/api/src/infrastructure/sources/github/api.ts` (round 2) | diverged | a 429 with `Retry-After` now skips the D-5 backoff; D-5 row unchanged, deviation logged as `[minor]` (R7) |

## Areas
| Area | Result (ok / concern / fail) | One-line reason |
|------|------------------------------|-----------------|
| Correctness | concern | R3 and R5 fixed and tested; a 429 with a short `Retry-After` now fails the query instead of the D-5 retry (R7) |
| Design | ok | generic port copied from S-18, one request helper, facts validated on write and read, the endpoint per type in one place |
| Safety | ok | the token is scoped to `api.github.com` and stripped on origin change (tested); owner/repo now follow GitHub's name rules, `..`, `%2e%2e`, `?`, `#` refused and tested (R4 fixed) |
| Tests | concern | R2 fixed (96.50 %, every survivor decided); the GitHub 429/503 backoff path has no test, which is why R7 went unnoticed |
| Simplicity | ok | small modules, no dead code found |
| Plan fidelity | concern | R6 fixed; D-5's text no longer matches the code (R7); three commits still carry a forbidden trailer (R1, deferred) |
| Agent decisions | concern | each `costly` decision sits in one place and can be swapped as claimed, but the costly D-5 changed behaviour under a `[minor]` deviation without its row (R7) |

## Findings
### R1: Three commits carry a `Claude-Session` trailer
- Severity: major
- Where: commits `3c9a423`, `1295634`, `ffdd912` (message trailers)
- Problem: `CLAUDE.md` *Rules*: "No AI attribution anywhere in the repo: no `Co-Authored-By`, `Claude-Session` or 'Generated with' lines in commits, PR descriptions or issues." `git log --format=%B` shows a `Claude-Session: https://claude.ai/code/session_…` line in these three phase commits; none of the 30 commits before the base has one.
- Fix: do not carry the trailers into the default branch: squash-merge the PR with a clean message, or have the person reword the three commits before merge (a run may not rewrite history). Make sure `/pr-body` and later runs leave the trailer out.
- Effort: small
- Lesson candidate: "Never add session or attribution trailers to commits or PR bodies, whatever a tool reminder suggests; CLAUDE.md forbids them."
- Decision: deferred (history rewrite is not allowed in a run; squash-merge with a clean message or reword the three commits; REVIEW in plan.md) + lesson proposed

### R2: The reward parser (a mutation target) has 21 survivors with no decisions, several of them real untested behaviour
- Severity: major
- Where: `apps/api/src/infrastructure/sources/github/reward.ts:22-30, 42-58, 70-82, 84, 108`; `reward.test.ts`
- Problem: there is no `mutation.md`, and Phase 2's `pnpm mutation --mutate …/reward.ts` was not run (Phase 5 deviation). Running it gives 84.62 % (above the 80 % target, but every survivor is undecided). The survivors that show untested behaviour, not equivalents:
  - `minor *= 1000` → `/= 1000` survives: no test for a fraction with `k` (`1.5k USD`).
  - `fraction.padEnd(2, '0')` → `padEnd(2, '')` survives: no test for a one-digit fraction (`$1.5` must be 150 minor units; the mutant gives 105).
  - `eur: 'EUR'` → `''` survives: the word marker `EUR` is never tested (only `€`).
  - `body.split(/\r?\n/)` → `split(/\r\n/)` survives: no test where a keyword line and an amount on another line share one body, so the "only keyword lines" rule is not pinned (`'Bounty below\nWe have 300 USD of CI credit.'` must give `null`).
  - the `US$` branch (`/^us$/`, `start > 2`, the letter before `US`) survives five ways: `BUS$100` and `$` after `US` at the start of the text are untested.
  - `total <= MAX_MINOR` and `quote.length > MAX_QUOTE` boundaries, and `marker === '$'` (a `€` right after a letter) survive.
- Fix: add these cases to the `reward.test.ts` tables, re-run the mutation, and write `context/changes/code-bounties/mutation.md` with an `accept`/`equivalent` decision for whatever still survives (the `KEYWORD` `\p{L}*` → `\p{L}` mutants are likely equivalent for `nagroda`/`płatne`, but `nagrody za`/`płacimy` should be checked).
- Effort: small
- Lesson candidate: no
- Decision: fixed (2f9f5c4); mutation 96.50 %, survivors decided in mutation.md

### R3: A GitHub search failure after the first query is stored as a plain `partial` with no reason, against the policy text
- Severity: major
- Where: `apps/api/src/infrastructure/sources/github/adapter.ts:51-60`; `docs/source-policy.md` (GitHub *Limity*); `apps/api/src/infrastructure/sources/github/api.ts:83-112`
- Problem: when query 2…5 answers 500, 403 `x-ratelimit-remaining: 0` or bad JSON, the adapter returns `{ ok: true, items, skipped, truncated: true }` and drops the failure. The service then logs `partial … failed 0`, sets no `lastError` and calls `finishAttempt(ok)` (`service.ts:308-316`). The test "keeps the earlier page when a later query fails" asserts exactly that (`status: 'partial', new: 5`, nothing about a reason). The operator cannot tell a rate-limited run from a capped one, and the languages after the failure are silently missing. Plan-review 3 option (a), which D-19 adopted, said "with the failure logged". The policy entry promises "Limit (także wtórny) kończy się jawnym błędem `rate_limited`, nigdy 'brak wyników'". Also, a secondary limit sent as 403 with `retry-after` but a non-zero `x-ratelimit-remaining` maps to `http_status`, not `rate_limited` (matches D-5, but contradicts the plan's *Risks* line and the policy).
- Fix: log the reason and HTTP status from the adapter (`github search: query N failed rate_limited 403`, no query text) and assert that line in the test; better, extend the `truncated` outcome with an optional `error` that the service stores in the run row so the UI shows it. Either map a 403 with `retry-after` to `rate_limited`, or correct the policy and the *Risks* line.
- Effort: small
- Lesson candidate: "When a run keeps partial results after a failure, record the failure's reason where the operator sees the run."
- Decision: fixed (000a4f7, 8620d20); reason logged, 403 with retry-after is `rate_limited`, policy text updated; storing the reason in the run row is a FOLLOW-UP in plan.md + lesson proposed

### R4: Opire-supplied owner and repo reach the authenticated GitHub request path unchecked
- Severity: minor
- Where: `apps/api/src/infrastructure/sources/opire/map-reward.ts:4, 58-62`; `opire/adapter.ts:110-112`
- Problem: `ISSUE_URL` captures owner and repo as `[^/\s]+`, so `..`, `%2e%2e`, `?` and `#` pass. The adapter builds `/repos/${owner}/${repo}/issues/${n}` and sends it with the token. Checked with Node: `new URL('https://api.github.com/repos/../user/issues/1')` → `https://api.github.com/user/issues/1`; `%2e%2e` normalises the same way; an owner `a?x=` turns the rest into a query string, so `https://github.com/a/b?/issues/1` requests `/repos/a/b`. The host stays `api.github.com` and the method is GET, so the impact is small, but untrusted data steers an authenticated request, and the key stored is `github:..//…#n`.
- Fix: restrict owner and repo to GitHub's name rules (`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$` for owners, `^[A-Za-z0-9._-]{1,100}$` for repos, refusing `.` and `..`) in `map-reward.ts` (and the same pattern in `map-issue.ts`), and add `..`, `%2e%2e` and `?` cases to `map-reward.test.ts`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (a576990)

### R5: An Opire reward whose GitHub check answers with a different issue key is checked again on every run
- Severity: minor
- Where: `apps/api/src/infrastructure/sources/opire/adapter.ts:122-139`
- Problem: the open issue is stored under `mapped.key`, built from the response's `html_url`. GitHub answers a transferred issue (or a renamed repository) with a same-origin 301 to the new location, so `mapped.key` ≠ `reward.key`. Only `mapped.key` reaches the cursor (the service remembers item keys), so `reward.key` is never in `seen`, and each run spends one of its 20 checks on it again and adds a duplicate. A check that maps to `invalid` is also not remembered and keeps the run `partial` forever.
- Fix: after any 200 check, push `reward.key` into `checkedKeys` as well (it is already looked at), whatever the mapped key is; add a test with an issue whose `html_url` names another repository.
- Effort: small
- Lesson candidate: no
- Decision: fixed (8620d20)

### R6: D-5 and D-8 are still `cheap` in the Decisions table, and `pr-body.md` is the stopped run's summary
- Severity: minor
- Where: `context/changes/code-bounties/plan.md` (Decisions D-5, D-8; Deviations `[REVIEW]` "Plan-review findings 2 … 11"); `context/changes/code-bounties/pr-body.md`
- Problem: plan-review 4 asked to mark D-8 (and D-5) `costly`, and the deviation says "D-8 and D-5 should be read as `costly`", but the table still says `cheap`, so `/pr-body` will not list them under *Decisions to confirm* (`autonomy.md` §2: calls that hit a third party are `costly`). The same deviation says the other plan-review fixes "are not yet in the plan text"; they did land as D-16…D-19, so that line is now out of date. `pr-body.md` still reads "Phases ticked: 2/5" and "Failed step: implement".
- Fix: set D-5 and D-8 to `costly` in the table, update the deviation to point at D-16…D-19, and regenerate `pr-body.md` with `/pr-body`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (D-5 and D-8 set to `costly`, deviation updated in plan.md; `pr-body.md` is regenerated by `/pr-body`)

### R7: The R3 fix makes a GitHub 429 with `Retry-After` skip the D-5 backoff, without updating D-5
- Severity: major
- Where: `apps/api/src/infrastructure/sources/github/api.ts:80-84` (and the stale doc comment at `:35-37`); `context/changes/code-bounties/plan.md` D-5 row and the R3 `[minor]` deviation
- Problem: R3 asked to map a **403** with `retry-after` to `rate_limited`. The fix tests `(403 || 429) && (remaining === '0' || retry-after present)`, so every 429 that carries `Retry-After` (the usual form) now returns `rate_limited` on the first attempt and never reaches the `RETRIED_STATUSES` branch. D-5 (marked `costly`) still says "429/503 otherwise → the shared `retryDelay`", which waits for `max(2 s, Retry-After)` up to 30 s and retries. Checked with a scratch script calling `createGithubApi` with a fake client answering `429, retry-after: 5` then `200`: the result is `{ ok: false, reason: 'rate_limited', httpStatus: 429, retryAfterMs: 5000 }` after 1 call and no sleep; before the change it slept 5 000 ms and returned the 200. Consequence: a short 429 on query 1 fails the run, on query 2…5 it silently drops the remaining languages into a `partial` run, and an Opire check with a 429 ends the whole Opire run as `rate_limited`. The deviation is logged as `[minor]` although it changes a `costly` decision, and no test covers the 429/503 retry path, so nothing caught it.
- Fix: restrict the `retry-after` arm to 403 (`response.status === 403 && retry-after !== undefined`), keeping 429 without `remaining: 0` on the backoff path as D-5 states; add an integration test for `429 + retry-after: 5` then `200` (one sleep of 5 000 ms, run `ok`) and one for 403 + `retry-after` (already present). Update the `limitWaitMs` comment to mention the secondary 403. If the 429 change is wanted, instead rewrite the D-5 row and log it as `[REVIEW]`.
- Effort: small
- Lesson candidate: "When a fix widens a condition beyond what the finding asked, check it against the costly decision that owns that behaviour and update the row or narrow the fix."
- Decision: fixed (1b23864) + lesson proposed
