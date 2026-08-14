## Why

WebChat's checked-in executable source currently mixes imperative loops, callback iteration used only for side effects, and in-place collection mutation. That makes traversal intent harder to review and permits new code to keep extending patterns that the repository now wants to replace with result-oriented, non-mutating expressions.

## What Changes

- **BREAKING (source-quality contract)** Prohibit `forEach` throughout repository-owned JavaScript/TypeScript-family source and require traversal to express its result with the collection method that matches the operation.
- Permit `for`, `for...of` (including `for await...of`), and `for...in` when the loop body genuinely needs `break`, `continue`, or an early return that cannot be expressed directly with `some`, `every`, `find`, `findIndex`, or another result-oriented operation. Also permit only `for...of` at an explicit owner commit when the owner exposes only ordered per-item external effects and no existing bulk primitive can preserve the behavior; when the source collection has observable live membership semantics, the loop must preserve them.
- Require `map`, `filter`, `flatMap`, `reduce`, `some`, `every`, `find`, and `findIndex` to be selected by their returned meaning, with no hidden callback side effects or use as a disguised `forEach`.
- Prefer copying collection methods such as `toSorted`, `toReversed`, and `toSpliced` when the result is a sorted, reversed, or edited copy; do not mutate an input merely to derive a result.
- Refactor side-effect traversal into an immutable owner-specific plan followed by one explicit owner-level commit invocation whenever an existing bulk primitive can submit the plan. Where the owner exposes only per-item external effects and no such primitive exists, retain only a narrowly annotated `for...of` at the owner commit; do not snapshot a live collection when same-pass membership changes are observable. Preserve current ordering, sequential async behavior, short-circuiting, error propagation, resource cleanup, and product behavior.
- Apply one clean cut to all tracked repository-owned executable source, including production, tests, E2E, root/build configuration, checked-in tools, and ported source. Exclude only generated artifacts, dependency/cache output, and non-executable documentation examples.
- Add repository-owned structural enforcement as a read-only functional pass of the existing Oxlint quality surface, with real-source fail-before evidence and no new linter, parser, test, or fixture file. Every retained control-flow or per-item owner-commit loop requires a narrow, auditable statement annotation; broad path, file, or rule disables are forbidden.
- Keep the existing test corpus scenario-stable: tests and E2E remain inside the all-source rule scope and may receive only equivalent mechanical iteration rewrites, with no new case, assertion, expectation, abstraction, coverage, or fixture.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `source-quality-tooling`: Add the repository-wide functional-iteration, non-mutating collection-transform, exception, scope, and automated-enforcement contract.

## Impact

- All tracked `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, and `.cts` executable source, including `src/**`, `e2e/**`, root configuration, and repository-owned `.agents` tools and tests.
- Existing Oxc commands, one functional-only Oxlint configuration, and a small repository-owned Oxlint plugin; both the general and functional passes use the installed Oxlint binary, so no new direct dependency or second linter is introduced.
- Existing iteration and collection-transform implementations may change, including equivalent syntax-only rewrites in tests and E2E, but test scenarios and expectations, extension behavior, protocol, persistence, permissions, timing, ordering, concurrency, and visible copy remain unchanged.
- PR #126, its acceptance branch, and its capacity/Schema contract remain outside this change.
