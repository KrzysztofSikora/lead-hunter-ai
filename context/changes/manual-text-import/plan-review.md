# Plan review: manual-text-import

Verdict: NEEDS CHANGES

This is round R3. `plan.md` has not changed since R2: `git diff 5e39139 HEAD` touches only
`plan-review.md` and `pr-body.md`. Its *Review response* still lists only the R1 findings. None of
the R2 findings were answered, including the R2 blocker. I re-checked the two R2 findings that
can be tested against the code (Node 24, Zod 4.6.7 in `apps/api`), and both still reproduce.

| # | Severity | Check | Finding | Suggested change |
|---|----------|-------|---------|------------------|
| 1 | blocker | 8 Decisions (D-2, D-8 vs FR-06 AC3); open since R2 | The plan stores only the canonical URL. *Data* has `raw_signals(... canonical_url TEXT NULL ...)` and no other URL column, and Phase 2 says "`source.url` = canonical URL". FR-06 AC3 (`context/prd.md:104`) requires keeping the "exact source URL". The canonical form is not that URL. It drops the fragment (hash-routed boards like `https://site/#/job/123` turn into `https://site/`) and `ref`. Rebuilding the URL through `URLSearchParams` also re-encodes values. Probe: `new URL('https://ex.com/s?q=a%20b&redirect=/a/b&utm_source=x')`, then `searchParams.delete('utm_source')`, gives `https://ex.com/s?q=a+b&redirect=%2Fa%2Fb`. The data shape is costly to change, because rows stored before a fix cannot recover the pasted URL. | Add `raw_signals.source_url` and fill it with the URL as the contract parsed it (trimmed). Store the same value in `opportunity_evidence.url` for repeat imports. Use `canonical_url` only for identity (`signal_identities`). Make DTO `source.url` the source URL, and expose `canonicalUrl` next to it if that is useful. In D-2, filter the tracking parameters on the raw `&`-split query string so the kept parameters stay byte-identical. Add a unit case `?q=a%20b&x=1,2&utm_source=z` → `?q=a%20b&x=1,2`. Add a Phase 2 assertion that `source.url` equals the pasted `?utm_source=x#top` URL. Under *Risks*, note that fragment-routed URLs merge into one identity under the roadmap's rules. |
| 2 | major | 7 Failure paths (D-5); open since R2 | The user-info `.refine` (D-5: "`username`/`password` of `new URL(value)` non-empty") runs even after `z.httpUrl()` has already failed. Probe of `z.object({url: z.httpUrl().max(2048).refine(v => { const u = new URL(v); ... })})`: `'not a url'` **throws `TypeError: Invalid URL`**, while `'ftp://a.b/'` gives `invalid_format` and `'https://u:p@a.pl/'` gives `custom`. A thrown error is not a Zod validation error, so `http-errors.ts:16` rethrows it and the client gets a 500. The Phase 1 AC4 table (`ftp://`, user info) misses this case. | Make the refine total, e.g. `URL.canParse(v) ? check : true`, or use `z.httpUrl({ abort: true })`. Add `url: "nie-adres"` → 400 `path: "url"` to the AC4 table. |
| 3 | minor | 7 Data (D-1); open since R2 | The content of a `REPEAT_IMPORT` row is undefined. The plan does not say whether `source_fact` holds the full second text, an excerpt or the URL. It also does not say which signal `raw_signal_id` points to for a repeat, or whether the column is nullable. A duplicate creates no signal, so this row is the only copy of the second pasted text. | In D-1 and *Data*, define `source_fact` as the full normalised snippet, or as the source URL when no text came with it, and `raw_signal_id` as the primary signal, NOT NULL. Assert both in the "repeat with new text" case. |
| 4 | minor | 3 Grounding (library); open since R2 | `SignalRepository.transaction(fn)` has no signature. better-sqlite3 rejects a callback that returns a promise (`TypeError('Transaction function cannot return a promise')`), so an `async` service callback fails at runtime. | Type it as `transaction<T>(fn: (tx: SignalTx) => T): T` and add "no `await` inside" to *Import use case*. |
| 5 | minor | 3 Grounding (internal consistency) | *Design › Contracts* (line 130) says `url?: z.url({ protocol: /^https?$/ })`, while D-5 and *Findings* say `z.httpUrl()`. They are not equivalent: `httpUrl` also applies the `domain` hostname regex. | Use one of them in both places. |
| 6 | minor | 5 Scope / test budget; open since R2 | The Phase 2 table over every filter, sort and page goes beyond `test-plan.md` ("one or two integration tests for the main path … no tests for simple CRUD"). *Findings* line 95 counts TR-06 as the only `test` risk. | Reduce it to one main-path list test, or record a decision that justifies the full table (e.g. FR-25 AC2). |
| 7 | minor | 4 Phasing (e2e); open since R2 | D-13 runs at 360×740, but the plan does not assert "no horizontal scroll" on `/okazje` and `/import`. `e2e/smoke.spec.ts:24,66` already contains that one-line check. | Repeat the `scrollWidth - clientWidth` assertion on both new views. |

## Decisions the PR reviewer should look at
- D-2 / D-8: only the canonical URL is stored as the source URL, and the query string is rebuilt (finding 1).
- D-14: `signal_identities` uses first-owner-wins and URL-over-hash on conflict. This fixes how identity behaves for S-09/S-10.
- D-1: what a `REPEAT_IMPORT` evidence row holds. It is the only copy of a second pasted text.
- D-9 / D-10: the list query contract, and the `sources { checked, errors }` stub that S-12 must replace.

## What is good
- D-14 fixes the R1 identity blocker in the database itself (`PRIMARY KEY (kind, value)`), and the cross-identity sequences are tested.
- Every 400 goes through the contract schema and the shared Zod handler (`http-errors.ts:16`), and the configured text limit shows up in OpenAPI.
- The references hold up: `schema.ts`, `app.ts:18-29`/`56-57`/`75`, `openTestDb` (`test/helpers/app.ts:30`), `buildTestApp({ dir })` (`:56`), the e2e login budget (`smoke.spec.ts:44-46`).
- The scope is tight, and every deferral names its owner (S-04, S-06, S-09, S-10/S-12, FR-30).
