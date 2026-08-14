## Why

WebChat contains collection traversal written as loop statements or `forEach` callbacks that update temporary variables outside the traversal. Those forms separate the computation from its result, introduce avoidable mutable state, and make a simple mapping, filter, lookup, predicate, or reduction longer than the equivalent standard collection expression.

The repository needs one behavior-neutral iteration standard: use the shortest direct expression with the fewest necessary variables, and keep imperative traversal only when its behavior cannot be represented equivalently by an existing collection or action form. Result-producing callbacks must derive values rather than hide writes to state outside the callback, while explicit effect-only traversal must remain recognizable and fully consumed.

The audit also exposed one transport boundary that cannot be solved by another local callback carrier. WebChat currently expands an omitted Artico target into a join-to-leave peer set and sends per peer, while the pinned provider aborts a broadcast or selected-array send when one stale or closing call throws. Normal Chat/Session/World publication and History request intent is room-wide, so recipient manufacture and per-peer History request fan-out must be replaced by direct provider semantics plus a bounded all-provider History settlement.

## What Changes

- Make direct result-producing collection methods the default for every manually maintained tracked JavaScript and TypeScript file. A mapping, filter, lookup (`find` or `findIndex`), predicate, flattening, grouping, or accumulation returns or assigns the method result directly instead of declaring an outer mutable temporary and changing it during traversal.
- Keep `forEach` only as the shortest explicit form for synchronous per-item actions when no existing bulk operation is behavior-equivalent. It must not construct a result, update an outer traversal accumulator, launch unconsumed asynchronous work, or be replaced mechanically with a longer loop statement.
- Express concurrent per-item actions as one fully consumed `Promise.all(items.map(...))` operation only when each callback directly returns its operation Promise and the form preserves the existing concurrency and rejection behavior.
- Allow a consumed `map` result for a synchronous owner API when no behavior-equivalent bulk operation exists and the API cannot be split behavior-equivalently into a pure result computation and a separate action because that single call inherently performs the item's only effect and returns a value used in the item result. Each callback's returned item expression contains exactly one such owner call; every other subexpression is pure, and the callback does not mutate an outer value or perform a second effect.
- Treat `for`, `for...of`, `for await...of`, and `for...in` as the same class of `for` statement. One may remain only when no direct result operation, bulk operation, synchronous `forEach`, or concurrent `Promise.all` form is behavior-equivalent because the traversal requires irreducible `break`, `continue`, function early-return, sequential-`await`, or live-collection behavior.
- Keep condition-driven `while` and `do...while` only when their changing termination condition is the behavior being modeled, not as another spelling of collection traversal.
- Prohibit result-producing callbacks from performing external side effects: they do not mutate inputs, outer bindings, shared or externally reachable objects, or perform I/O, DOM, storage, event, wire, persistence, or other external commits. The sole result-producing exception is the consumed synchronous `map` form above for one indivisible mixed effect-and-result owner call; explicit synchronous `forEach` and fully consumed concurrent `Promise.all(...map(...))` remain the effect-only forms.
- Allow a reducer to mutate an accumulator that is created for that invocation, exclusively owned by the reduction, and unable to escape while reduction is in progress. The existing `assembleURL` reduction over `new URL(url)` is valid and remains unchanged.
- Preserve `RoomTransport.send(..., to?: string | string[])` and delegate once with `room.send(payload, to)`: `undefined` broadcasts, `string` targets one peer, `string[]` targets one selected subset, and `[]` is a no-op. The adapter does not create/filter recipients or aggregate per-peer errors.
- Use no target for ordinary Chat, normal Session/World publication, and each paginated inventory-request page under one room-wide History request identity. Keep Session/World current-state catch-up targeted to its new or reconnected peer, and keep each History response targeted to its actual requester.
- Require a published Artico client whose broadcast and selected-array paths continue later peer attempts after a stale or closing call fails, then rethrow the first synchronous error thrown by an eligible room call unchanged; update only that existing dependency and lockfile, with no WebChat-local provider patch, loop, reducer, or first-error carrier.
- Treat that fixed provider's rejection after it has attempted all eligible room calls for a History inventory page as post-attempt: report it through the existing error contract, but do not cancel the request identity, response collection, or any provider lane on that basis. Do not retry the attempted page; continue broadcasting each later inventory page exactly once. Only a preflight or codec failure before provider delivery begins may terminate the request.
- Snapshot room membership only to settle History loading, not to form send targets. Associate and validate provider responses independently by `(syncId, sourcePeerId)`, then merge every valid record by existing message identity regardless of arrival time, loading visibility, provider connectivity, or room generation; one provider failure or departure does not cancel another or discard later valid History.
- Keep History loading manually dismissible and otherwise close it on full provider settlement or the existing absolute ten-second timeout, whichever occurs first. Manual dismissal and timeout affect only loading: they neither cancel response collection nor prevent a later valid associated page from merging.
- Apply the cleanup to the exact 304 authored files in the clean `develop` manifest: all 305 tracked `*.js`, `*.jsx`, `*.ts`, `*.tsx`, `*.mjs`, and `*.cjs` files except the generated `.agents/skills/archify/renderers/shared/generated-validators.mjs` artifact.
- Use only the repository's existing Oxfmt, Oxlint, TypeScript, test, and build surfaces. Add no Oxlint plugin, parser, linter, new package, custom semantic scanner, or waiver convention; only the required published `@rtco/client` version and lock resolution may change.
- Add no test case, assertion, test abstraction, fixture, or source-only enforcement module. Existing tests, fixtures, and harnesses remain in scope for the minimum behavior-equivalent edits and expectation synchronization required by the closed transport/History corrections, with their public contracts, scenarios, timing, ordering, and coverage unchanged.
- Preserve all product and tooling behavior outside the explicitly changed Artico delegation and History settlement, including evaluation order, multiplicity, synchronous versus concurrent execution, return and error behavior, object identity, mutation ownership, protocols and wire payloads, storage, DOM behavior, generated output, and public interfaces.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `source-quality-tooling`: Establish the repository-wide functional-iteration standard and its existing-toolchain verification boundary.

## Impact

- Affected source: the 304 manually maintained tracked JavaScript and TypeScript files fixed by the clean `develop` manifest.
- Excluded source: only the exact generated Archify validator artifact; its generator and every other tracked JavaScript or TypeScript file remain in authored scope.
- Affected configuration: the existing Oxlint configuration may enable an already installed built-in rule where it exactly represents part of the standard, but no new plugin, parser, linter, dependency, or executable enforcement layer may be introduced.
- Affected runtime: Artico send delegation and target selection; normal Chat/Session/World publication; History request fan-out, provider settlement, and loading timeout.
- Affected dependency: the existing `@rtco/client` version and lock resolution only, after a published provider fix; no new package or in-repository patch.
- Affected tests: only the minimum behavior-equivalent edits and expectation synchronization inside existing files; no new scenario, assertion, fixture, helper abstraction, or coverage expansion.
- Unchanged: wire payload shapes, persistence, extension permissions, generated artifacts, public interfaces, and release/deployment topology.
