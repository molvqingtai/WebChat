## Context

See `proposal.md` for motivation. The clean `develop@10801251a7a6b744fd246960daed01eef323c868` baseline contains 305 tracked JS/TS-family files. Exactly one, `.agents/skills/archify/renderers/shared/generated-validators.mjs`, is generated output; the other 304 are repository-owned executable source. Existing imperative traversal spans product code, tests, E2E, root configuration, the checked-in Archify tool, and source ported into `src/lib/uglyAvatar`.

Oxlint is already the sole repository linter and supports repository-local ESLint-compatible JS plugins in the installed version. It has a native `unicorn/no-array-for-each` rule, but no native rule expresses the Owner's complete exception boundary for loop statements or the contextual distinction between derived-value mutation and an explicit owned mutation command. The current ignore list also excludes `src/components/ui`, `src/components/magicui`, and `src/lib/uglyAvatar` from general linting.

This change is stacked independently of PR #126: the bottom Draft PR contains only this authority, and the top Draft PR contains enforcement plus the repository-wide source clean cut. Each layer receives exact-bound CI and fresh Inspector review; the top layer also receives cumulative full-repository verification.

## Goals / Non-Goals

**Goals:**

- Make the coding standard executable through the existing Oxc quality workflow.
- Keep method choice semantic and prevent `map` or `reduce` from becoming renamed side-effect iteration.
- Make every retained loop exceptional, local, and auditable.
- Preserve observable ordering, sequential async behavior, termination, error propagation, cleanup, and product behavior through the clean cut.

**Non-Goals:**

- Introducing a second linter, ambient CLI dependency, compatibility layer, generic lifecycle abstraction, or product feature.
- Reformatting or applying every unrelated Oxlint rule to previously ignored copied UI/ported source.
- Treating `Promise.all` as a universal replacement for sequential async work.
- Rewriting generated validator output by hand.
- Adding new product test cases or shared test abstractions; existing fixtures and expectations change only when mechanically necessary to preserve coverage.

## Decisions

### 1. Enforce the contract through one repository-local Oxlint plugin

Add a small local JS plugin and a functional-only Oxlint configuration. The plugin owns the structural rules needed for forbidden loop syntax, narrow loop exceptions, and prohibited collection-transform patterns; the repository command owns broad-waiver detection. Enable native `unicorn/no-array-for-each` where it precisely matches the contract, and keep repository-specific semantics in the local plugin rather than adding another parser or linter dependency.

The plugin is executable source and follows its own final rules. Its rules receive focused valid/invalid fixtures through Oxlint's installed `RuleTester` surface, and the functional command receives an invocation-level scope fixture. Because a generic `oxlint-disable` comment suppresses plugin diagnostics too, the same repository-owned command uses the installed TypeScript scanner only to inspect comment trivia and reject generic or functional-rule disable directives before invoking Oxlint with `--no-ignore --disable-nested-config`. This adds no parser dependency or second linter. The functional pass is always read-only: `lint` and lint-staged may run the existing general fix pass first, but they then run the functional check without `--fix`, so `unicorn/no-array-for-each` cannot auto-rewrite one prohibited construct into another. The canonical `lint`, `lint:check`, lint-staged, CI, and CD entry points each invoke both passes.

Alternative rejected: depend on ambient `ast-grep`. It was suitable for the baseline inventory, but it is not a declared project dependency and would create a second CI toolchain.

Alternative rejected: text or regular-expression scanning. Comments, strings, optional chaining, computed properties, nested functions, and syntax variants require parsed structure.

Alternative rejected: documentation-only review. It does not prevent regressions after the clean cut.

### 2. Use a separate functional-only pass to reach every authored file

Keep `.oxlintrc.json` and its general-lint ignores intact. Add a separate functional-only configuration that disables unrelated built-in categories and enables only `unicorn/no-array-for-each` plus the repository functional rules. A repository-owned command derives the exact JS/TS-family path manifest from `git ls-files`, removes only `.agents/skills/archify/renderers/shared/generated-validators.mjs`, and passes the remaining paths to the functional Oxlint invocation. This reaches every tracked authored file, including hidden `.agents` source, ported avatar code, copied UI source, tests, E2E, and root configuration.

Oxlint resolves root ignore patterns before per-file overrides, so an override inside the general configuration cannot recover paths that it already ignores. Recursive path discovery also follows the tracked `.pi/skills/archify` symlink and would scan the same Archify tree twice, including the generated file under an alias path. The exact tracked-file manifest avoids both problems without a broad path exclusion. The second pass is therefore an enforcement boundary, not a duplicate linter: both passes use the installed Oxlint binary, while the functional pass does not import unrelated general rules. The implementation must not remove broad existing general-ignore entries merely to reach these files; `oxlint --no-ignore` already demonstrates unrelated type-import and unused-value debt in copied UI/avatar sources.

Alternative rejected: exempt `src/lib/uglyAvatar` or `.agents`. Both are checked-in executable logic that WebChat owns and ships or runs; the Owner said all code logic.

Alternative rejected: remove all current ignore entries. That turns this focused standard into a separate cleanup of unrelated formatting and lint findings.

### 3. Treat loop syntax as an exception, not a heuristic permission

The local rule reports every `ForStatement`, `ForOfStatement`, `ForInStatement`, `WhileStatement`, and `DoWhileStatement` by default. A retained statement uses one dedicated functional-iteration justification annotation immediately adjacent to that statement. A control-flow reason names its required `break`, `continue`, early return, or condition-driven process. An owner-commit reason is valid only for `for...of` and names the ordered per-item external effect and absence of an existing bulk primitive; when the source collection is live, it also names the observable membership behavior that a snapshot would change. The rule consumes that annotation directly; a generic Oxlint/ESLint disable directive is not the exception mechanism. The command-level comment check rejects generic and functional-rule disable directives, `--disable-nested-config` prevents directory configuration waivers, and Oxlint reports unused directives.

The rule verifies that an annotation is statement-local and names a structurally eligible form, but it cannot prove semantic necessity: a loop containing `break` might still be expressible by `find`, and an alleged owner commit might already have a bulk primitive, expose more than per-item effects, or snapshot a live collection. Structural enforcement therefore creates an explicit review point; fresh Inspector review decides whether each annotation satisfies the specification.

Alternative rejected: automatically allow any loop containing `break` or `continue`. That would accept gratuitous loops and miss direct `some`/`find` replacements.

Alternative rejected: encode every allowed source location in configuration. A path allowlist hides the reason, grows stale, and waives future changes inside the same file.

### 4. Select methods by returned meaning and separate effects from computation

Source migration proceeds by semantic category rather than by token replacement:

- one-to-one output uses `map`;
- subset selection uses `filter`;
- zero/one/many output uses `flatMap`;
- one aggregate or immutable state uses `reduce`;
- boolean or first-match questions use `some`, `every`, `find`, or `findIndex`;
- copied order/edit transforms use `toSorted`, `toReversed`, or `toSpliced`;
- side-effect traversal computes an immutable owner-specific plan first, then submits it through one explicit owner-level commit invocation when an existing bulk primitive can preserve behavior;
- an explicit owner commit with only ordered per-item external effects may retain one annotated `for...of` when no existing bulk primitive can preserve the behavior; a live source collection remains live rather than being snapshotted.

No callback may mutate its input, its accumulator, or outer state; notify listeners; write storage/DOM; dispose resources; or merely return a mutated receiver to satisfy a rule. When an existing owner/batch primitive can preserve behavior, migration must compute an immutable owner-specific plan and submit that plan through one explicit owner-level commit invocation without changing notification order or exception semantics. When the owner exposes only per-item effects and no existing bulk primitive can preserve the behavior, that explicit owner commit instead retains one statement-local annotated `for...of`. If membership changes during a live `Set`, `Map`, or equivalent iteration affect the current pass, the loop traverses that collection directly because converting it to an array would change behavior. It must not hide the traversal in `map`, `reduce`, recursion, or a new generic helper. Structural rules reject mechanically provable callback effects, and fresh Inspector review covers semantic purity and every owner-commit claim that syntax alone cannot prove.

Alternative rejected: mechanical `forEach` to `map`. It allocates an unused array and misrepresents side effects as a transformation.

Alternative rejected: use `reduce` as universal syntax. A reducer that mutates external state is only `forEach` in disguise, while spreading a live `Set` or `Map` before reducing creates a snapshot and changes how same-pass additions and removals are observed.

### 5. Preserve sequential and mutation semantics exactly

Sequential async loops remain sequential after refactoring. A promise chain or reducer is acceptable only when it keeps the code clear and preserves order, backpressure, first failure, cancellation, and cleanup; `Promise.all` is forbidden where it would add concurrency.

`toSorted`, `toReversed`, and `toSpliced` replace derived-copy patterns. Direct `splice`, `sort`, or `reverse` may remain only where in-place mutation of an owned collection is the explicit commit operation, such as draining a queue. The local structural rule flags unambiguous derived-copy forms; Inspector review covers contextual owned mutations.

Alternative rejected: prohibit every mutating method absolutely. The Owner's examples describe non-mutating derivation, while an explicit queue drain is a command with different semantics; forcing it through copying methods could retain stale entries or add a second mutation step.

### 6. Use one clean-cut implementation layer

The top stacked PR removes all disallowed existing constructs in one repository-wide source candidate and adds no compatibility path, fallback, or staged allowlist. Focused fail-before fixtures first prove the new rule rejects representative `forEach`, ordinary loops, broad disables, derived-copy mutation, and disguised callback effects while accepting narrowly justified control-flow loops, one per-item owner-commit `for...of`, and the exact generated exclusion.

Existing tests and fixtures may be mechanically synchronized, but no new product scenario or test abstraction is introduced. The final exact must pass the local rule fixtures, the functional-pass scope fixture, zero-residue structural scans, the complete existing test suite, typecheck, format/lint, both production builds, OpenSpec strict validation, and exact CI.

## Risks / Trade-offs

- [Callbacks hide effects under functional syntax] -> Review callback bodies and require pure computation plus one explicit owner commit; treat unused `map`/mutating reducers as blockers.
- [A loop suppression becomes a permanent loophole] -> Require a statement-local reason, reject broad disables, report unused directives, and review every retained exception on the final exact.
- [An owner-commit label disguises ordinary traversal] -> Require proof of an explicit ordered per-item effect boundary and no existing bulk primitive; reject derived-result work, and separately prove that any live source collection is not snapshotted.
- [Sequential work becomes concurrent] -> Preserve await order, backpressure, cancellation, and first-error behavior; do not introduce `Promise.all` without pre-existing concurrency semantics.
- [Ported numerical code changes output] -> Include ported source, preserve operation order and random-call order, and run existing avatar/product gates; a behavior-changing algebraic rewrite is out of scope.
- [Previously ignored files reveal unrelated lint debt] -> Keep the general pass and ignores unchanged; apply only the dedicated functional rules through the second Oxlint configuration.
- [Generated output violates authored rules] -> Remove its one exact tracked path from the functional manifest and enforce the generator that owns it; do not discover the same file through symlink aliases.
- [Large mechanical diff obscures behavior changes] -> Keep docs and implementation in separate stacked PRs, group review by semantic conversion class, and require cumulative full-repository gates on the top exact.

## Migration Plan

1. Publish this four-file docs authority as the bottom Draft PR from exact `10801251a7a6b744fd246960daed01eef323c868`; lock parent/tree/head/CI and obtain fresh Inspector review.
2. From the reviewed docs exact, create the top Draft PR. Add focused structural fail-before fixtures, the local Oxlint plugin, the functional-only second-pass configuration, and the exact generated-file exclusion.
3. Refactor every in-scope violation by semantic category while preserving ordering, live collection behavior, random-call order, sequential async behavior, errors, cleanup, and product output. Add only necessary statement-local control-flow or per-item owner-commit justifications.
4. Run focused rule fixtures, structural zero-residue scans, full existing tests, typecheck, format/lint, Chrome/Firefox builds, OpenSpec gates, and same-exact hosted CI. Obtain fresh Inspector review of the top increment and cumulative stack.
5. Keep both PRs Draft. No Ready, merge, deployment, release, or change to PR #126 occurs without separate Owner authority.

Rollback is code-only: revert the top implementation PR, then the bottom authority PR. No protocol, storage, data, permission, or user migration exists.
