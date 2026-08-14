## Context

The clean `develop` tree tracks 305 files with JavaScript or TypeScript extensions. Exactly one is explicitly generated: `.agents/skills/archify/renderers/shared/generated-validators.mjs`, emitted by the tracked Archify generator and marked not to be edited by hand. The remaining 304 files are the complete authored scope, including product source, tests, browser harnesses, configuration, and tracked Archify source.

Current traversal has several distinct shapes that must not be treated as interchangeable:

- result construction that declares an outer `let`, array, object, map, set, or other temporary and changes it from a loop or callback;
- `forEach` used only for explicit synchronous per-item actions where no equivalent bulk operation exists;
- an imperative loop whose observable behavior depends on irreducible `break`, `continue`, function early return, sequential `await`, or live collection membership;
- a condition-driven `while` or `do...while` whose termination is not collection exhaustion;
- a synchronous owner operation whose single call inherently performs the item's only effect and returns a value used in the item's result, so separating the effect from result construction would change behavior; and
- a reduction that mutates only a fresh accumulator which is private to that reduction.

The desired style is the shortest behavior-equivalent expression with the fewest necessary variables. This is not a request to mechanically replace one syntax with another. In particular, changing an effectful `forEach` to `for...of` preserves the same external mutation while adding syntax, and changing a valid private reducer accumulator to repeated immutable cloning adds work and behavioral risk without removing an external side effect.

The Artico send path exposes a separate owner-approved correction discovered during this cleanup. `Room.send` already accepts `target?: string | string[]`, but WebChat currently expands an omitted target into its join-to-leave `readyPeers` membership and sends once per peer. That set is not a data-channel readiness filter. The pinned provider also stops its room traversal when one stale or closing call throws, so merely delegating broadcast or array delivery to that version would starve later peers. At the protocol layer, ordinary Chat and normal Session/World publications are room broadcasts, while the History requester currently repeats a logically room-wide request per peer. These behaviors require one closed transport and History repair rather than another callback carrier.

## Goals / Non-Goals

**Goals:**

- Express collection-derived results directly with the standard operation that names the intent.
- Eliminate avoidable outer mutable temporaries and single-use traversal scaffolding.
- Remove result-producing `forEach` and retain effect-only `forEach` only when it is the shortest synchronous form and no existing bulk operation is equivalent.
- Keep result-producing callbacks free of external mutation and external commits, while making synchronous and concurrent effect traversal explicit and fully consumed.
- Preserve a consumed direct `map` for an indivisible synchronous mixed effect-and-result owner operation without opening a general effectful-callback exception.
- Preserve valid local mutation of a fresh, exclusive, non-escaping reducer accumulator.
- Delegate each Artico send once with its original optional target intent, after consuming a provider version whose broadcast and selected-array paths continue after a stale or closing peer failure.
- Broadcast ordinary Chat, normal Session/World publications, and one History request without manufacturing recipient targets; keep Session/World current-state catch-up and History responses targeted.
- Merge every valid History response under one correlated multi-provider request regardless of arrival time, and close loading on full settlement or the existing ten-second deadline without stopping that merge.
- Preserve exact behavior outside those Owner-approved transport and History corrections while applying the same iteration rule to production, test, harness, configuration, and tracked tool source.
- Verify the result with only existing repository tools and independent source review.

**Non-Goals:**

- No product feature, protocol, persistence, DOM, storage, wire-payload, or public-interface change beyond the closed Artico delegation and History request/settlement corrections below.
- No source minification or preference for fewer characters when it obscures intent or changes evaluation.
- No custom Oxlint plugin, local plugin, parser, second linter, new package, committed scan script, generated rule table, or semantic-analysis module. The only dependency change permitted is the minimum published `@rtco/client` version update that supplies the required room-send behavior, plus its lockfile resolution.
- No `owner-commit`, `functional-loop`, lint-disable, or other annotation that turns a nonconforming loop or callback into an exception.
- No new test case, parameter row, assertion, fixture, mock capability, test helper abstraction, or coverage requirement. Existing expectations may receive only the minimum synchronization required by the explicitly changed transport and History behavior.
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

### 4. Message intent controls Artico targeting and History settlement

`RoomTransport.send(roomId, payload, to?: string | string[])` keeps its optional target type. After confirming the room exists, the adapter calls `room.send(payload, to)` exactly once. It does not create a target set, read or filter `readyPeers`, loop over recipients, catch per-recipient errors, or aggregate a first error locally.

Target meaning is closed:

- `to === undefined` is one room broadcast. Ordinary Chat messages, normal Session publications, normal World publications, and History requests use this form and do not enumerate room peers first.
- `to: string` addresses one peer. History responses use the actual requester's peer id. Session/World current-state catch-up for a peer that joined or reconnected after the original publication remains targeted to that peer.
- `to: string[]` addresses one already selected subset without changing the meaning to broadcast; duplicates do not create duplicate delivery attempts for the same room peer.
- `to: []` is an explicit no-op and never falls back to broadcast.

The adapter may expose provider room membership where another owner genuinely needs a snapshot, but it must not maintain a parallel join-to-leave set or use membership to rewrite send intent. In particular, the History requester snapshots current room members only as its expected settlement set. That snapshot is not passed as the send target.

One History synchronization allocates one request identity and broadcasts each paginated inventory-request page exactly once without a target. Every peer in the request-start membership snapshot may provide a targeted response. Response page order and bounds are validated independently by `(syncId, sourcePeerId)`, while completion, failure, and departure settle that provider only for loading. One provider's invalid page, failure, or departure must not cancel another provider or erase otherwise valid History received later. Every response page associated with the known request identity and accepted by the existing pagination validation is retained and merged through the existing message-identity deduplication regardless of arrival time, loading visibility, provider connectivity, or room generation changes. `syncId` and `sourcePeerId` only correlate and validate pages; elapsed time and generation changes do not discard an otherwise valid page.

The History loading owner remains manually dismissible. Manual dismissal changes only the UI and does not cancel response collection. Otherwise loading closes when either every snapshotted provider has completed, failed, or left, or the existing absolute `HISTORY_REQUEST_TIMEOUT_MS` ten-second deadline from request start expires. This is the semantic equivalent of racing `Promise.allSettled(providerHistories)` against the timeout for the loading owner only, not awaiting the timeout inside `Promise.all` and not cancelling the losing provider work. Loading closure, timeout, provider failure or departure, and room generation changes must not cause an otherwise valid associated History page to be discarded; whenever such a page arrives, its valid records continue through deduplication and merge.

Direct delegation is gated on a published Artico client whose `Room.send` broadcast and selected-array paths attempt every eligible room call once in provider order even when an earlier stale or closing call throws. After all eligible calls have been attempted, the provider rethrows the first synchronous error thrown by an eligible room call unchanged; it returns normally only when no eligible room call threw. WebChat must not recreate this behavior with a local loop, `readyPeers` filter, reducer, first-error accumulator, wrapper, or provider patch. A source child cannot complete against the current fail-fast `@rtco/client@0.3.6` implementation.

### 5. The migration is one authored-source pass with two closed behavior corrections

The implementation manifest is fixed from clean `develop`: all tracked `*.js`, `*.jsx`, `*.ts`, `*.tsx`, `*.mjs`, and `*.cjs` files, minus only `.agents/skills/archify/renderers/shared/generated-validators.mjs`. The manifest contains exactly 304 authored files. Ignore patterns used by formatter or linter configuration do not remove a tracked authored file from this cleanup.

The generated validator remains byte-identical and is verified through its existing generator controls. Its generator is authored source and remains in scope. No other file may claim generated, vendored, test, fixture, harness, configuration, or tool status as an exclusion.

Except for the target delegation, broadcast classification, provider failure isolation, and bounded multi-provider History settlement defined above, every rewrite must preserve evaluation order, iteration order, call count, synchronous or asynchronous settlement, concurrency, return values, thrown and rejected errors, object identity, mutation visibility, event order, timers, storage and database operations, network/wire behavior, DOM behavior, and generated output. A shorter expression is acceptable only when it is behavior-equivalent.

Existing tests, fixtures, and harnesses may receive only the minimum behavior-equivalent iteration or private-state ownership edits necessary to satisfy the same authored-source rule, plus minimum expectation synchronization for the closed transport and History corrections. An existing private fixture owner may replace its complete internal state once when that removes repeated external mutation, but its exposed object and behavior must remain equivalent. Test names, scenarios, inputs, timing, mocks, public fixture contracts, and coverage remain unchanged; no new test, fixture, or test abstraction is part of this cleanup.

### 6. Existing tooling provides the complete implementation surface

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
- **An omitted target is expanded back into WebChat recipients** -> Require one `room.send(payload, undefined)` call for broadcasts and keep membership snapshots separate from send intent.
- **A stale Artico call starves later room peers** -> Consume a published provider fix that attempts later peers and then rethrows the first room-call error unchanged; do not restore a WebChat target loop or error accumulator.
- **A broadcast History request keeps loading open forever or loses later history** -> Race full provider settlement against the existing ten-second deadline for the loading UI only, while every valid associated page continues to merge regardless of arrival time, provider connectivity, or room generation.
- **A new peer misses current Session/World state** -> Preserve the targeted current-state catch-up; do not convert it into a duplicate room broadcast.
- **Generated code dominates structural scans** -> Exclude only the exact generated validator path and keep its generator in scope.
- **Existing Oxlint cannot encode the semantic rule** -> Use its existing built-in coverage where exact, then rely on source review rather than adding another parser or linter.
- **Existing test edits accidentally change evidence** -> Limit iteration edits to behavior-equivalent code and closed transport/History edits to minimum existing-expectation synchronization; reject any new scenario, assertion, fixture contract, helper abstraction, timing, or coverage behavior.

## Migration Plan

1. Freeze this docs-only authority as one sole child of clean `develop@10801251a7a6b744fd246960daed01eef323c868`, validate it, and obtain fresh independent docs review.
2. Repair and release Artico's room broadcast/array failure isolation with attempt-all and unchanged first-room-call-error propagation, then pin the exact published client version as the source child's prerequisite; do not patch or fork the provider inside WebChat.
3. From the reviewed authority exact, record the 304-file authored manifest and a read-only baseline inventory of traversal and send forms before editing product source.
4. Produce one WebChat source child that applies the functional-iteration standard, direct optional-target delegation, intent-based broadcast/target classification, bounded multi-provider History synchronization, generated exclusion, and no-new-test policy without adding an enforcement layer.
5. Verify the exact source diff with existing format, lint, typecheck, test, build, generated-artifact, OpenSpec, and repository-cleanliness gates; confirm the original `assembleURL` implementation is unchanged and the fixed Artico version is resolved.
6. Obtain fresh independent source review of the immutable exact without the reviewer running local tests or automation. Keep both pull requests Draft and do not mark Ready, merge, run browser acceptance, deploy, release, or change production without separate Owner authority.

Rollback is source-only: revert the cleanup, the closed transport/History correction, the Artico version update, and any built-in Oxlint configuration change. There is no schema, persistence, data, or deployment migration.
