## ADDED Requirements

### Requirement: Authored iteration expresses results directly with minimal state

Every manually maintained tracked JavaScript and TypeScript file SHALL express collection traversal with the shortest behavior-equivalent standard operation and the fewest necessary variables. A traversal that maps, filters, flattens, finds a value with `find`, finds an index with `findIndex`, tests, groups, indexes, or accumulates a result SHALL return or assign that direct result instead of declaring an outer mutable temporary and updating it during traversal.

The clean authority base contains 305 tracked files matching `*.js`, `*.jsx`, `*.ts`, `*.tsx`, `*.mjs`, or `*.cjs`. Exactly `.agents/skills/archify/renderers/shared/generated-validators.mjs` SHALL be excluded because it is generated and marked not to be edited by hand; the other 304 files SHALL comprise the complete authored scope. Tests, fixtures, harnesses, configuration, tracked tools, formatter/linter ignore patterns, and the generated validator's source generator SHALL NOT create additional exclusions.

Authored source SHALL use `forEach` only as the shortest behavior-equivalent form for explicit synchronous per-item actions when no existing bulk operation is equivalent. Such a traversal SHALL NOT construct a result, update an outer traversal accumulator that is read as its result, start asynchronous work whose Promise is discarded, or be replaced mechanically with a longer loop. Result-producing traversal SHALL use and consume its direct result instead.

`for`, `for...of`, `for await...of`, and `for...in` SHALL all be treated as `for` statements. A `for` statement MAY remain only when no direct result operation, existing bulk operation, synchronous `forEach`, or concurrent `Promise.all(...map(...))` expression is behavior-equivalent because the traversal requires irreducible `break`, `continue`, function early return, sequential `await`, or live-collection membership behavior. Syntax variant, iterator type, a control-flow keyword, ordered effects, or lack of a convenient bulk API SHALL NOT by itself permit a `for` statement when a shorter form remains equivalent.

A condition-driven `while` or `do...while` MAY remain only when its changing termination condition is the behavior being modeled. It SHALL NOT be used as an alternate spelling of indexed or iterable collection traversal.

#### Scenario: Replace an outer temporary accumulator

- **GIVEN** authored code declares a mutable value before traversal, changes it for each item, and reads it as the traversal result
- **WHEN** an equivalent reduction can produce that value
- **THEN** the code SHALL assign or return the `reduce` result directly with no outer mutable accumulator

#### Scenario: Return a direct collection transformation

- **GIVEN** authored code builds a mapped, filtered, flattened, grouped, indexed, `find`/`findIndex` matching, or predicate result through manual traversal
- **WHEN** a standard collection or object-entry operation expresses the same order, multiplicity, and return behavior
- **THEN** the code SHALL use and directly return or assign that operation without avoidable intermediate traversal variables

#### Scenario: Replace a result-producing forEach without a mechanical loop rewrite

- **GIVEN** a `forEach` callback updates an outer accumulator to construct a traversal result
- **WHEN** the iteration is standardized
- **THEN** it SHALL become the direct consumed result operation and SHALL NOT become `for...of`, another `for` variant, or an ignored-result `map` or `reduce`

#### Scenario: Preserve the shortest synchronous per-item action

- **GIVEN** a `forEach` performs only explicit synchronous per-item actions, constructs no traversal result, updates no outer result accumulator, discards no Promise, and has no behavior-equivalent bulk operation
- **WHEN** `forEach` is the shortest behavior-equivalent expression
- **THEN** it SHALL remain, including the original one-line `src/utils/storage.test-utils.ts` storage clear, and SHALL NOT be expanded into a `for` statement

#### Scenario: Preserve only behaviorally irreducible for traversal

- **GIVEN** a `for` statement uses irreducible control flow or must preserve sequential-`await` or live-collection behavior
- **WHEN** no direct result operation, existing bulk operation, synchronous `forEach`, or concurrent `Promise.all` expression preserves its observable behavior
- **THEN** that loop MAY remain without a waiver annotation

#### Scenario: A for syntax variant does not create an exception

- **GIVEN** authored traversal uses `for...of`, `for await...of`, or `for...in` without irreducible control flow, sequential-`await`, or live-collection behavior
- **WHEN** the final source is inspected
- **THEN** the traversal SHALL be replaced by a direct behavior-equivalent operation just like an ordinary `for` statement

#### Scenario: Preserve condition-driven iteration

- **GIVEN** a `while` or `do...while` models termination from a changing condition rather than collection exhaustion
- **WHEN** no direct collection expression preserves that condition-driven behavior
- **THEN** the loop MAY remain, while collection-style uses SHALL be replaced

### Requirement: Result callbacks avoid external effects and action callbacks are explicit

A callback passed to a result-oriented collection or object-entry operation SHALL derive and return its result without mutating an input, outer binding, shared collection, singleton, cache, or other externally reachable object. It SHALL NOT perform DOM, browser, storage, database, wire, persistence, event-dispatch, timer, logging, or other I/O or external commit behavior. A result-oriented method SHALL NOT be used only as a carrier for ignored callback effects.

As the sole synchronous result-producing exception, a `map` callback MAY return an item expression containing exactly one owner API call when no behavior-equivalent bulk operation exists, the same indivisible invocation inherently performs the item's only external effect and returns a value used in that item result, and separating those responsibilities is not behavior-equivalent. The complete mapped result SHALL be returned, assigned, or otherwise consumed. Every other subexpression in the returned item SHALL be pure. The callback SHALL NOT mutate an outer binding or accumulator, perform an additional effect, add separate traversal scaffolding, or discard the owner call's returned value. Callback arguments, evaluation and call order, multiplicity, synchronous error behavior, and returned-value ordering SHALL remain unchanged. The `Session.ts` item object whose `armedId` field consumes `identity.nextId()` and `useShareRef` registration whose whole item is `setRef(ref, node)` SHALL conform as examples of this general boundary rather than file-level waivers.

A `forEach` callback MAY perform explicit synchronous per-item actions only under the boundary above. It SHALL NOT construct a traversal result or start unconsumed asynchronous work. Existing call order, multiplicity, synchronous error behavior, membership semantics, and externally visible effects SHALL remain unchanged.

Concurrent per-item actions MAY use `Promise.all(items.map(...))` only when every `map` callback directly returns its operation Promise and the complete mapped result is immediately consumed by that returned or awaited `Promise.all`. The expression SHALL preserve existing concurrency, result ordering, and rejection behavior. Any equivalent existing bulk operation SHALL take precedence over repeated per-item effects.

A `reduce` callback MAY mutate its accumulator only when the accumulator is created for the current invocation, is exclusively owned by that reduction, is not reachable through an input or outer/shared state, and cannot escape before the reduction completes. The callback SHALL return that accumulator for the next reduction step. This local accumulator mutation SHALL NOT be classified as an external side effect.

The existing `assembleURL` implementation SHALL remain unchanged: its `new URL(url)` accumulator is fresh, exclusive, and non-escaping during reduction, so its local `searchParams.append` mutation conforms to this requirement.

#### Scenario: Reject mutation of an outer binding

- **GIVEN** a result-producing callback assigns, increments, pushes into, deletes from, or otherwise changes a value declared outside that callback
- **WHEN** the callback is evaluated against this standard
- **THEN** it SHALL be rejected as an external side effect and the traversal result SHALL be expressed directly

#### Scenario: Reject mutation of reachable state

- **GIVEN** a result-producing callback mutates an input, closed-over object, shared collection, storage owner, DOM owner, event owner, persistence owner, or another externally reachable value
- **WHEN** the final source is inspected
- **THEN** the callback SHALL be rejected and SHALL NOT use the result method as an effect carrier

#### Scenario: Consume concurrent per-item operations

- **GIVEN** independent per-item operations already execute concurrently and no equivalent bulk operation exists
- **WHEN** the iteration is expressed with `map`
- **THEN** each callback SHALL directly return its operation Promise and one returned or awaited `Promise.all` SHALL immediately consume the complete mapped result without changing concurrency, result ordering, or rejection behavior

#### Scenario: Consume an indivisible mixed effect-and-result owner operation

- **GIVEN** a synchronous owner API inherently performs the item's only external effect and returns a value used in the item's result in the same invocation
- **AND** splitting the effect from result construction would not preserve behavior
- **AND** no behavior-equivalent bulk operation exists
- **WHEN** the operation is applied across a collection
- **THEN** a consumed `map` MAY return an item expression containing exactly one such owner call whose value contributes to the item, while every other subexpression remains pure and there is no outer mutation, second effect, ignored owner result, or file-level waiver

#### Scenario: Allow a private reducer accumulator

- **GIVEN** a reduction creates a fresh accumulator for that invocation and the accumulator cannot be reached or observed outside the reduction while it runs
- **WHEN** its callback mutates and returns only that accumulator
- **THEN** the reduction SHALL conform without cloning the accumulator on every step

#### Scenario: Preserve assembleURL

- **GIVEN** `assembleURL` reduces `Object.entries(params)` into `new URL(url)`, appends each entry to that private URL, and serializes it after reduction
- **WHEN** the iteration cleanup is implemented
- **THEN** that reducer SHALL remain byte-for-byte unchanged and SHALL NOT be rewritten as an external-side-effect fix

### Requirement: Artico targeting preserves message intent and History settlement is bounded

`RoomTransport.send(roomId, payload, to?: string | string[])` SHALL preserve its optional target type. After confirming that the room is joined, the WebChat adapter SHALL call `room.send(payload, to)` exactly once. It SHALL NOT manufacture recipients from room membership, maintain or consult a parallel `readyPeers` set, or loop over recipients.

Target intent SHALL be exact: `undefined` means native room broadcast; `string` means one peer; `string[]` means the selected peer subset in array order; and `[]` means no recipients. An empty array SHALL NOT become broadcast. Every current room-wide product producer SHALL instead resolve application-owned logical recipients: initial Session publication, ordinary Text/Reaction, every History inventory-request page, World full publication, and World publication retry. A non-empty result SHALL make exactly one array-target `room.send`, while an empty result SHALL make zero provider calls. History responses SHALL target the actual requester. Session/World current-state catch-up for a peer that joined or reconnected after the original publication SHALL remain targeted to that peer and SHALL NOT become a duplicate room-wide publication.

Product recipient owners SHALL de-duplicate in first-seen order and exclude self without reading or filtering Artico Call, DataChannel, or separate grace/departure state. Current Session/room-membership ownership SHALL determine which bindings are present. A direct join-followup Session or World publication SHALL perform its required `sleep(1000)` first, re-check the current owner, and only then derive/filter the then-current peer ids. It SHALL NOT snapshot recipients before the sleep. Chain-external sends SHALL retain their prior timing.

Artico's selected-array settlement SHALL remain native. The first selected target throw MAY interrupt later targets and SHALL reject the one delegated send with the original Error. WebChat SHALL NOT expand the array, catch per target, continue later targets itself, retry after provider invocation, add an outbox or acknowledgement, or classify Error text. The existing World release preflight retry SHALL remain limited to a failure that made zero provider calls and SHALL reuse the same publication request and frozen target array. The implementation SHALL keep the existing `@rtco/client` version and lock resolution unchanged.

One History synchronization SHALL allocate one request identity and send each paginated inventory-request page exactly once to the request-start `expectedProviders` array. The same Session/provider snapshot SHALL own loading settlement and every page's explicit targets. Response page order and bounds SHALL be validated independently by `(syncId, sourcePeerId)`, while completion, failure, and departure SHALL settle that provider only for loading. One provider's invalid page, failure, or departure SHALL NOT cancel another provider or erase otherwise valid History received later. Every response page associated with the known request identity and accepted by the existing pagination validation SHALL have its valid records retained and merged through the existing message-identity deduplication regardless of arrival time, loading visibility, provider connectivity, or room generation changes. `syncId` and `sourcePeerId` SHALL only correlate and validate pages; elapsed time and generation changes SHALL NOT discard an otherwise valid page.

History loading SHALL remain manually dismissible. Manual dismissal SHALL change only the UI and SHALL NOT cancel response collection. Otherwise loading SHALL close when every snapshotted provider is completed, failed, or departed, or when the existing absolute ten-second `HISTORY_REQUEST_TIMEOUT_MS` deadline from request start expires, whichever occurs first. This SHALL have the loading-only settlement semantics of racing `Promise.allSettled(providerHistories)` against the timeout; it SHALL NOT await the timeout as a member of `Promise.all` or cancel the losing provider work. Loading closure, timeout, provider failure or departure, and room generation changes SHALL NOT cause an otherwise valid associated History page to be discarded. Whenever such a page arrives, its records SHALL continue through pagination validation, message-identity deduplication, and merge.

#### Scenario: Delegate one optional-target send

- **GIVEN** a joined Artico room and `to` equal to `undefined`, one peer id, a peer-id array, or an empty array
- **WHEN** the adapter sends a payload
- **THEN** it SHALL invoke `room.send(payload, to)` exactly once with the original value and SHALL NOT enumerate, filter, deduplicate, or retry recipients itself
- **AND** `undefined` SHALL broadcast, a string SHALL address one peer, an array SHALL address that selected subset once per matching room peer, and `[]` SHALL send to nobody

#### Scenario: Distinguish publications from current-state catch-up

- **GIVEN** an ordinary Chat message or normal Session/World publication with no request-specific recipient
- **WHEN** it is sent to the room
- **THEN** it SHALL resolve current logical recipients and use one non-empty array-target provider call, or zero calls for an empty array, without building per-peer pending send state
- **BUT** a Session/World current-state snapshot required by one peer that joined or reconnected after the original publication SHALL retain that one explicit recipient

#### Scenario: Target one History request array and merge every provider

- **GIVEN** a History request-start membership snapshot containing multiple peers
- **WHEN** the requester sends the paginated inventory-request pages for that identity and providers respond
- **THEN** each request page SHALL make one provider call with that same explicit `expectedProviders` array, while each response SHALL target the requester
- **AND** valid response lanes SHALL be tracked independently by `(syncId, sourcePeerId)` and their records SHALL be deduplicated and merged without one provider failure cancelling another

#### Scenario: Preserve selected-array provider failure

- **GIVEN** one explicit target array whose first selected Call throws before a later selected Call is attempted
- **WHEN** the adapter delegates the array once
- **THEN** the original Error SHALL reject the whole send and MAY interrupt the later target
- **AND** WebChat SHALL add no per-target attempt-all, provider-call retry, outbox, acknowledgement, classifier, dependency, or lockfile change; the existing zero-call World release preflight retry SHALL remain unchanged

#### Scenario: Close History loading on settlement or timeout

- **GIVEN** History loading is visible and one or more snapshotted providers may complete, fail, leave, or remain incomplete
- **WHEN** all provider lanes settle before ten seconds
- **THEN** loading SHALL close immediately without waiting for the deadline
- **WHEN** the ten-second deadline occurs first
- **THEN** loading SHALL close and already merged records SHALL remain, while every later valid page associated with the request SHALL continue to merge regardless of provider connectivity or room generation changes
- **AND** no page SHALL become invalid merely because it arrived after loading closed or after the ten-second deadline
- **AND** the user SHALL retain the existing ability to dismiss only the loading UI without cancelling synchronization

### Requirement: Exact-History candidate window is 30 days through one six-file replacement

The unified source child SHALL replace the exact-History requester/provider candidate window from 180 days to 30 days as one mechanical `+15/-15` subchange touching exactly these six files: `src/constants/config.ts`; `CLAUDE.md`; `openspec/changes/sync-exact-history-and-show-progress/design.md`; `openspec/changes/sync-exact-history-and-show-progress/specs/webrtc-runtime/spec.md`; `openspec/changes/sync-exact-history-and-show-progress/tasks.md`; and `openspec/specs/webrtc-runtime/spec.md`.

`src/constants/config.ts` SHALL set `HISTORY_WINDOW_DAYS = 30`. The five active or canonical documentation files SHALL replace only the matching `180-day` constant descriptions, requester/provider snapshot wording, requirement text, scenarios, and completed historical task wording with their `30-day` equivalents. Requester and provider cutoff ownership, the wall-clock instant at which each cutoff freezes, eligibility exactly at the cutoff, rejection only before the cutoff, pagination, ordering, budgets, timeouts, protocol, storage, and every other History behavior SHALL remain unchanged. This subchange SHALL modify no archive or test file and SHALL add no test, fixture, helper, tool, dependency, compatibility path, migration, or send-failure handling.

#### Scenario: Apply the exact six-file mechanical replacement

- **GIVEN** the existing exact-History implementation and active/canonical authority use a 180-day requester/provider candidate window
- **WHEN** the unified source child applies the approved retention-window correction
- **THEN** `HISTORY_WINDOW_DAYS` and every matching active/canonical occurrence in the exact six-file scope SHALL use 30 days through a `+15/-15` subdiff
- **AND** no archive, test, dependency, lock, protocol, storage, or other file SHALL change for this retention-window subchange

#### Scenario: Preserve cutoff and pagination semantics

- **GIVEN** requester and provider cutoffs freeze independently and records exactly at either cutoff remain eligible
- **WHEN** their window length changes from 180 days to 30 days
- **THEN** only the duration SHALL change; cutoff ownership and timing, inclusive boundaries, pagination, ordering, budgets, timeouts, and all other History behavior SHALL remain identical

### Requirement: Source authority and task truth remain synchronized

The unified source child SHALL carry the reviewed `proposal.md`, `design.md`, and `specs/source-quality-tooling/spec.md` text without replacing any artifact with an earlier contract. It SHALL carry the same `tasks.md` row identifiers, wording, and order. Only checkbox markers MAY change, and a row SHALL be checked only when every clause in that row is true on the same immutable source exact.

A failed, abandoned, or superseded candidate SHALL NOT supply completion evidence to a repair child. When source inspection or fresh review contradicts any clause in a checked row, that row SHALL remain unchecked on the next candidate. The docs-only authority SHALL complete its phase 1 freeze rows; phase 2 inventory, phase 3 implementation, phase 4 preservation, and phase 5 verification/review rows SHALL remain unchecked until their complete work is performed and proven on the current source exact. This synchronization SHALL preserve the retained one-call optional-target adapter, current explicit product-target classification, native selected-array first-error behavior, multi-provider History settlement, 304-file clean cut, and exact six-file `+15/-15` retention replacement without adding a second authority or enforcement surface.

#### Scenario: Reject a stale authority mirror

- **GIVEN** a source candidate carries an earlier proposal, design, specification, or task-row set that omits any retained transport, History, 30-day, or authored-scope obligation
- **WHEN** the cumulative source authority is inspected
- **THEN** that candidate SHALL fail authority synchronization even if its hosted gates are green

#### Scenario: Reject inherited or partial task completion

- **GIVEN** a task row is checked from a failed or superseded candidate, or only some clauses of the row are true on the current source exact
- **WHEN** the repair candidate synchronizes task truth
- **THEN** the row SHALL be unchecked and SHALL NOT inherit completion from the earlier exact

#### Scenario: Carry one reviewed contract into source

- **GIVEN** the docs-only authority has completed phase 1 while source inventory, implementation, preservation, verification, and review remain unfinished
- **WHEN** the unified source child is created
- **THEN** it SHALL carry the reviewed three authority texts and complete task-row set, with only current-exact checkbox updates and no restoration of WebChat-owned per-target attempt-all, readiness filtering, retry, outbox, acknowledgement, or send-failure classification

### Requirement: Functional-iteration cleanup uses only existing repository tooling

The cleanup SHALL use Oxfmt as the sole formatter, Oxlint as the sole linter, and TypeScript as the type-analysis gate. The existing Oxlint configuration MAY enable a built-in rule already shipped by the installed toolchain when it exactly enforces part of this standard. The implementation MUST NOT add, register, load, generate, or depend on an Oxlint plugin, local rule plugin, parser, second linter, new package, custom semantic scanner, committed scan script, source enforcement module, or dependency change.

No `owner-commit`, `functional-loop`, lint-disable, or other new waiver annotation SHALL make a nonconforming loop or callback acceptable. Semantic boundaries not expressible by existing tools SHALL remain source-review requirements rather than creating a second enforcement path.

The cleanup SHALL add no test case, assertion, test abstraction, fixture, mock capability, or coverage requirement. Existing test, fixture, and harness files SHALL remain in authored scope and MAY receive only the minimum behavior-equivalent iteration or private-state ownership edits required by the same standard, plus minimum expectation synchronization for the explicitly changed Artico and History behavior. An existing private fixture owner MAY replace its complete internal state once when that removes repeated external mutation, but its exposed object and behavior MUST remain equivalent. Test scenarios, inputs, timing, ordering, public fixture contracts, and coverage SHALL remain unchanged.

Except for the exact Artico delegation, target-intent, bounded multi-provider History settlement, and exact six-file 30-day candidate-window corrections above, every source rewrite SHALL preserve evaluation and iteration order, call multiplicity, synchronous or asynchronous execution and concurrency, return values, thrown and rejected errors, object identity, mutation visibility, event and timer ordering, DOM behavior, storage and database operations, wire payloads and persistence behavior, generated output, product behavior, public interfaces, extension permissions, protocols, and dependencies.

#### Scenario: Inspect the authored manifest

- **WHEN** the final implementation manifest is derived from the clean authority base
- **THEN** it SHALL contain exactly 304 authored JavaScript/TypeScript files, exclude only the exact generated validator, and include its generator plus every tracked test, harness, configuration, tool, and ignored source file

#### Scenario: Inspect enforcement changes

- **WHEN** the implementation diff and dependency graph are inspected
- **THEN** they SHALL contain no new plugin, parser, linter, package, scanner, enforcement module, waiver convention, local provider patch, or hand edit to the generated validator
- **AND** the dependency graph and lock resolution SHALL remain unchanged

#### Scenario: Preserve existing test evidence without expanding it

- **WHEN** an existing test, fixture, or harness file requires iteration cleanup or synchronization with the closed transport/History correction
- **THEN** only the minimum implementation and expectation MAY change, while its public fixture contract, scenario, input, timing, ordering, mock capability, abstraction boundary, and coverage SHALL remain identical

#### Scenario: Verify the scoped source

- **WHEN** the immutable source candidate runs the repository's existing format, lint, typecheck, test, build, generated-artifact, OpenSpec, and cleanliness gates and receives fresh independent review
- **THEN** all gates SHALL pass with only the authorized Artico/History success-path and exact 30-day candidate-window behavior changed, with dependencies unchanged and without any other product, protocol, persistence, generated-output, or observable behavior change

#### Scenario: Hold delivery boundaries

- **WHEN** the docs or source pull request is published and reviewed
- **THEN** it SHALL remain Draft and SHALL NOT be browser-tested, marked Ready, merged, deployed, released, or applied to production without separate Owner authority
