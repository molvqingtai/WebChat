## 1. Freeze Scope And Semantics

- [x] 1.1 Lock the clean `develop@10801251a7a6b744fd246960daed01eef323c868` manifest at 305 tracked JavaScript/TypeScript files and identify the exact generated Archify validator as the sole exclusion, leaving 304 authored files.
- [x] 1.2 Freeze the Owner's goal as the shortest behavior-equivalent iteration expression with the fewest necessary variables: direct results replace outer mutable temporaries and discarded-result traversal.
- [x] 1.3 Freeze all `for` variants under one irreducible-control-flow exception, condition-driven `while`/`do...while`, the external-side-effect callback boundary, and the fresh exclusive reducer-accumulator allowance.
- [x] 1.4 Record that the original `assembleURL` reducer is conforming and must remain unchanged.
- [x] 1.5 Freeze the existing-toolchain-only, no-new-test, generated-file, behavior-neutral, Draft-only, and no-delivery boundaries.

## 2. Inventory The Authored Source

- [ ] 2.1 Recreate the exact 304-file manifest from the reviewed authority base and record a read-only baseline inventory of `forEach`, all `for` variants, collection-style `while`/`do...while`, outer mutable accumulators, and callback external effects.
- [ ] 2.2 Classify each result-producing traversal by its direct operation (`map`, `filter`, `flatMap`, `find`, `some`, `every`, `reduce`, object-entry transformation, or an existing collection/bulk API) before editing.
- [ ] 2.3 Identify only the loops whose genuine `break`, `continue`, function early return, or condition-driven termination cannot be represented equivalently; do not create annotation-based exceptions.

## 3. Apply One Behavior-Neutral Cleanup

- [ ] 3.1 Replace result-producing loops and outer-mutation callbacks with direct returned or assigned collection results, removing avoidable temporary variables and intermediate traversal state.
- [ ] 3.2 Remove every authored `forEach`; do not replace it mechanically with `for...of` or hide its external effects in another functional callback.
- [ ] 3.3 Reorganize repeated external effects through an existing bulk operation or a locally built replacement with one explicit commit outside the traversal, preserving exact order, multiplicity, settlement, identity, and error behavior.
- [ ] 3.4 Retain only semantically necessary control-flow loops and condition-driven `while`/`do...while`, with no owner-commit, functional-loop, lint-disable, or other waiver annotation.
- [ ] 3.5 Keep the original `assembleURL` reducer and the generated validator byte-identical; modify no file outside the 304-file authored manifest except an exact built-in-only update to the existing Oxlint configuration when needed.
- [ ] 3.6 Add no plugin, parser, linter, dependency, scanner, source enforcement module, test case, test abstraction, fixture, assertion, mock capability, or coverage expansion.

## 4. Preserve Existing Evidence And Behavior

- [ ] 4.1 Apply only the minimum behavior-equivalent iteration or private-state ownership edits to existing tests, fixtures, and harnesses while preserving every public fixture contract, test name, scenario, input, assertion, expectation, timing, and coverage boundary.
- [ ] 4.2 Confirm evaluation order, iteration order, call count, sync/async concurrency, return/error behavior, object identity, mutation visibility, event/timer order, DOM, storage/database, wire/persistence, generated output, and public interfaces are unchanged.
- [ ] 4.3 Confirm the final authored source contains no invalid `forEach`, `for` variant, collection-style `while`/`do...while`, outer mutable traversal accumulator, callback external effect, or migration waiver annotation.

## 5. Verify And Review Independently

- [ ] 5.1 Run the repository's existing Oxfmt, Oxlint, TypeScript, full test, Chrome/Firefox build, generated-artifact, OpenSpec, and cleanliness gates without introducing another enforcement tool.
- [ ] 5.2 Inspect the exact diff against the 304-file manifest and prove the sole generated exclusion, original `assembleURL`, dependency graph, tests' behavioral evidence, protocols, persistence, and product behavior remain unchanged.
- [ ] 5.3 Freeze one immutable source exact and obtain fresh independent review. Keep the docs and source pull requests Draft; do not run browser acceptance, mark Ready, merge, deploy, release, or change production without separate Owner authority.
