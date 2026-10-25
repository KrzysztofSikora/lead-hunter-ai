# feat(rss-sources): RSS/Atom sources with presets, Sources view and guarded runs

Roadmap S-10: configured feeds (HN freelance and We Work Remotely presets, or any RSS/Atom URL) become signals through the S-09 guarded client, without duplicates and with visible errors. The operator gets a new **Źródła** view (`/zrodla`) with enable/disable, presets, **Uruchom teraz** and **Sprawdź**; `pnpm discover` runs every enabled source once; `docs/source-policy.md` has its first entries. Covers PRD FR-04 AC1–AC7, FR-18 AC3 and FR-26 AC2 (first entries). Real feeds were not reachable from the agent sandbox, so the item formats and preset URLs are unverified until the human checks below.
Closes #11

> **Status:** Ready for review (all five phases done, review APPROVE WITH FOLLOW-UPS, 0 open findings). The real-feed human checks are still open.

## ⚠ Needs your decision
- **Real feeds are unverified.** `hnrss.org` and `weworkremotely.com` were refused by the sandbox proxy (CONNECT 403). Item formats, the hnrss title pattern (D-12) and all preset URLs are assumptions; fixtures are `synthetic-*` files only. See the first two human checks.
- **Preset URL differs from the roadmap.** Roadmap S-10 says `https://hnrss.org/whoishiring/freelance`; the preset uses `whoishiring/freelancer` (and WWR slugs `remote-full-stack-programming-jobs`, `remote-back-end-programming-jobs`, `remote-devops-sysadmin-jobs`). All `UNVERIFIED`; they live in one file, `apps/api/src/modules/sources/presets.ts`.
- **D-1 (costly):** shape of `sources` → chose **one row per feed, adapter-owned `config_json`, `config_key UNIQUE`** (migration 0007). Alternatives: B typed columns per adapter; C one row per type with feeds in JSON. Switching costs: migration and repository rewrite.
- **D-2 (costly):** run record → chose **`job_runs` written by every run, no list route**. Alternatives: B only `sources.last_*`; C full FR-18 AC1 columns now. Switching costs: additive columns for S-12.
- **D-4 (costly):** feed identity → chose **new `external_id` kind in `signal_identities`** (`<sourceId>:<item key>`), shared `ingest` for manual and feed paths. Alternative: unique index on `raw_signals`. Switching costs: ingest and migration.
- **D-10 (costly):** HTTP contract → `GET/POST /api/sources`, `PATCH /:id`, `POST /:id/run`, `POST /:id/check`; `SourceError` changed to `{ sourceId, source, reason, httpStatus?, at }` (replaces never-filled `message`). Alternatives: keep `message` with Polish text from the API; one `PUT`. Switching costs: contracts, web, tests.
- **D-19 (costly):** `SourceFacts.name` (nullable) and `SourceType` gains `rss`. Alternative: derive the name from the URL host in the web. Switching costs: contract and list/card code.
- **[REVIEW] D-21:** D-9 as written made **Sprawdź** block **Uruchom teraz** for an hour (plan-review #1). Chose: a check never sets `next_allowed_at` unless the source asked for a wait; 60 s cooldown; no `job_runs` row. Alternative: check = run.
- **Plan review #2 not applied.** Plan-review asked to mark D-5, D-6, D-7, D-8, D-9, D-13, D-16, D-20 as `costly` (third-party calls, new env variables, `200` vs `202` public shape, untrusted-XML handling). The Decisions table still says `cheap`. Please confirm these: D-5 manual runs also respect the 1 h interval; D-6 in-run backoff on 429/503; D-7 synchronous run (`200`); D-8 robots.txt applies to feeds; D-13 own entity/tag decoding; D-16 CLI semantics; D-20 anonymising recorder.
- **Review leftovers:** none open. R1–R7 were all fixed (see Quality).

Reply in a review comment, e.g. `D-3: take B`, `R4: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 3) Real feeds answer and map as assumed. Run on a machine with internet: `pnpm dev`, log in, `curl -b <cookie> -X POST localhost:8080/api/sources -H 'content-type: application/json' -d '{"preset":"hn-freelance"}'`, the same for `wwr-programming`, then `POST /api/sources/<id>/run` for both (or `pnpm discover`); record counts and one sample signal (title, URL, date) in `context/changes/rss-sources/evidence/real-run.md`. Evidence: none yet.
- [ ] (Phase 3) Preset URLs and terms links in `apps/api/src/modules/sources/presets.ts` are right (hnrss `whoishiring/freelancer` and `jobs?q=contract`; the four WWR slugs; terms pages) and the hnrss title pattern `New comment by …` of D-12 holds. Run: open each URL, `curl -sI <url>` expects 200. Evidence: none.
- [ ] (Phase 4) Sources view at 360 px and on a laptop: add a preset, toggle off/on, press **Uruchom teraz** and **Sprawdź** (with network, or against an unreachable URL added by hand), read result and error texts; health (OK / błąd) readable without colour. Run: `pnpm dev`, open `/zrodla`. Evidence: none (no Playwright Chromium in the sandbox; add a screenshot with one OK and one failing source).
- [ ] (Phase 5) Record fixtures and review them. Run (internet, sources added): `pnpm fixtures:record <id of hn-freelance>` and `pnpm fixtures:record <id of a WWR source>`; confirm each file in `apps/api/test/fixtures/feeds/` holds no real e-mail, handle, phone number, company link or client name (the anonymiser is best-effort), commit, run `pnpm test`. Evidence: [`evidence/anonymise-sample.txt`](context/changes/rss-sources/evidence/anonymise-sample.txt) shows the anonymiser on synthetic input.
- [ ] (Phase 5) [`docs/source-policy.md`](docs/source-policy.md) matches the hnrss and WWR terms pages (entries marked `DO WERYFIKACJI`). Run: open the two terms links in the document. Evidence: none.

## Other decisions made by the agent (cheap to change)
Full table: [`plan.md#decisions`](context/changes/rss-sources/plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-3 | Cursor for AC5 | `cursor_json = { seen: string[] }`, 500 item keys; identity table as backstop | newest `publishedAt`; identity table only |
| D-5 | Per-source minimum interval | atomic claim of `next_allowed_at`, `SOURCE_MIN_INTERVAL_MINUTES` default 60 (60–1440), also for manual runs | manual runs bypass; interval only for scheduled runs |
| D-6 | Backoff on 429/503 | up to `SOURCE_MAX_ATTEMPTS` (3), delay `max(2 s·2^(n-1), Retry-After)`, `Retry-After` > 30 s stops; next attempt after `max(Retry-After, 1 h)` | retry network errors too; no in-run retry |
| D-7 | Manual run sync? | synchronous `200 SourceRunResult` | `202` + polling |
| D-8 | robots.txt for feeds | reuse the S-09 check as `beforeHop` | skip robots for feeds |
| D-11 | Presets | one file `presets.ts`, served in `GET /api/sources` | in contracts; in `.env` |
| D-12 | hnrss item title | first line of the comment when title starts `New comment by ` | keep feed title; `<user>: <line>` |
| D-13 | XML/HTML to snippet | fast-xml-parser with entity processing off, own linear decoder/stripper, max 200 entries | linkedom/Readability; library entities on |
| D-14 | Fixtures without real feeds | `synthetic-*` files plus an `it.each` over any recorded file | wait for real ones; unlabeled fake "real" files |
| D-15 | Enable/disable | new source enabled; disabled → `409 disabled`; same feed twice → `409 exists` | allow manual runs of disabled |
| D-16 | `pnpm discover` | runs enabled sources once, one line each, exit 1 on failure | leave as is until S-12 |
| D-17 | Tests | `sources.int.test.ts`, `parse-feed.test.ts` (`retry.test.ts` dropped by plan-review #5) | one integration test only |
| D-18 | Author/organisation | not stored | `raw_signals.author` |
| D-20 | Recording fixtures | `pnpm fixtures:record <source-id>` anonymises first 5 entries | raw copy |

## Quality
- Gates ([`review.md`](context/changes/rss-sources/review.md)): typecheck ok, lint ok, unit tests ok (629), e2e ok (5). **image: not run** (no Docker daemon in the sandbox).
- Review: APPROVE WITH FOLLOW-UPS, round 2: 7 findings, 7 fixed, 0 deferred, 0 rejected. R1 (blocker) a far-future `pubDate` broke the opportunity list (500); R2 (blocker) a far-future `Retry-After` broke `GET /api/sources` (500), now capped at 7 days; R3/R6 (major) quadratic regexes in the anonymiser; R4, R5, R7 (minor) recorder ignoring a pending wait, a wrong `.env.example` comment, the cap missing in the policy.
- Plan review: READY WITH NOTES; #1 (check blocking runs) became D-21; #3–#6, #8–#12, #14 applied (see Deviations in the plan); #2 not applied (see above).
- Mutation: skipped, S-10 is not a mutation target (`review.md`); no `mutation.md`. `bug` mutants: none.
- Proposed lessons: "Bound every date or time that comes from a source to the range the contract can serialise before storing it" (commit `a2eeb45`, drop it to reject).

## Follow-ups
- A process crash mid-run leaves a `running` `job_runs` row; S-12 (FR-17 AC3) owns the cleanup.
- Out of scope here, for S-12: scheduler, job lock, `POST /api/jobs/discover`, `GET /api/jobs`, `rejected`/`analysed`/`cost` counters; also daily raw-signal limit (FR-09 AC3, S-05) and deleting/editing a source URL.
- A WWR category feed may exceed `FETCH_MAX_BYTES` (1 MiB) and show `too_large`; raising it is a `.env` change.
- If hnrss or WWR `robots.txt` disallows the feed, the source shows `robots_disallowed` and the preset is wrong.
- No automated test for the anonymiser's full output or for the Sources view (test budget); the fixture parser also reads UTF-8 whatever the XML declaration says (noted in `docs/source-policy.md`).
- Worst case of a synchronous run is about 2 minutes (3 × 20 s plus two 30 s waits), not 70 s as the plan first said.

## Commits
```
8fb55a8 docs(rss-sources): triage review round 2
784889b docs(rss-sources): mention the 7-day backoff cap in the source policy (R7)
8d43716 fix(rss-sources): bound phone and author patterns in the anonymiser (R6)
83277aa docs(rss-sources): review
2ee42fe docs(rss-sources): triage review round 1
a2eeb45 docs(rss-sources): propose lessons
7db1bfc fix(rss-sources): recorder honours a pending wait; env comment (R4, R5)
5dea73e fix(rss-sources): bound the e-mail pattern in the anonymiser (R3)
5170138 fix(rss-sources): cap a source's own backoff at 7 days (R2)
026e922 fix(rss-sources): unknown date outside the serialisable range (R1)
66f5841 docs(rss-sources): review
c279d46 feat(rss-sources): fixture recorder and source policy
411856f feat(rss-sources): sources view
5ee5851 feat(rss-sources): sources service, RSS adapter, routes and discover CLI
338c436 feat(rss-sources): source contracts, sources and job_runs schema, shared ingest
19dfad4 feat(rss-sources): RSS/Atom feed parser and retry rules
9759f35 docs(rss-sources): plan-review
3d258f0 docs(rss-sources): plan
```

<details><summary>Run</summary>

Base main, branch `change/rss-sources`, started 2026-10-25 15:32 UTC.

| Step | Attempts | Model | Cost |
|------|----------|-------|------|
| plan | 1 | opus | $2.40 |
| plan-review (READY WITH NOTES) | 1 | opus | $1.17 |
| implement, phases 1–5 | 1 each | sonnet | $0.52, $0.52, $1.09, $0.36, $0.47 |
| review round 1 (CHANGES REQUESTED, 5 open) | 1 | opus | $1.85 |
| fix-review | 1 | sonnet | $0.28 |
| review round 2 (APPROVE WITH FOLLOW-UPS, 2 open) | 1 | opus | $0.51 |
| fix-review | 1 | sonnet | $0.14 |

Failed step: none. Draft reason: none. Phases ticked: 5/5. Total about $9.31 (excluding this pr-body step).
</details>

