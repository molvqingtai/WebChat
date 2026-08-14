## Why

WebChat contains collection traversal written as loop statements or `forEach` callbacks that update temporary variables outside the traversal. Those forms separate the computation from its result, introduce avoidable mutable state, and make a simple mapping, filter, lookup, predicate, or reduction longer than the equivalent standard collection expression.

The repository needs one behavior-neutral iteration standard: use the shortest direct expression with the fewest necessary variables, and keep imperative traversal only when its behavior cannot be represented equivalently by an existing collection or action form. Result-producing callbacks must derive values rather than hide writes to state outside the callback, while explicit effect-only traversal must remain recognizable and fully consumed.

## What Changes

- Make direct result-producing collection methods the default for every manually maintained tracked JavaScript and TypeScript file. A mapping, filter, lookup (`find` or `findIndex`), predicate, flattening, grouping, or accumulation returns or assigns the method result directly instead of declaring an outer mutable temporary and changing it during traversal.
- Keep `forEach` only as the shortest explicit form for synchronous per-item actions when no existing bulk operation is behavior-equivalent. It must not construct a result, update an outer traversal accumulator, launch unconsumed asynchronous work, or be replaced mechanically with a longer loop statement.
- Express concurrent per-item actions as one fully consumed `Promise.all(items.map(...))` operation only when each callback directly returns its operation Promise and the form preserves the existing concurrency and rejection behavior.
- Allow a consumed `map` result for a synchronous owner API when no behavior-equivalent bulk operation exists and the API cannot be split behavior-equivalently into a pure result computation and a separate action because that single call inherently performs the item's only effect and returns a value used in the item result. Each callback's returned item expression contains exactly one such owner call; every other subexpression is pure, and the callback does not mutate an outer value or perform a second effect.
- Treat `for`, `for...of`, `for await...of`, and `for...in` as the same class of `for` statement. One may remain only when no direct result operation, bulk operation, synchronous `forEach`, or concurrent `Promise.all` form is behavior-equivalent because the traversal requires irreducible `break`, `continue`, function early-return, sequential-`await`, or live-collection behavior.
- Keep condition-driven `while` and `do...while` only when their changing termination condition is the behavior being modeled, not as another spelling of collection traversal.
- Prohibit result-producing callbacks from performing external side effects: they do not mutate inputs, outer bindings, shared or externally reachable objects, or perform I/O, DOM, storage, event, wire, persistence, or other external commits. The sole result-producing exception is the consumed synchronous `map` form above for one indivisible mixed effect-and-result owner call; explicit synchronous `forEach` and fully consumed concurrent `Promise.all(...map(...))` remain the effect-only forms.
- Allow a reducer to mutate an accumulator that is created for that invocation, exclusively owned by the reduction, and unable to escape while reduction is in progress. The existing `assembleURL` reduction over `new URL(url)` is valid and remains unchanged.
- Apply the cleanup to the exact 304 authored files in the clean `develop` manifest: all 305 tracked `*.js`, `*.jsx`, `*.ts`, `*.tsx`, `*.mjs`, and `*.cjs` files except the generated `.agents/skills/archify/renderers/shared/generated-validators.mjs` artifact.
- Use only the repository's existing Oxfmt, Oxlint, TypeScript, test, and build surfaces. Add no Oxlint plugin, parser, linter, dependency, custom semantic scanner, or waiver convention.
- Add no test case, test abstraction, fixture, or source-only enforcement module. Existing tests, fixtures, and harnesses remain in scope for the minimum behavior-equivalent iteration or private-state ownership edits needed by the same standard, with their public contracts, scenarios, assertions, timing, ordering, and coverage unchanged.
- Preserve all product and tooling behavior, including evaluation order, multiplicity, synchronous versus concurrent execution, return and error behavior, object identity, mutation ownership, protocols, storage, wire traffic, DOM behavior, generated output, and public interfaces.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `source-quality-tooling`: Establish the repository-wide functional-iteration standard and its existing-toolchain verification boundary.

## Impact

- Affected source: the 304 manually maintained tracked JavaScript and TypeScript files fixed by the clean `develop` manifest.
- Excluded source: only the exact generated Archify validator artifact; its generator and every other tracked JavaScript or TypeScript file remain in authored scope.
- Affected configuration: the existing Oxlint configuration may enable an already installed built-in rule where it exactly represents part of the standard, but no new plugin, parser, linter, dependency, or executable enforcement layer may be introduced.
- Affected tests: only the minimum behavior-equivalent iteration or private-state ownership edits inside existing files; no new scenario, assertion, fixture, helper abstraction, or coverage expansion.
- Unchanged: runtime behavior, user-visible behavior, protocols, persistence, extension permissions, dependency graph, generated artifacts, and release/deployment topology.
