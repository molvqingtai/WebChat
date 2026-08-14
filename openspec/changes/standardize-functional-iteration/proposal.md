## Why

WebChat contains collection traversal written as loop statements or `forEach` callbacks that update temporary variables outside the traversal. Those forms separate the computation from its result, introduce avoidable mutable state, and make a simple mapping, filter, lookup, predicate, or reduction longer than the equivalent standard collection expression.

The repository needs one behavior-neutral iteration standard: use the shortest direct expression with the fewest necessary variables, and keep imperative traversal only when its behavior cannot be represented equivalently by an existing collection or action form. Result-producing callbacks must derive values rather than hide writes to state outside the callback, while explicit effect-only traversal must remain recognizable and fully consumed.

The audit also exposed one transport boundary that cannot be solved by another local callback carrier. WebChat currently expands an omitted Artico target into a join-to-leave peer set and sends per peer. Normal Chat/Session/World publication and History request intent is room-wide, so recipient manufacture and per-peer History request fan-out must be replaced by direct provider semantics plus a bounded all-provider History settlement.

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
- Treat each delegated `room.send` as successful for this correction. Keep the current Artico dependency and lock resolution unchanged, and add no send-failure handling.
- Snapshot room membership only to settle History loading, not to form send targets. Associate and validate provider responses independently by `(syncId, sourcePeerId)`, then merge every valid record by existing message identity regardless of arrival time, loading visibility, provider connectivity, or room generation; one provider failure or departure does not cancel another or discard later valid History.
- Keep History loading manually dismissible and otherwise close it on full provider settlement or the existing absolute ten-second timeout, whichever occurs first. Manual dismissal and timeout affect only loading: they neither cancel response collection nor prevent a later valid associated page from merging.
- Mechanically replace the exact-History candidate window from 180 days to 30 days in exactly `src/constants/config.ts`, `CLAUDE.md`, `openspec/changes/sync-exact-history-and-show-progress/design.md`, `openspec/changes/sync-exact-history-and-show-progress/specs/webrtc-runtime/spec.md`, `openspec/changes/sync-exact-history-and-show-progress/tasks.md`, and `openspec/specs/webrtc-runtime/spec.md`. This six-file `+15/-15` subchange updates only the constant and matching active/canonical wording; it leaves archives untouched and preserves cutoff ownership, inclusive boundaries, pagination, protocols, storage, and every other History behavior.
- Carry this reviewed proposal, design, and delta specification into the unified source child without reverting to an earlier behavior-neutral contract. Carry the same task rows and wording, changing only checkbox markers whose complete clauses are proven true on that immutable source exact. A failed or superseded source candidate supplies no completion evidence to a repair child; any row contradicted by source inspection or fresh review remains unchecked.
- Apply the cleanup to the exact 304 authored files in the clean `develop` manifest: all 305 tracked `*.js`, `*.jsx`, `*.ts`, `*.tsx`, `*.mjs`, and `*.cjs` files except the generated `.agents/skills/archify/renderers/shared/generated-validators.mjs` artifact.
- Use only the repository's existing Oxfmt, Oxlint, TypeScript, test, and build surfaces. Add no Oxlint plugin, parser, linter, new package, custom semantic scanner, waiver convention, or dependency change.
- Add no test case, assertion, test abstraction, fixture, or source-only enforcement module. Existing tests, fixtures, and harnesses remain in scope for the minimum behavior-equivalent edits and expectation synchronization required by the closed transport/History corrections, with their public contracts, scenarios, timing, ordering, and coverage unchanged.
- Preserve all product and tooling behavior outside the explicitly changed Artico delegation, History settlement, and exact six-file 30-day candidate-window replacement, including evaluation order, multiplicity, synchronous versus concurrent execution, return and error behavior, object identity, mutation ownership, protocols and wire payloads, storage, DOM behavior, generated output, and public interfaces.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `source-quality-tooling`: Establish the repository-wide functional-iteration standard and its existing-toolchain verification boundary.

## Impact

- Affected source: the 304 manually maintained tracked JavaScript and TypeScript files fixed by the clean `develop` manifest.
- Excluded source: only the exact generated Archify validator artifact; its generator and every other tracked JavaScript or TypeScript file remain in authored scope.
- Affected configuration: the existing Oxlint configuration may enable an already installed built-in rule where it exactly represents part of the standard, but no new plugin, parser, linter, dependency, or executable enforcement layer may be introduced.
- Affected runtime: Artico send delegation and target selection; normal Chat/Session/World publication; History request fan-out, provider settlement, loading timeout, and requester/provider candidate window from 180 days to 30 days.
- Affected retention-window files: exactly `src/constants/config.ts`, `CLAUDE.md`, `openspec/changes/sync-exact-history-and-show-progress/design.md`, `openspec/changes/sync-exact-history-and-show-progress/specs/webrtc-runtime/spec.md`, `openspec/changes/sync-exact-history-and-show-progress/tasks.md`, and `openspec/specs/webrtc-runtime/spec.md`; no archive or test file.
- Affected dependency: none; the existing `@rtco/client` version and lock resolution remain unchanged.
- Affected tests: only the minimum behavior-equivalent edits and expectation synchronization inside existing files; no new scenario, assertion, fixture, helper abstraction, or coverage expansion.
- Affected authority transfer: the source child carries the reviewed proposal, design, and specification text plus the identical task-row set; source and review rows remain incomplete until every clause is true on the current immutable exact and fresh review supplies its own evidence.
- Unchanged: History cutoff ownership and inclusive boundary behavior, pagination, wire payload shapes, persistence, extension permissions, generated artifacts, archived documentation, public interfaces, and release/deployment topology.
