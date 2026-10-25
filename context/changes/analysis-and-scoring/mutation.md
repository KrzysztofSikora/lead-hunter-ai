# Mutation check: analysis-and-scoring

Targets: `apps/api/src/modules/scoring/rubric.ts`, `apps/api/src/modules/scoring/score.ts` (the two scoring modules from *Mutation targets*; `address-guard.ts` belongs to S-09) · Tests: `stryker.config.mjs` (vitest, perTest)
Score: 82.4% -> 98.5% (killed 190 / survived 3 / no coverage 0 / timeout 0). `score.ts` 100% before and after; `rubric.ts` 77.5% -> 98.0% (target 80%).

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| rubric.ts:67 (x2) | StringLiteral | buyer text in the demand justification emptied | accept | wording of an explanation; the points are pinned by the table |
| rubric.ts:149 | StringLiteral | justification "below minimum job value" emptied | accept | wording only; the 0 points are pinned |
| rubric.ts:80 | MethodExpression | `.trim()` dropped when naming skills | strengthen | killed: `' typescript '` scores 10 |
| rubric.ts:92 | ArithmeticOperator | cap index `length + 1` | strengthen | killed: five distinct matches give 25 |
| rubric.ts:97-99 | Conditional / Equality / String | skill-fit justification | strengthen | killed: count and names asserted, no-match text asserted |
| rubric.ts:110,113 | StringLiteral | speed band text | strengthen | killed: unknown hours and `do 40 h (8 pkt)` |
| rubric.ts:137,157 | Conditional / String | neutral reasons in profitability | strengthen | killed: each reason (no budget, hypothesis, no hours, no rate) |
| rubric.ts:154 | Conditional | `unit === 'HOUR'` always true | strengthen | killed: a DAY-only profile is neutral |
| rubric.ts:166 | Conditional / Equality / Arithmetic | displayed share of the minimum rate | strengthen | killed: `ok. 60%`, zero-hours case `100%` |
| rubric.ts:170,182 | StringLiteral / Conditional / Equality | justification text of profitability and repeatability | strengthen | killed: exact repeatability text with and without the bonus |

## Dead-weight tests
- profitability table: "above the minimum rate" and "exactly the minimum rate" both used 100 000; the first now uses 150 000, so they no longer duplicate each other.

## Gaps for the test plan
- None. The three survivors are justification wording.

## Proposed lessons
none
