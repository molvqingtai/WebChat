## Context

The clean `develop` tree tracks 305 files with JavaScript or TypeScript extensions. Exactly one is explicitly generated: `.agents/skills/archify/renderers/shared/generated-validators.mjs`, emitted by the tracked Archify generator and marked not to be edited by hand. The remaining 304 files are the complete authored scope, including product source, tests, browser harnesses, configuration, and tracked Archify source.

Current traversal has several distinct shapes that must not be treated as interchangeable:

- result construction that declares an outer `let`, array, object, map, set, or other temporary and changes it from a loop or callback;
- `forEach` used only for explicit synchronous per-item actions where no equivalent bulk operation exists;
- an imperative loop whose observable behavior depends on irreducible `break`, `continue`, function early return, sequential `await`, or live collection membership;
- a condition-driven `while` or `do...while` whose termination is not collection exhaustion; and
- a synchronous owner operation whose single call inherently performs the item's only effect and returns a value used in the item's result, so separating the effect from result construction would change behavior; and
- a reduction that mutates only a fresh accumulator which is private to that reduction.

The desired style is the shortest behavior-equivalent expression with the fewest necessary variables. This is not a request to mechanically replace one syntax with another. In particular, changing an effectful `forEach` to `for...of` preserves the same external mutation while adding syntax, and changing a valid private reducer accumulator to repeated immutable cloning adds work and behavioral risk without removing an external side effect.

## Goals / Non-Goals

**Goals:**

- Express collection-derived results directly with the standard operation that names the intent.
- Eliminate avoidable outer mutable temporaries and single-use traversal scaffolding.
- Remove result-producing `forEach` and retain effect-only `forEach` only when it is the shortest synchronous form and no existing bulk operation is equivalent.
- Keep result-producing callbacks free of external mutation and external commits, while making synchronous and concurrent effect traversal explicit and fully consumed.
- Preserve a consumed direct `map` for an indivisible synchronous mixed effect-and-result owner operation without opening a general effectful-callback exception.
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
- `findIndex` for the index of the first matching value;
- `some` or `every` for a predicate with short-circuiting;
- `reduce` for a scalar, grouped, indexed, or otherwise accumulated result; and
- `Object.entries`, `Object.values`, `Object.keys`, `Object.fromEntries`, and existing collection constructors when they remove manual object traversal.

The chosen operation should be returned or assigned directly. Do not declare an outer mutable accumulator, mutate it during traversal, and read it afterward when a standard operation can produce the same value. Do not retain a one-use intermediate that merely forwards one collection result into the next operation when a direct expression is equally clear and behavior-equivalent.

"Shortest" means the most direct repository-formatted expression among behavior-equivalent implementations. It does not authorize minification, compressed names, duplicated work, eager materialization, changed iteration order, or a longer chain that conceals semantics.

Alternative rejected: use `forEach` with an outer `let`, array, object, map, set, assignment, or other accumulator to construct a result. It hides the actual result in external mutation and requires extra mutable state.

Alternative rejected: replace a result-producing or effect-only `forEach` mechanically with `for...of`. It does not achieve direct result production or fewer variables, can make an already minimal synchronous action longer, and all `for` variants are governed by the same exception rule.

### 2. Every `for` variant requires a behavior-equivalence exception

`for`, `for...of`, `for await...of`, and `for...in` are all `for` statements. Syntax or iterator type is never an exception by itself.

A `for` statement may remain only when no direct result operation, existing bulk operation, synchronous effect-only `forEach`, or concurrent `Promise.all(...map(...))` expression is behavior-equivalent because the actual traversal requires irreducible `break`, `continue`, function early return, sequential `await`, or live-collection membership behavior. Merely adding or retaining a control-flow keyword, using an asynchronous iterator, ordering effects, or lacking a convenient bulk API does not qualify when one of those shorter forms preserves the same behavior.

`while` and `do...while` may remain for condition-driven algorithms whose changing condition is the termination contract. They must not replace indexed or iterable collection traversal that a direct operation can express.

No comment, annotation, ownership label, or lint suppression can legalize a loop that does not meet these semantics. A valid remaining loop is justified by its code and behavior, not by a waiver string.

### 3. Result callbacks derive values and effect callbacks are explicit

A callback passed to `map`, `filter`, `flatMap`, `find`, `findIndex`, `some`, `every`, `reduce`, sorting, object-entry transformation, or another result-oriented collection method must derive its returned value without an external side effect.

External side effects include:

- assigning to or incrementing an outer binding;
- mutating an input value, closed-over object, shared collection, singleton, cache, or externally reachable owner;
- invoking DOM, browser, storage, database, wire, persistence, event-dispatch, timer, logging, or other I/O/effect APIs; and
- using a result-oriented method only as an iteration carrier while ignoring the created result.

There is one narrow synchronous result-producing exception. When no behavior-equivalent bulk operation exists, a `map` callback may return an item expression containing exactly one indivisible owner API call: the same invocation inherently performs the item's only external effect and returns a value that contributes to that item result, and splitting those responsibilities is not behavior-equivalent. The complete mapped result must be returned, assigned, or otherwise consumed. Every other subexpression in the returned item must be pure; the callback must not mutate an outer binding or accumulator, perform an additional effect, add separate traversal scaffolding, or discard the owner call's returned value. Callback arguments, evaluation and call order, multiplicity, synchronous error behavior, and returned-value ordering must remain unchanged. The `Session.ts` item object whose `armedId` field consumes `identity.nextId()` and `useShareRef` registration whose whole item is `setRef(ref, node)` satisfy this boundary; they are examples of the general owner-operation rule, not file-level waivers.

There are two explicit effect-only callback forms:

- Synchronous per-item actions use `forEach` when no existing bulk operation is behavior-equivalent and `forEach` is the shortest equivalent expression. The traversal must not construct a result or update an outer accumulator that is read as its result, and it must not start asynchronous work whose Promise is discarded. Existing call order, multiplicity, synchronous error behavior, membership semantics, and externally visible effects remain unchanged.
- Concurrent per-item actions use one `Promise.all(items.map(...))` expression when each `map` callback directly returns the operation Promise and the complete mapped result is immediately consumed by the returned or awaited `Promise.all`. The rewrite must preserve the existing concurrency, result ordering, and rejection behavior.

Use an existing bulk operation instead when one is behavior-equivalent. Do not move repeated effects into a result-producing callback, an ignored-result method, or a forbidden loop statement. The original one-line `src/utils/storage.test-utils.ts` clear operation using `Object.keys(storage).forEach((key) => delete ...)` is already the shortest synchronous effect-only form and remains unchanged.

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
- **A result-oriented method hides an external effect** -> Reject the rewrite unless it satisfies the narrow consumed synchronous mixed effect-and-result item boundary or is the complete `map` input to a returned or awaited `Promise.all`; otherwise use an equivalent bulk operation or explicit synchronous effect-only `forEach`.
- **A synchronous owner API cannot separate its effect from its returned result** -> Permit only a consumed `map` whose returned item expression contains exactly one such owner call, uses its returned value in that item, and keeps every other subexpression pure, with no outer mutation or second effect; reject broader effectful result callbacks.
- **An effect-only `forEach` constructs a hidden result or drops Promises** -> Replace result construction with the direct result method, or consume concurrent operation Promises with one `Promise.all`.
- **A loop contains a nominal control keyword but has a direct equivalent** -> Use the direct short-circuiting method; the keyword alone is not an exception.
- **A loop is retained for sequential or live behavior that a shorter form changes** -> Keep it only after confirming `forEach`, `Promise.all`, direct result methods, and existing bulk operations are not equivalent.
- **A local reducer mutation is mistaken for an external side effect** -> Apply the fresh, exclusive, non-escaping test; keep `assembleURL` unchanged.
- **Generated code dominates structural scans** -> Exclude only the exact generated validator path and keep its generator in scope.
- **Existing Oxlint cannot encode the semantic rule** -> Use its existing built-in coverage where exact, then rely on source review rather than adding another parser or linter.
- **Existing test edits accidentally change evidence** -> Limit edits to behavior-equivalent iteration or private-state ownership and reject any new or changed scenario, assertion, fixture contract, helper abstraction, timing, or coverage behavior.

## Migration Plan

1. Freeze this docs-only authority as one sole child of clean `develop@10801251a7a6b744fd246960daed01eef323c868`, validate it, and obtain fresh independent docs review.
2. From the reviewed authority exact, record the 304-file authored manifest and a read-only baseline inventory of traversal forms before editing product source.
3. Produce one source child that applies the direct-result rule, narrow indivisible mixed effect-and-result `map` boundary, explicit synchronous and concurrent action forms, result-callback external-effect boundary, valid `for` exceptions, generated exclusion, and no-test policy without adding an enforcement layer.
4. Verify the exact source diff with existing format, lint, typecheck, test, build, generated-artifact, OpenSpec, and repository-cleanliness gates; confirm the original `assembleURL` implementation is unchanged.
5. Obtain fresh independent source review of the immutable exact without the reviewer running local tests or automation. Keep both pull requests Draft and do not mark Ready, merge, run browser acceptance, deploy, release, or change production without separate Owner authority.

Rollback is source-only: revert the behavior-neutral cleanup and any built-in Oxlint configuration change. There is no protocol, schema, persistence, data, or deployment migration.
