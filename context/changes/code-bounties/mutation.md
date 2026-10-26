# Mutation: code-bounties

## Phase 2: `apps/api/src/infrastructure/sources/github/reward.ts`

Score 88.95 % (159 killed, 2 timeout, 20 survived), target 80 %.

Re-run after fix-review (R1, R5): 89.92 % (209 killed, 5 timeout, 24 survived, 1 error); the R1 rules added mutants, not reviewed one by one.

Survivors, all decided as accepted:

| Where | Mutants | Decision |
|-------|---------|----------|
| `KEYWORD` (l. 19) | 5 regex variants of the `\p{L}*` tails and the `płac`/`płatn` branches | Equivalent for the lines tested: a keyword line is selected by the stem alone, and the tail only matters for the lookahead. Kept. |
| `RATE` (l. 21) | 7 variants of `\s?` and the lookahead class | Equivalent or only narrowing the lookahead for exotic characters (`/h` followed by a digit or a non-Latin letter). A false "rate" refusal is the safe direction. Kept. |
| `MARKER_BEFORE` / `MARKER_AFTER` (l. 26–27) | 5 anchor and class variants | Not equivalent for `MARKER_BEFORE`: without the `$` anchor `Bounty $: 50` reads 50 USD; pinned by a negative test in `reward.test.ts` (R5). The `MARKER_AFTER` window variants stay equivalent. Kept. |
| `hasForeignDollar` (l. 41) | `at > 0`, `''` | Equivalent: a `$` at index 0 has no letters before it. |
| `majorUnits` (l. 50) | drop the `$` anchor | Equivalent: `TOKEN` already ends the number. |
| `quote` (l. 74) | drop `.trim()` | Equivalent: the span starts and ends on a marker or digit. |
