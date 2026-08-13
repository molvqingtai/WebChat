## 1. Freeze Authority And Baseline

- [ ] 1.1 Publish the four-file docs-only authority from `develop@10801251a7a6b744fd246960daed01eef323c868` as the bottom Draft PR; record its exact, tree, sole parent, branch, PR base/head, clean-worktree state, and same-exact CI.
- [ ] 1.2 Obtain fresh Inspector review of the immutable bottom exact for method semantics, callback purity, exception boundaries, 304-file authored-source scope, exact generated exclusion, stack isolation from PR #126, and no behavior-change contract.
- [ ] 1.3 On the reviewed bottom exact, record an AST-based inventory of `forEach`, `for`/`for...of`/`for...in`, `while`/`do...while`, `sort`/`reverse`/`splice`, existing ignore coverage, and the exact generated-source provenance before source implementation.

## 2. Add Structural Enforcement

- [ ] 2.1 Add a repository-local Oxlint JS plugin and focused `RuleTester` fixtures that fail before cleanup on representative `forEach`, ordinary loops, and derived-copy mutation, while accepting direct functional operations and one narrowly annotated control-flow loop.
- [ ] 2.2 Add a functional-only Oxlint configuration that disables unrelated built-in categories and enables native `unicorn/no-array-for-each` plus the local functional rules. Invoke it with an exact `git ls-files` JS/TS-family manifest that removes only `.agents/skills/archify/renderers/shared/generated-validators.mjs`; add a scope fixture proving all other 304 tracked authored paths are scanned once, including hidden `.agents`, ported avatar, copied UI, tests, E2E, and root configuration, without `.pi` symlink duplication.
- [ ] 2.3 In the same functional command, use the installed TypeScript scanner only to inspect comment trivia and reject generic or functional-rule Oxlint/ESLint disable directives before running Oxlint with `--no-ignore --disable-nested-config`. Add focused comment fixtures proving real broad waivers fail while directive-like string literals do not; add no parser or linter dependency.
- [ ] 2.4 Keep the functional pass read-only and integrate both Oxlint passes into the existing `lint`, `lint:check`, lint-staged, CI, and CD entry points without an unrelated general-lint expansion or direct workflow bypass of the package commands. The existing general pass MAY fix first; the functional pass SHALL run without `--fix` and report unused directives.

## 3. Perform The Repository-Wide Clean Cut

- [ ] 3.1 Replace every `forEach` and every result-producing ordinary loop with the semantic `map`, `filter`, `flatMap`, `reduce`, `some`, `every`, `find`, or `findIndex` operation; remove unused return values, external mutation, notification, cleanup, I/O, and other side effects from callbacks.
- [ ] 3.2 Refactor side-effect traversals into an immutable owner-specific plan plus one explicit owner-level commit invocation, preserving iteration order, first-error behavior, resource cleanup, notification semantics, and mutation ownership without a new generic traversal/lifecycle abstraction or effectful functional callback.
- [ ] 3.3 Preserve sequential async order, backpressure, cancellation, and failure semantics. Do not introduce `Promise.all` where execution is currently sequential.
- [ ] 3.4 Replace copied `sort`, `reverse`, and `splice` derivations with `toSorted`, `toReversed`, and `toSpliced`; retain direct mutation only where it is the explicit owned commit operation and keep it outside pure callbacks.
- [ ] 3.5 Audit every remaining `for`, `for...of`, `for...in`, `while`, and `do...while`. Replace directly expressible cases and add only narrow statement-level justifications for genuine control-flow or condition-driven exceptions; preserve numerical operation and random-call order in ported avatar code.
- [ ] 3.6 Mechanically synchronize existing fixtures and expectations only where necessary; add no new product test scenario, compatibility path, fallback, migration, product copy, protocol/storage/permission/timing change, or shared test abstraction.

## 4. Verify And Publish The Top Layer

- [ ] 4.1 Pass focused plugin fixtures, the functional-pass scope fixture, and AST residue scans with zero `forEach`, zero unjustified loop statements, zero prohibited derived-value mutations, zero broad functional-rule waivers, one exact generated exclusion, and a complete manifest of retained justified loops.
- [ ] 4.2 Pass the complete existing test suite, WXT/TypeScript check, format/lint fix plus clean diff, read-only format/lint checks, Chrome and Firefox production builds, strict OpenSpec validation, status, Doctor, commitlint, diff check, and clean-worktree checks on one exact.
- [ ] 4.3 Publish one implementation child of the reviewed docs exact as the top Draft PR targeting the docs branch; record exact, tree, sole parent, both PR bases/heads, cumulative diff, clean-worktree state, and same-exact CI.
- [ ] 4.4 Obtain fresh Inspector review of both the top incremental diff and cumulative repository state, including callback side effects, loop-justification legitimacy, sequential async semantics, ported numerical/random behavior, generated-source boundary, full gates, and zero product-behavior change.
- [ ] 4.5 Keep both PRs Draft and PR #126 unchanged. Perform no Ready, merge, browser acceptance, deployment, release, or production action without separate Owner authority.
