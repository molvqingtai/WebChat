## Context

The clean `develop` tree tracks 305 files with JavaScript or TypeScript extensions. Exactly one is explicitly generated: `.agents/skills/archify/renderers/shared/generated-validators.mjs`, emitted by the tracked Archify generator and marked not to be edited by hand. The remaining 304 files are the complete authored scope, including product source, tests, browser harnesses, configuration, and tracked Archify source.

Current traversal has several distinct shapes that must not be treated as interchangeable:

- result construction that declares an outer `let`, array, object, map, set, or other temporary and changes it from a loop or callback;
- `forEach` used only to perform callback effects and discard the method result;
- an imperative loop whose observable behavior depends on a genuine `break`, `continue`, or function early return;
- a condition-driven `while` or `do...while` whose termination is not collection exhaustion; and
- a reduction that mutates only a fresh accumulator which is private to that reduction.

The desired style is the shortest behavior-equivalent expression with the fewest necessary variables. This is not a request to mechanically replace one syntax with another. In particular, changing an effectful `forEach` to `for...of` preserves the same external mutation while adding syntax, and changing a valid private reducer accumulator to repeated immutable cloning adds work and behavioral risk without removing an external side effect.

## Goals / Non-Goals

**Goals:**

- Express collection-derived results directly with the standard operation that names the intent.
- Eliminate avoidable outer mutable temporaries and single-use traversal scaffolding.
- Remove every authored `forEach` and every `for` statement that lacks irreducible control flow.
- Keep functional callbacks free of external mutation and external commits.
- Preserve valid local mutation of a fresh, exclusive, non-escaping reducer accumulator.
- Preserve exact behavior while applying the same rule to production, test, harness, configuration, and tracked tool source.
- Verify the result with only existing repository tools and independent source review.

**Non-Goals:**

- No product feature, bug fix, performance redesign, concurrency redesign, protocol, persistence, DOM, storage, wire, or public-interface change.
- No source minification or preference for fewer characters when it obscures intent or changes evaluation.
- No custom Oxlint plugin, local plugin, parser, second linter, dependency, committed scan script, generated rule table, or semantic-analysis module.
- No `owner-commit`, `functional-loop`, lint-disable, or other annotation that turns a nonconforming loop or callback into an exception.
- No new test case, parameter row, assertion, fixture, mock capability, test helper abstraction, or coverage requirement.
- No hand edit to the generated Archify validator and no expansion of the generated-file exclusion.

## Decisions

### 1. A traversal that derives a result returns that result directly

Choose the standard operation by observable intent:

- `map` for one output per input;
- `filter` for selection;
- `flatMap` for mapping with zero or multiple outputs;
- `find` for the first matching value;
- `some` or `every` for a predicate with short-circuiting;
- `reduce` for a scalar, grouped, indexed, or otherwise accumulated result; and
- `Object.entries`, `Object.values`, `Object.keys`, `Object.fromEntries`, and existing collection constructors when they remove manual object traversal.

The chosen operation should be returned or assigned directly. Do not declare an outer mutable accumulator, mutate it during traversal, and read it afterward when a standard operation can produce the same value. Do not retain a one-use intermediate that merely forwards one collection result into the next operation when a direct expression is equally clear and behavior-equivalent.

"Shortest" means the most direct repository-formatted expression among behavior-equivalent implementations. It does not authorize minification, compressed names, duplicated work, eager materialization, changed iteration order, or a longer chain that conceals semantics.

Alternative rejected: use `forEach` with an outer `let`, `push`, `set`, assignment, or deletion. It makes the callback's result `undefined`, hides the actual result in external mutation, and requires extra mutable state.

Alternative rejected: replace `forEach` with `for...of`. It does not achieve direct result production or fewer variables and all `for` variants are governed by the same exception rule.

### 2. Every `for` variant requires irreducible control flow

`for`, `for...of`, `for await...of`, and `for...in` are all `for` statements. Syntax, iterator type, asynchronous iteration, live collection membership, ordered effects, or the absence of a convenient bulk API is not by itself an exception.

A `for` statement may remain only when its actual body needs `break`, `continue`, or a function early return and replacing that behavior with `find`, `some`, `every`, or another direct operation would not be equivalent. Merely adding or retaining a control-flow keyword does not qualify if a standard short-circuiting method expresses the same behavior directly.

`while` and `do...while` may remain for condition-driven algorithms whose changing condition is the termination contract. They must not replace indexed or iterable collection traversal that a direct operation can express.

No comment, annotation, ownership label, or lint suppression can legalize a loop that does not meet these semantics. A valid remaining loop is justified by its code and behavior, not by a waiver string.

### 3. Functional callbacks do not commit outside themselves

A callback passed to `map`, `filter`, `flatMap`, `find`, `some`, `every`, `reduce`, sorting, object-entry transformation, or another result-oriented collection method must derive its returned value without an external side effect.

External side effects include:

- assigning to or incrementing an outer binding;
- mutating an input value, closed-over object, shared collection, singleton, cache, or externally reachable owner;
- invoking DOM, browser, storage, database, wire, persistence, event-dispatch, timer, logging, or other I/O/effect APIs; and
- using a result-oriented method only as an iteration carrier while ignoring the created result.

If existing code needs a repeated external commit, the source owner must use an existing bulk operation or reorganize ownership so the traversal creates a local replacement followed by one explicit commit outside the traversal. It must not hide the same repeated effect inside `forEach`, `map`, `reduce`, or another callback, and it must not move the effect to another forbidden loop statement.

This boundary distinguishes external effects from private reduction mechanics. A reducer may mutate an accumulator when the accumulator is created for the current invocation, exclusively owned by that reduction, not reachable through an input or outer/shared state, and unable to escape before the reduction completes. The callback must return that accumulator for the next step, and only the completed result may leave the reduction.

The existing `assembleURL` implementation satisfies this rule: `new URL(url)` creates the reduction-owned accumulator, `searchParams.append` mutates only that fresh object, and the object does not escape before `.toString()`. Rewriting it is outside scope and would risk query ordering or encoding behavior without removing an external side effect.

### 4. The migration is one behavior-neutral authored-source pass

The implementation manifest is fixed from clean `develop`: all tracked `*.js`, `*.jsx`, `*.ts`, `*.tsx`, `*.mjs`, and `*.cjs` files, minus only `.agents/skills/archify/renderers/shared/generated-validators.mjs`. The manifest contains exactly 304 authored files. Ignore patterns used by formatter or linter configuration do not remove a tracked authored file from this cleanup.

The generated validator remains byte-identical and is verified through its existing generator controls. Its generator is authored source and remains in scope. No other file may claim generated, vendored, test, fixture, harness, configuration, or tool status as an exclusion.

Every rewrite must preserve evaluation order, iteration order, call count, synchronous or asynchronous settlement, concurrency, return values, thrown and rejected errors, object identity, mutation visibility, event order, timers, storage and database operations, network/wire behavior, DOM behavior, and generated output. A shorter expression is acceptable only when it is behavior-equivalent.

Existing tests, fixtures, and harnesses may receive only the minimum behavior-equivalent iteration or private-state ownership edits necessary to satisfy the same authored-source rule. An existing private fixture owner may replace its complete internal state once when that removes repeated external mutation, but its exposed object and behavior must remain equivalent. Test names, scenarios, inputs, assertions, expected values, timing, mocks, public fixture contracts, and coverage remain unchanged. No new test, fixture, or test abstraction is part of this cleanup.

### 5. Existing tooling provides the complete implementation surface

Oxfmt remains the sole formatter, Oxlint remains the sole linter, and TypeScript remains the type-analysis gate. The existing Oxlint configuration may enable a built-in rule already shipped by the installed Oxlint/plugins when that rule exactly enforces a syntactic part of this standard. It must not register, load, generate, or depend on a new plugin, parser, linter, runtime module, rule implementation, or package.

Semantic decisions that the existing toolchain cannot express are verified by the implementation diff, read-only source inspection, existing tests, typechecking, builds, and fresh independent review. No committed scanner or second enforcement path is introduced to approximate them. The final source must not contain a new waiver comment or rule-specific annotation for this migration.

## Risks / Trade-offs

- **A shorter expression changes order or concurrency** -> Compare observable ordering and settlement at each site; retain semantics even when that requires a slightly longer direct expression.
- **A result-oriented method hides an external effect** -> Reject the rewrite and move ownership to an existing bulk operation or a local replacement followed by one explicit commit outside the traversal.
- **A loop contains a nominal control keyword but has a direct equivalent** -> Use the direct short-circuiting method; the keyword alone is not an exception.
- **A local reducer mutation is mistaken for an external side effect** -> Apply the fresh, exclusive, non-escaping test; keep `assembleURL` unchanged.
- **Generated code dominates structural scans** -> Exclude only the exact generated validator path and keep its generator in scope.
- **Existing Oxlint cannot encode the semantic rule** -> Use its existing built-in coverage where exact, then rely on source review rather than adding another parser or linter.
- **Existing test edits accidentally change evidence** -> Limit edits to behavior-equivalent iteration or private-state ownership and reject any new or changed scenario, assertion, fixture contract, helper abstraction, timing, or coverage behavior.

## Migration Plan

1. Freeze this docs-only authority as one sole child of clean `develop@10801251a7a6b744fd246960daed01eef323c868`, validate it, and obtain fresh independent docs review.
2. From the reviewed authority exact, record the 304-file authored manifest and a read-only baseline inventory of traversal forms before editing product source.
3. Produce one source child that applies the direct-result rule, external-effect boundary, valid control-flow exceptions, generated exclusion, and no-test policy without adding an enforcement layer.
4. Verify the exact source diff with existing format, lint, typecheck, test, build, generated-artifact, OpenSpec, and repository-cleanliness gates; confirm the original `assembleURL` implementation is unchanged.
5. Obtain fresh independent source review of the immutable exact. Keep both pull requests Draft and do not mark Ready, merge, run browser acceptance, deploy, release, or change production without separate Owner authority.

Rollback is source-only: revert the behavior-neutral cleanup and any built-in Oxlint configuration change. There is no protocol, schema, persistence, data, or deployment migration.
