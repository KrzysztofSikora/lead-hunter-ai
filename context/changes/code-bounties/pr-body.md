# feat(code-bounties): paid GitHub issues and Opire rewards as signals

Roadmap S-19. Paid GitHub issues (official search API, by label and language) and Opire rewards (only those whose GitHub issue is still open) now arrive as signals through the existing source loop, with a bounty fact when the issue states a reward. The analysed `sourceBudget` comes from that fact only, and a bounty is `DIRECT_REQUEST` only with a stated reward or a hiring cue. Covers PRD FR-33 AC1–AC2 and FR-27 AC1 for the bounty case. Adds two Sources presets, a GitHub query editor, an optional `GITHUB_TOKEN` and source-policy entries.
Closes #33

> **Status:** Ready for review. Plan review: READY WITH NOTES. Code review: APPROVE WITH FOLLOW-UPS, 0 open findings after round 2. Both third-party APIs are `UNVERIFIED` (see the first decision below).

## ⚠ Needs your decision
- **[REVIEW] R1, commits carry a forbidden trailer:** `3c9a423`, `1295634` and `ffdd912` have a `Claude-Session` line, which `CLAUDE.md` forbids. A run may not rewrite history. → Squash-merge with a clean message, or reword those three commits before merging. Later commits have no trailer.
- **[REVIEW] Fixtures are synthetic, not recorded.** The roadmap asks for adapter tests on recorded responses. The sandbox proxy refused `api.github.com`, `api.opire.dev` and the docs pages, so D-14 uses `DEMO` fixtures in the documented (GitHub) and third-party-described (Opire) shapes. Recorded fixtures are owed through the Phase 3 and 4 human checks. The Opire response shape and terms are `UNVERIFIED` (`map-reward.ts` is the one file to adjust).
- **[REVIEW] Image gates not run:** `pnpm docker:build` and `pnpm docker:smoke` need Docker, which the sandbox lacks. This change touches no Dockerfile, compose file or route; CI's `image` job is the gate.
- **[REVIEW] Merge with S-18 (`public-tenders`) is certain.** Both branches edit `ports.ts`, `service.ts`, `compose.ts`, `sources.ts`, the `PATCH` refine and migration `0012` (this change: `0012_bounty_facts.sql`). D-1 copies S-18's generic port names, so the second merge should only unite enum lists and `DiscoverContext` fields, renumber the migration and merge the guard `origin` (`tender` + `bounty`). Consider folding `bounty_json` and `tender_json` into one column before either holds data (D-2).
- **D-1 (costly):** how the bounty APIs fit the source loop → chose **two source types `github` and `opire` behind a generic port that copies S-18's shapes**. Alternatives: B wait for S-18 to merge (no duplicated groundwork, blocks this run); C an own port design (the second merge reconciles two designs). Switching costs: `ports.ts`, `service.ts`, `compose.ts`, `sources.ts`, enum lists.
- **D-2 (costly):** where the facts live → chose **nullable `raw_signals.bounty_json` (migration `0012`), Zod-validated before insert, `safeParse` on read**. Alternatives: B generic `metadata_json` (one column for S-18/S-19, nothing validates it); C text only (the guard would re-parse untrusted text). Switching costs: migration, `ingest.ts`, repositories.
- **D-3 (costly):** GitHub config → chose **`{ labels, languages }`, strict, languages from a fixed allow-list, no free-text query, one GitHub source**. Alternatives: B free query strings per source; C several GitHub sources. Switching costs: PATCH body, config schema, editor.
- **D-5 (costly):** staying inside the search limit → chose **spacing of 6 100 ms (no token) / 2 100 ms (token); 403/429 with `x-ratelimit-remaining: 0` → `rate_limited`; 429/503 otherwise → shared backoff**. Alternatives: B adaptive pacing from `x-ratelimit-remaining`; C no spacing, backoff only. Switching costs: `github/api.ts`, `adapter.ts`. Note: after review, a 403 with `Retry-After` also maps to `rate_limited` (R3, R7); a 429 keeps the backoff.
- **D-8 (costly):** closed Opire issues (AC2) → chose **one GitHub issue check per unseen reward (token if set, 1 000 ms apart, max 20 per run, rest next run as `partial`)**. Alternatives: B trust an Opire status field (none confirmed); C GitHub search `is:open` per repository. Switching costs: `opire/adapter.ts`. These are third-party calls with the operator's token.
- **D-9 (costly, security):** token handling → chose **`GITHUB_TOKEN` as `config.github.token` (redacted by key), `headers` on the guarded client, sent on the first hop and same-origin redirects only, dropped on an origin change, never sent to Opire**. Alternatives: B a GitHub-only client (bypasses the SSRF guard); C no headers on redirects. Switching costs: `http/client.ts`, adapters.
- **D-11 (costly):** config editing → chose **`PATCH /api/sources/:id` gains `github` (400 `not_github_source` for other types)**. Alternatives: B generic `config` key (S-18 already ships `tender`); C no editor, presets only. Switching costs: route, contracts, Sources view.
- **Plan review leftover (accepted risk):** the pre-filter rejects a text with more than 10 links as `spam`; long issue bodies with link lists are stored but rejected. Not mitigated (plan-review 7).

Reply in a review comment, e.g. `D-3: take B`, `R1: reword`, `drop the lessons commits`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 3) One real run of the GitHub preset without a token: record the run result and the request count, and compare one signal with its issue page. Run: add the preset in the Sources view, enable only it, `pnpm discover`. Evidence: none yet (the sandbox proxy refuses `api.github.com`); save to `context/changes/code-bounties/evidence/github-run.txt` without token or personal data.
- [ ] (Phase 3) Then one run with a read-only, public-data `GITHUB_TOKEN` in `.env`: check that no 403 occurs and that the response fits the size limit. Run: `pnpm discover`. Evidence: none yet (same file).
- [ ] (Phase 4) One real run of the Opire preset: record the real response shape against `map-reward.ts` (field names, envelope, unit), the counts of open, closed and skipped rewards, and one signal compared with its issue; replace the synthetic fixture with a trimmed real one if the shape differs. Run: add the preset, enable only it, `pnpm discover`. Evidence: none yet (the sandbox proxy refuses `api.opire.dev`); save to `context/changes/code-bounties/evidence/opire-run.txt`.
- [ ] (Phase 5) Sources view at phone width: add both presets, change the GitHub languages to `TypeScript` only and save; judge the wording of the editor and the access notes. Run: `docker compose up --build`, Sources view at 360 px. Evidence: none yet (no browser session in this run); save screenshot to `context/changes/code-bounties/evidence/sources-editor.png`.
- [ ] (Phase 5) Read the GitHub and Opire entries in `docs/source-policy.md` against their current terms, then tick or correct each `DO WERYFIKACJI` item (Opire response shape, unit and terms; GitHub terms). Run: open the two terms pages. Evidence: none.

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-4 | Languages and defaults | One search per language; defaults from profile `skills ∪ preferredTechnologies` mapped onto the allow-list, first 5 | One query with all languages; read the profile at every run |
| D-6 | Signal text | Labelled lines (title, repository, labels, language, Opire reward) then the cut body | Body only; JSON of fields |
| D-7 | Finding the stated reward | Pure `parseReward`: labels, title, keyword body lines; exactly one distinct amount, else `null` | Let the model find it; labels only |
| D-10 | Classifying bounties | Guard takes `origin`; `sourceBudget` = parsed reward or `null`; a stated reward counts as a hiring cue | Every bounty label counts as paid; never `DIRECT_REQUEST` for GitHub |
| D-12 | Same issue from GitHub and Opire | Same canonical URL, first source wins (`REPEAT_IMPORT` evidence) | Write the newer reward and requeue analysis |
| D-13 | robots.txt for the APIs | Not consulted; access is through the documented API | Check robots.txt like feeds |
| D-14 | Fixtures | Synthetic `DEMO` files in `apps/api/test/fixtures/bounties/` | Wait for recordings |
| D-15 | Opire envelope | Array, or object with `rewards`/`data` array; else `invalid_feed` | Array only |
| D-16 | Registry shape | `Partial<Record<SourceKind, SourceAdapter>>`, missing adapter → `internal`; `checkedKeys` merged into the cursor | `Record` with stub adapters |
| D-17 | Parser refinements | `CA$`/`AU$` → whole parse `null`; `pay|paid|budget|płac…` lines are candidates; zero, > 10⁹ units, quotes > 60 chars refused | Skip the refused amount, keep the others |
| D-18 | `publishedAt` | `null`; creation date as text line `Utworzono:` | `created_at`; fetch time |
| D-19 | Failure after a successful query | Return items found so far as `ok` + `truncated` (run `partial`) | Fail the whole run |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (71 files, 1048 tests), e2e ok (5/5). Image and image smoke not run (no Docker daemon in the sandbox).
- Review: APPROVE WITH FOLLOW-UPS, round 2. Round 1 had R1–R6, round 2 R7. Fixed: R2 (parser tests), R3 (failure reason logged, 403 with `Retry-After` is `rate_limited`), R4 (Opire owner/repo restricted to GitHub name rules), R5 (checked Opire reward remembered under its own key), R6 (D-5/D-8 marked `costly`), R7 (429 keeps the D-5 backoff). Deferred: R1 (history rewrite not allowed in a run). Rejected: none.
- Mutation: `github/reward.ts` 84.62 % → 96.50 % (target 80 %). Four survivors and one no-coverage mutant, all decided `equivalent` in [mutation.md](mutation.md). `bug` mutants: none.
- Proposed lessons (in [context/lessons.md](../../lessons.md)): "Never add session or attribution trailers…" (R1), "When a run keeps partial results after a failure, record the failure's reason…" (R3), "When a fix widens a condition beyond what the finding asked…" (R7). To reject them, drop the two `docs(code-bounties): propose lessons` commits (`a07f0be`, `781f7cd`).

## Follow-ups
- [FOLLOW-UP] Re-check stored bounty signals when their issue closes, and enrich a stored duplicate with a reward that a later source states (D-12 B).
- [FOLLOW-UP] Show the reason of a `partial` run's failed later query in the run row (extend `truncated` with an optional `error`); today it is only in the log.
- [FOLLOW-UP] Read issue comments for bot-stated amounts (Algora), within the core rate limit.
- Not covered: many real bounties state the amount only in a bot comment; those get `reward: null` and are not `DIRECT_REQUEST`.

See [plan.md](plan.md#decisions), [plan-review.md](plan-review.md) and [review.md](review.md) for detail.

## Commits
```
ae121ea docs(code-bounties): triage review round 2
781f7cd docs(code-bounties): propose lessons
1b23864 fix(code-bounties): keep the 429 backoff for a plain retry-after (R7)
ca80663 docs(code-bounties): review
3e40b96 docs(code-bounties): triage review round 1
a07f0be docs(code-bounties): propose lessons
8620d20 fix(code-bounties): remember a checked Opire reward under its own key and log secondary-limit tests (R3, R5)
a576990 fix(code-bounties): restrict GitHub owner and repo names from Opire (R4)
000a4f7 fix(code-bounties): log why a later GitHub query failed, map secondary limits to rate_limited (R3)
2f9f5c4 test(code-bounties): pin reward parser cases and record mutation decisions (R2)
98dd2da docs(code-bounties): review
ffdd912 feat(code-bounties): GitHub query editor, source policy and test plan
1295634 feat(code-bounties): Opire adapter and preset
a704df3 feat(code-bounties): GitHub search adapter and preset
4cea07a docs(code-bounties): pr-body
3c9a423 feat(code-bounties): reward parsing and the bounty guard rules
495b9ee feat(code-bounties): generic source types, bounty facts storage and the token header
92121d3 docs(code-bounties): plan-review
ff33617 docs(code-bounties): plan
```

<details><summary>Run</summary>

Ship code-bounties (S-19), base main, no stop requested. Failed step: none. Draft reason: none.

| Step | Attempts | Cost |
|------|----------|------|
| implement (3 phase sessions, sonnet) | 1 each | $1.02, $0.60, $0.44 |
| review round 1 (opus) | 1 | $1.99 |
| fix-review (sonnet) | 1 | $0.60 |
| review round 2 (opus) | 1 | $0.94 |
| fix-review (sonnet) | 1 | $0.17 |
| pr-body (sonnet) | 1 | not yet recorded |

Phases ticked: 5/5. Recorded costs total $5.76 before pr-body.
</details>
