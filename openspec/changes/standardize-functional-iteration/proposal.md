## Why

WebChat contains collection traversal written as loop statements or `forEach` callbacks that update temporary variables outside the traversal. Those forms separate the computation from its result, introduce avoidable mutable state, and make a simple mapping, filter, lookup, predicate, or reduction longer than the equivalent standard collection expression.

The repository needs one behavior-neutral iteration standard: use the shortest direct expression with the fewest necessary variables, and keep imperative traversal only when its control flow cannot be represented equivalently by an existing collection method. Functional callbacks must derive values rather than hide writes to state outside the callback.

## What Changes

- Make direct result-producing collection methods the default for every manually maintained tracked JavaScript and TypeScript file. A mapping, filter, lookup, predicate, flattening, grouping, or accumulation returns or assigns the method result directly instead of declaring an outer mutable temporary and changing it during traversal.
- Remove `forEach` from the authored source set. It must not be replaced mechanically with another loop statement or with a value-producing method whose result is ignored.
- Treat `for`, `for...of`, `for await...of`, and `for...in` as the same class of `for` statement. One may remain only when genuine `break`, `continue`, or function early-return behavior cannot be expressed equivalently by `find`, `some`, `every`, or another direct operation.
- Keep condition-driven `while` and `do...while` only when their changing termination condition is the behavior being modeled, not as another spelling of collection traversal.
- Prohibit functional callbacks from performing external side effects: they do not mutate inputs, outer bindings, shared or externally reachable objects, or perform I/O, DOM, storage, event, wire, persistence, or other external commits.
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
