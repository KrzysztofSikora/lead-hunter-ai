# Mutation check: repo-skeleton

Targets: `packages/config/src/env.ts` (env validation and error mapping, FR-23) · Tests: `stryker.config.mjs` (vitest runner, `packages/config`)
Score: 75.00% -> 94.12% (64 killed / 3 survived / 1 no coverage / 0 timeout)

None of the files listed in `context/test-plan.md` *Mutation targets* exist yet. The only changed logic file that validates input or maps errors is `env.ts`. `health-probe.ts` is a thin try/catch, and `contracts/health.ts` is a schema covered by `health.test.ts`. They were not mutated.

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| env.ts:21 | StringLiteral | `'test'`/`'production'` -> `""` in NODE_ENV enum | strengthen | `accepts NODE_ENV=%s` |
| env.ts:79 | Conditional / Equality / Logical | choice between custom message and EXPECTED hint | strengthen | `explains the expected values for ...`, `names the host in the refusal` |
| env.ts:34, 58, 60, 65-68 | StringLiteral / ObjectLiteral | message text, separator, error name, hint map | strengthen (stable fragments) | hint fragments, error name, line count of the multi-issue message |
| env.ts:32 | StringLiteral | `code: 'custom'` -> `""` | equivalent | `issue.code` only selects the message; with no EXPECTED entry for OPERATOR_PASSWORD_HASH both branches give the same text |
| env.ts:79:20, 79:35 | Conditional / StringLiteral | `false` / `code === ""` | equivalent | same reason: the fallback `EXPECTED[v] ?? issue.message` yields the custom message |
| env.ts:58:91 | StringLiteral | `'\n'` join -> `""` | accept (survivor on one run) | the line-count assertion kills it on the multi-issue case; the remaining survivor is incidental wording |
| env.ts:76:50 | StringLiteral | `'env'` fallback -> `""` | equivalent | `path[0]` is always set for an object schema; the fallback is unreachable |

## Dead-weight tests
None found.

## Gaps for the test plan
None. The targets in `context/test-plan.md` come with the later changes that create them.

## Proposed lessons
None.
