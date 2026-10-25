# Plan review: manual-text-import

Verdict: READY WITH NOTES

This is round R4. Every R3 finding has a line in the plan's *Review response*, and I checked
each fix in the plan text. R3 #1, the blocker: `raw_signals.source_url` and
`opportunity_evidence.source_url` were added, `source.url` is now the pasted URL, and the query
is filtered on the `&`-split string (D-2, D-8). R3 #2: the refine is now total. I probed it on
Zod 4.6.7: `'nie-adres'` gives `invalid_format`, `'https://u:p@a.pl/'` gives `custom`, and
nothing throws. R3 #3 to #7 are applied as well. I found no new blocker.

| # | Severity | Check | Finding | Suggested change |
|---|----------|-------|---------|------------------|
| 1 | minor | 3 Grounding (internal consistency) | *Design › Domain* declares `deriveTitle(text: string, canonicalUrl: string \| null)`, but D-7 says "URL-only import → `title` = the source URL as pasted". If the implementer follows the signature, it stores the canonical form (no `?utm_…`, no fragment) as the title. | Change the parameter to `sourceUrl: string \| null` (the parsed, trimmed URL as pasted). |
| 2 | minor | 3 Grounding (D-2) | D-2 filters "on the raw string split at `&`", but it does not say which string. The pasted input and the WHATWG-serialised `new URL(v).search` differ for spaces and non-ASCII characters: `?q=ą` stays as typed in the input but becomes `?q=%C4%85` in `.search`. If the raw input is used, an encoded and an unencoded paste of the same URL get two identities. Host, port and path come from `new URL` anyway. | State that the query string is `new URL(v).search` (already serialised; split at `&`, keep the kept parts byte for byte), and add the unit case `?q=ą` ≡ `?q=%C4%85`. |
| 3 | minor | 7 Failure paths (D-5) | `z.httpUrl()` also applies Zod's domain regex. Probe on Zod 4.6.7: `https://localhost/x`, `http://192.168.1.1/x`, `https://sub_domain.example.com/` and `https://example.com./a` all return `invalid_format`. IDN hosts (`https://zażółć.pl/oferta`), `HTTPS://Example.com:443/…` and non-default ports pass. Rejecting IP-literal and localhost hosts before S-09 does no harm, but the plan does not say it happens, so the operator gets a generic URL error. | Add one sentence to D-5 saying these hosts are rejected by design, and make sure the UI's `invalid_format` message for `url` reads as "nieprawidłowy adres URL". No new test is needed. |

## Decisions the PR reviewer should look at
- D-14: `signal_identities` with first-owner-wins and URL-over-hash on conflict. This fixes how identity behaves for S-09/S-10, which may claim a hash another opportunity already owns.
- D-2: dropping the fragment merges different posts on hash-routed boards into one identity (listed under *Risks*). The normalised content hash also merges identical texts posted at two URLs.
- D-9 / D-10: the list query contract, and the `sources { checked: 0, errors: [] }` stub that S-12 must replace.
- D-1: a `REPEAT_IMPORT` evidence row is the only copy of a second pasted text.

## What is good
- R3 is fully answered. The pasted URL and the canonical identity are separate columns and separate DTO fields, which meets FR-06 AC3 (`context/prd.md:104`).
- Every 400 goes through the contract schema and the shared Zod handler (`apps/api/src/http-errors.ts:16`). I probed this: blank body → `custom:text`, oversize text → `too_big:text`, unparsable URL → `invalid_format:url`, and nothing throws.
- The references check out:
  - `schema.ts` tables and the `check` import
  - `client.ts:13` `foreign_keys = ON`
  - `AppDeps.config: Pick<Config,'nodeEnv'>` (`app.ts:19`), routes after `registerAuth` (`app.ts:56-57`), the 404 body (`app.ts:75`)
  - `openTestDb(dir)` and `buildTestApp({ dir })` (`test/helpers/app.ts:30,59-70`)
  - `ENV_VARIABLES` (`packages/config/src/env.ts:6-13`) and its test (`env.test.ts:159`)
  - the e2e login budget and the no-scroll assertion (`e2e/smoke.spec.ts:24,44-47,66`)
  - the per-run `DATA_DIR` (`playwright.config.ts:8`)
- The test budget matches `context/test-plan.md:17-29`:
  - one main-path list test
  - TR-06 tables
  - one e2e test inside the existing spec
  - the per-filter checks left as human checks
- The synchronous transaction contract matches better-sqlite3, so lookup and insert are atomic in the single process.
