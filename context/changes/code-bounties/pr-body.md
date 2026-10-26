# feat(code-bounties): paid GitHub issues and Opire rewards as signals

Roadmap S-19 (`code-bounties`): the operator can add a GitHub search source (labels × languages) and an Opire source. Open issues with a stated reward arrive as signals, a closed Opire reward is skipped, and the reward amount is parsed deterministically and feeds the guard (FR-33 AC1–AC2; FR-27 AC1 for the bounty case). Optional read-only `GITHUB_TOKEN` in `.env`. Nothing here has run against the real APIs yet: both are unreachable from the session, so the adapters are tested on synthetic `DEMO`/`UNVERIFIED` fixtures (see the human checks).
Closes #33

> **Status:** Ready for review. Gates were green except the two Docker gates, which could not run (no Docker daemon in the session). Every human check is open.

## ⚠ Needs your decision
- **[FOLLOW-UP / history] Two commits carry a `Claude-Session` trailer** (`5982ab1`, `bfbd685`), against `CLAUDE.md` (review R3, deferred: rewriting history is outside the autonomous loop). Squash-merge with a clean message, or reword the two commits.
- **D-8 (costly):** one GitHub issue check per new Opire reward, at most 20 per run, closed rewards remembered in the cursor. → chose **per-reward checks through the GitHub API**. Alternatives: B trust an Opire status field (no extra calls, but no such field is confirmed); C one `repo:` search per repository. Switching costs: `opire/adapter.ts`, `service.ts` cursor merge, tests. **[REVIEW]** changed after review R2/R10: any failed check other than 404/410 now ends the loop (run `partial`, answered keys kept) instead of counting as `skipped` and going on, so a header-less secondary-limit 403 cannot trigger 19 more calls.
- **D-4 (costly):** one search per language, `per_page=30`, `sort=updated&order=desc`, at most 5 requests per run; defaults from the profile. Alternatives: `sort=created` (stable, misses an old issue that later gets a label), all languages in one query (semantics `UNVERIFIED`), read the profile on every run. Switching costs: `query.ts`/`adapter.ts` constants. Whether a new label bumps `updated_at` is `UNVERIFIED` until the Phase 3 human check.
- **D-5 (costly, rests on unverified research):** request spacing of 6 100 ms without a token, 2 100 ms with one; primary and secondary limits read from `x-ratelimit-*`/`retry-after`. A header-less 403 stays `http_status` (the loop stop prevents the extra requests). Alternative: pace by `x-ratelimit-remaining`.
- **D-2 (costly):** new nullable `raw_signals.bounty_json` column (migration `0013`). Alternatives: one shared `metadata_json` with `tender_json`; text only. Reversible by renaming before it holds data.
- **D-1 (costly):** two new source types `github` and `opire` (additive change to `SourceType`/`SourceKind`, which the web app switches on). Alternatives: a separate bounty job; one generic GitHub type with Opire as a mode.
- **D-3, D-11 (costly):** GitHub config is labels (1–10) and languages (0–5 from a fixed Linguist list), no free-text query; `PATCH /api/sources/:id` gains `github`. Alternative: free query strings.
- **D-9 (costly):** custom request headers on the shared guarded client, sent on the first and same-origin hops and dropped for good after a cross-origin redirect; `Authorization` added only for `https://api.github.com`, never for Opire. Alternatives: a GitHub-only client (bypasses the SSRF guard); never follow redirects when headers are set.
- **D-10 (cheap, but worth a look):** a stated reward counts as an explicit offer to pay; a bare `bounty` label does not. D-23 (plan-review 1): the adapter's own lines (`Etykiety`, `Repozytorium`, …) are stripped before the cue check, so a `paid` label alone no longer keeps `DIRECT_REQUEST`. Widening to "every bounty label is paid" is one boolean.
- **D-13 (cheap):** robots.txt is not consulted for the two APIs (`api.github.com/robots.txt` would block the official API). This is a permitted-access call (PRD §5); the policy says so.
- **[REVIEW] Synthetic fixtures instead of recorded responses.** The roadmap asks for adapter tests on recorded responses; the egress proxy refuses `api.github.com` and `api.opire.dev`, so the fixtures in `apps/api/test/fixtures/bounties/` are synthetic and labelled. The recordings are owed through the human checks below.
- **[REVIEW] `reward.ts` is a third mutation target**, against the test plan's "only two modules" user decision (plan-review 8). It parses untrusted text into the amount that decides the level and budget. Drop the row in `context/test-plan.md` to undo.
- **Review leftovers:** none open. Of 10 findings, 9 fixed and R3 deferred (above).

Reply in a review comment, e.g. `D-8: take B`, `R3: reword the commits`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 3) One real run of the GitHub preset without a token: record the run result, request count, response size and one signal compared with its issue page; confirm a newly labelled old issue appears (D-4 `sort=updated`). Run: add the preset in the Sources view, then `pnpm discover` with only it enabled (no `GITHUB_TOKEN`). Evidence: `context/changes/code-bounties/evidence/github-run.txt` (not produced: `api.github.com` unreachable from the session).
- [ ] (Phase 3) One run with a read-only, public-data `GITHUB_TOKEN`: no 403 occurs. Run: set `GITHUB_TOKEN` in `.env`, `pnpm discover`. Evidence: `context/changes/code-bounties/evidence/github-run.txt` (no token or personal data in it).
- [ ] (Phase 3) If the real response differs from the synthetic fixtures, replace `apps/api/test/fixtures/bounties/github-search-*.json` with trimmed anonymised recordings. Run: compare `/search/issues` output with the fixtures. Evidence: the replaced fixtures.
- [ ] (Phase 4) One real run of the Opire preset: record the real response shape against `map-reward.ts` (field names, envelope, unit), the counts of open, closed and skipped rewards, and one signal compared with its issue; replace `opire-rewards.json` with a trimmed real one if the shape differs. Run: add the preset, then `pnpm discover` with only it enabled. Evidence: `context/changes/code-bounties/evidence/opire-run.txt` (not produced: `api.opire.dev` unreachable).
- [ ] (Phase 5) In the Sources view at phone width, add both presets, change the GitHub languages to `TypeScript` only and save; judge the editor and access-note wording. Run: `pnpm dev`, open the Sources view. Evidence: none.
- [ ] (Phase 5) Read the GitHub and Opire entries in `docs/source-policy.md` against the current terms of both services and tick or correct each `DO WERYFIKACJI` item. Run: read `docs/source-policy.md`. Evidence: none.
- [ ] (gates) `pnpm docker:build` and `pnpm docker:smoke`: not run, the session has no Docker daemon. The change touches web code, docs, strings and API code, not the image, but the gate is unproven.

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-6 | Text a bounty signal carries | Labelled lines (title, repository, labels, search language, created date, Opire reward), then the body | Body only; JSON of the fields |
| D-7 | How the stated reward is found | Pure `parseReward` over labels, title, reward-word body lines; one distinct amount or `null`; rates, ranges, sponsor/credit lines and foreign dollars refused | Let the model find it; labels only |
| D-12 | Same issue from GitHub and Opire | Same `html_url`; first source to store it wins, incl. `bounty_json`; tested in both orders | Write the newer reward and requeue (`[FOLLOW-UP]`) |
| D-14 | Fixtures | Synthetic, `DEMO`/`UNVERIFIED` | Wait for recordings |
| D-15 | Opire response shape | Array, or object with array under `rewards`/`data`; anything else `invalid_feed` | Array only |
| D-16 | `publishedAt` | `null`; created date only as a text line | `created_at`; fetch time |
| D-17 | Failure after partial success | Items so far kept as `ok` + `truncated` (run `partial`) | Fail the whole run; carry the error in the run row |
| D-18 | Pre-filter `no_profile_match` | Applies unchanged | Exempt both sources |
| D-19 | Response size cap | 5 MiB per request | 1 MiB client default |
| D-20 | Profile for default languages | Optional profile reader in `SourceDeps` | Languages sent from the web view |
| D-21 | Card shows bounty facts | No new block; budget line already shows the quote | A "Nagroda" block |
| D-22 | Analysis prompt | Unchanged, `analysis-2` | A bounty rule in the prompt |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (82 files, 1306 tests), e2e ok (5), mutation `reward.ts` ok; image and image smoke not run (no Docker daemon).
- Review: APPROVE WITH FOLLOW-UPS, 3 rounds: R1, R2, R4, R5, R6, R7, R8, R9, R10 fixed, R3 deferred (history rewrite), none rejected, 0 open.
- Mutation: `reward.ts` 88.95 % → 93.93 % (target 80 %, 15 survivors, all decided as equivalent or safe-direction in [mutation.md](mutation.md)); `bug` mutants: none.
- Proposed lessons: "Keep commit messages free of attribution trailers even when a tool reminder supplies one; check `git log --format=%B` before each phase commit" (commit `01a7347` `docs(code-bounties): propose lessons`; drop it to reject).

## Follow-ups
- [FOLLOW-UP] Remove the `Claude-Session` trailer from `5982ab1` and `bfbd685` (squash-merge or reword).
- [FOLLOW-UP] D-12 option B: when a duplicate's stored reward is null, take the newer reward and requeue analysis.
- [FOLLOW-UP] D-17 option C: carry the partial-failure error in the run row.
- [FOLLOW-UP] Optional: map a header-less 403 from `api.github.com` to `rate_limited` with a ≥ 60 s wait (review R2; the loop stop already prevents the extra requests).
- [FOLLOW-UP] Replace the synthetic fixtures with recorded responses after the human checks.

Plan: [plan.md](plan.md#decisions) · [plan-review.md](plan-review.md) · [review.md](review.md) · [mutation.md](mutation.md)

## Commits
```
6db281d docs(code-bounties): triage review round 3
1a88b29 fix(code-bounties): reward only beside a reward noun, refuse more currency codes, kill R1 survivors (R7, R8, R9)
3be3b8d docs(code-bounties): review
dfb948c docs(code-bounties): triage review round 2
01a7347 docs(code-bounties): propose lessons
19395f5 fix(code-bounties): serialise GitHub request spacing, one endpoint table (R4, R6)
93f6220 fix(code-bounties): stop the Opire check loop at the first non-missing failure (R2)
4ee6f1a fix(code-bounties): read a reward only next to a reward word, refuse other currency codes and per-item rates (R1, R5)
29d8243 docs(code-bounties): review
e3c220c docs(code-bounties): pr-body
f097396 docs(code-bounties): review
bfaf8ae feat(code-bounties): sources view editor, source policy and test plan
bfbd685 feat(code-bounties): opire adapter and preset
07fa5d5 feat(code-bounties): github search adapter and preset
5982ab1 feat(code-bounties): reward parsing and the bounty guard rules
a7f1c59 feat(code-bounties): github and opire source types, bounty facts storage and token header
8b16202 docs(code-bounties): plan-review
7ab3222 docs(code-bounties): plan
```

<details><summary>Run</summary>

ship code-bounties (S-19), base main, no stops. Plan review: READY WITH NOTES. Phases ticked 5/5. Review: APPROVE WITH FOLLOW-UPS (0 open findings), 3 rounds.
Final run segment (19:31–20:13): review $1.93, fix-review $0.77, review $1.11, fix-review $0.26; each succeeded on attempt 1. An earlier segment of the same change (13:10–14:04) did the plan ($2.43), plan-review ($0.89), five implement sessions and review round 1; its fix-review and pr-body steps did not complete and were redone in this segment.
Failed step: none. Draft reason: none.
</details>
