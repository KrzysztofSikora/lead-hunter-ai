# Mutation check: url-import-guard

Targets: `apps/api/src/infrastructure/sources/http/address-guard.ts` (whole file; SSRF blocklist, TR-03, target 90 %) · Tests: `stryker.config.mjs` (vitest, perTest)
Score: 85.33% -> 90.67% (killed 64 -> 68 / survived 9 -> 5 / no coverage 2 -> 2 / timeout 0)

Other changed logic files (`robots.ts`, `page-fetcher.ts`, `extract.ts`) are not in *Mutation targets*; not mutated.
The stryker incremental report also lists `scoring/rubric.ts` and `score.ts` from an earlier run; they were not re-targeted here.

Before the first run the dry run failed on an unrelated sandbox problem (see *Gaps*); fixed in the test fixtures, not in production code.

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| address-guard.ts:12 | StringLiteral | error message emptied | accept | wording of the message |
| address-guard.ts:13 | StringLiteral | error `name` emptied | accept | label only; the `code` is what callers use |
| address-guard.ts:19 | ConditionalExpression | `!isValid` check removed | equivalent | `ipaddr.process` throws on invalid input and the `catch` returns false |
| address-guard.ts:22 | BlockStatement | `catch` body emptied | equivalent | unreachable after the `isValid` check; defensive |
| address-guard.ts:23 | BooleanLiteral | `catch` returns true | equivalent | same as above (unreachable); fails closed by construction |
| address-guard.ts:33 | ConditionalExpression | password check -> false | strengthen | killed: `http://:secret@example.com/` -> `blocked_url` |
| address-guard.ts:34 | Regex (x2) | `^`/`$` anchor dropped from the bracket strip | equivalent | `URL.hostname` has brackets only at both ends |
| address-guard.ts:74 | ObjectLiteral / ConditionalExpression / StringLiteral | numeric `options` no longer becomes `{ family }` | strengthen | killed: `turns a numeric family into the family option` |

## Dead-weight tests
None found.

## Gaps for the test plan
- Stryker copies the sandbox through UTF-8, so any non-UTF-8 fixture breaks the dry run. Binary or legacy-charset fixtures must be stored as ASCII escapes (now `pageFixture()` in `apps/api/test/helpers/page-fixture.ts`). Worth a line in *Test data and isolation*.

## Proposed lessons
Fixtures that hold raw non-UTF-8 bytes must survive the mutation sandbox: store them escaped and decode in a helper.
