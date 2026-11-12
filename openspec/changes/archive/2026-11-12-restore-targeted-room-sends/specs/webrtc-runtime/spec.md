## ADDED Requirements

### Requirement: Product room-wide sends use one explicit logical-target array

`Room.send(body, target?: string | string[])` and the private `RoomTransport.send` capability SHALL preserve their optional target type and complete provider meanings: `undefined` is native Room broadcast, `string` is one target, `string[]` is the selected target subset in array order, and `[]` is no recipients. An empty array SHALL NOT fall back to broadcast.

Every current product send with room-wide logical intent SHALL resolve its recipients before provider invocation and SHALL use exactly one `Room.send(body, peerIds)` call when the resolved array is non-empty. An empty resolved array SHALL perform no provider call and SHALL settle as successful no-recipient work. WebChat SHALL NOT expand the array into `map`, `forEach`, a loop, or one call per peer.

The complete current omitted-target producer inventory SHALL be initial Session publication, ordinary Text/Reaction, every History inventory-request page, World full publication, and World publication retry. Initial Session publication SHALL use its active attempt's current Chat-room Session sources. Text/Reaction SHALL use the committed domain's current Session sources. History inventory pages SHALL use that request's request-start `expectedProviders` from current Sessions. A World full publication SHALL freeze its current World room members, and its existing whole-publication retry SHALL reuse the same array. Every list SHALL exclude self and de-duplicate in deterministic first-seen order. Current Session/room-membership ownership SHALL determine which bindings are present; this repair SHALL add no separate grace/departure classifier.

When initial Session or World publication belongs to a direct post-join continuation, its target resolution SHALL occur only after that continuation's required `sleep(1000)` completes and current ownership is re-checked. It SHALL NOT snapshot, filter, de-duplicate, or self-exclude peer ids before sleeping. Session or World membership that changes during the wait SHALL be reflected in the array eventually supplied to the provider. A World retry SHALL reuse only the post-sleep array frozen by its owning full-publication revision.

Existing explicit single-target and array-target Session/World catch-up and History response calls SHALL retain their current recipients. Recipient selection SHALL use only current application/session/room-membership facts already owned by Session, History, World, or Wire. It SHALL NOT read, cache, filter, or wait for a remote peer state, Artico Call, DataChannel object, or `readyState`, and SHALL add no `readyPeers` or equivalent transport-readiness set.

Artico's selected-array settlement SHALL remain unchanged. If a selected Call closes before invocation and throws, the original Error SHALL reject the one send and MAY interrupt every later array target. WebChat SHALL NOT contain that throw per target, continue later targets, retry an already invoked provider send, replay it, create an outbox, classify the Error text, or add delivery status or acknowledgement. The existing World release preflight retry SHALL remain limited to a failure that made zero provider calls and SHALL reuse the same full-publication request and frozen target array.

The implementation SHALL restore the v1.9.7 `Why specify peerIds` explanation and both historical Artico reference lines byte-for-byte except for replacing the two obsolete `UserList`/`SyncUser` lines with current Sessions/application-layer Session membership wording. The comment SHALL explain that native broadcast includes connecting Calls and that a not-open local per-peer DataChannel throws and interrupts provider iteration; it SHALL NOT inspect DataChannel state or claim that a selected Session cannot close later.

#### Scenario: Every current room-wide producer supplies explicit targets

- **GIVEN** the five current product producers for initial Session, Text/Reaction, History inventory, World full publication, and World publication retry
- **WHEN** each reaches its provider boundary with one or more current logical recipients
- **THEN** each SHALL invoke `Room.send(body, peerIds)` exactly once with a non-empty de-duplicated self-excluding array and no product producer SHALL invoke omitted-target `Room.send(body)`

#### Scenario: Empty logical recipients perform no provider send

- **GIVEN** any current room-wide product producer resolves no eligible peer id
- **WHEN** its send operation settles
- **THEN** it SHALL perform zero `Room.send` calls, SHALL NOT substitute `undefined`, and SHALL preserve the operation's existing successful no-recipient, local acceptance, persistence, display, or continuation behavior

#### Scenario: User Chat targets current Sessions once

- **GIVEN** a user-authored Text or Reaction and current committed Sessions containing duplicate `sourcePeerId` values, self, and distinct remote sources
- **WHEN** the product sends the protocol-valid Chat message
- **THEN** it SHALL select distinct remote `sourcePeerId` values in first-seen order and SHALL make one array-target provider call without reading any DataChannel or separate grace/departure state

#### Scenario: First selected target throw interrupts the provider array

- **GIVEN** one explicit peer-id array whose first selected Call closes after logical selection and whose later selected Call remains sendable
- **WHEN** Artico's single array call reaches the first Call and throws
- **THEN** WebChat SHALL preserve that original Error as the whole-send failure, SHALL NOT attempt the later target through a WebChat loop, and SHALL add no retry, outbox, acknowledgement, or error-text exception

#### Scenario: Low-level optional target remains complete

- **GIVEN** a direct private provider-capability call with `undefined`, one peer id, a peer-id array, or `[]`
- **WHEN** the adapter delegates it
- **THEN** it SHALL keep the exact native broadcast, single-target, selected-array, or no-recipient meaning and SHALL NOT change the public/private type merely because current product producers now select explicit arrays

### Requirement: Direct post-join publication chains wait one second locally

Only a provider send that is the direct continuation of this client's successful Room join SHALL gain one call-site-local `sleep(1000)` before its first `Room.send`. The affected continuations SHALL be: the accepted Domain attempt before its initial Session then World publication sequence; the accepted World recovery or manual-replacement attempt before its current full World publication; and a never-invoked serialized send head whose provider invocation is resumed directly by that accepted join. The Domain sequence SHALL sleep once before Session publication and SHALL NOT sleep again before its immediately chained World publication. A resumed room-wide producer SHALL derive its current logical recipients only after the sleep; an already explicit targeted head SHALL retain its existing recipient meaning without re-filtering.

The delay SHALL begin after the exact matching join succeeds. It SHALL create no room-wide readiness State, stabilization deadline, shared delayed-send queue, persistent timer, per-automatic-send delay, or common gate. A newly initiated user Text/Reaction send and every History page, peer catch-up, History response, later World registry publication, release publication not directly created by join, or other chain SHALL keep its current timing.

Only after the sleep completes SHALL the continuation re-check its exact owner. Each affected room-wide producer SHALL then derive, filter, de-duplicate, and self-exclude its current logical peer ids and SHALL perform no peer-id snapshot or filtering before the sleep; an explicit targeted head SHALL instead preserve its existing recipient. The sleep SHALL remain owned by its exact join request, Room generation, attempt, and continuation. Leave, teardown, cancellation, reconnect/replacement, attempt supersession, or Runtime replacement during the sleep SHALL make the old continuation inert. A late timer SHALL perform no target derivation, provider call, state commit, failure projection, retry, or mutation of a successor. Existing absolute join/recovery deadlines SHALL remain unchanged and SHALL NOT be extended by the sleep.

#### Scenario: Initial Domain publication waits exactly once

- **GIVEN** the current Domain attempt has successfully joined its Chat and required World Room and still owns its continuation
- **WHEN** 999ms have elapsed since that accepted join
- **THEN** neither the initial Session publication nor its chained World publication SHALL have called `Room.send`
- **WHEN** the elapsed delay reaches 1000ms
- **THEN** the current continuation SHALL re-check ownership, derive the then-current Session targets, and MAY send the initial Session once, then derive the then-current World targets and publish World without a second one-second delay

#### Scenario: World recovery publication waits after its join

- **GIVEN** one current automatic recovery or manual replacement has successfully joined the World Room
- **WHEN** its direct publication continuation runs
- **THEN** it SHALL wait 1000ms from that accepted join, re-check current ownership, and only then derive current World targets before the first current full World `Room.send` call

#### Scenario: Join-followup targets reflect membership after the sleep

- **GIVEN** a current direct join-followup continuation is sleeping and its logical room membership changes before 1000ms
- **WHEN** the sleep completes while the same join request, Room generation, attempt, and continuation remain current
- **THEN** the producer SHALL derive its de-duplicated self-excluding target array from the membership then current, reflecting membership changes during the wait exactly as represented by the current owner
- **AND** it SHALL NOT use a peer-id snapshot or filtered array created before the sleep

#### Scenario: Later flows do not inherit a join delay

- **GIVEN** the direct join-followup continuation has ended or a send belongs to a user action, History, peer catch-up, a later World update, or another non-join flow
- **WHEN** that send becomes otherwise admissible
- **THEN** it SHALL retain its existing timing and SHALL NOT consult a shared joined-at deadline or add another sleep

#### Scenario: Superseded sleep cannot send late

- **GIVEN** a direct post-join continuation is sleeping
- **WHEN** its Room leaves, its attempt is cancelled or superseded, or its Runtime generation is replaced before 1000ms
- **THEN** expiration of the old timer SHALL derive no targets, call no provider, commit no old state, emit no old failure, and affect no successor continuation

## MODIFIED Requirements

### Requirement: Provider capability is private behind WireDomain

The Runtime SHALL define one private `RoomTransportExtern` injected only into `WireDomain`. It SHALL express provider-neutral capabilities for stable local peer identity, room join/leave, optional-target send, transport-confirmed inbound source, peer join/leave, room close/error, and deterministic dispose. `RoomTransport` MAY remain only as the concrete implementation shape behind that Extern; it SHALL NOT be a public application port, protocol export, or capability imported by UI, application Domains, or non-Wire Runtime Domains.

Artico SHALL appear only in the provider implementation and explicit composition root. `WireDomain` SHALL be the sole anti-corruption boundary: it validates trusted room/source identity, codec/schema/size limits, ordering and queue bounds, then emits typed Runtime Events; outbound typed Domain intent is encoded and sent only through its Effect and `RoomTransportExtern`. The former imperative `WireExtern` route and every direct concrete/provider call from another Domain SHALL remain absent.

Provider parity SHALL preserve native optional-target meanings and one-call settlement. A selected peer array SHALL be delegated once in its given order; the provider's first synchronous target throw MAY interrupt later targets and SHALL reject the one send with the original Error. Neither provider adapter SHALL add per-target attempt-all, recipient filtering by DataChannel state, provider-call retry, outbox, or delivery acknowledgement.

#### Scenario: Provider can be replaced without application change

- **WHEN** a second provider implementation satisfies the private provider contract
- **THEN** ChatRoomExtern, application Domains, Runtime owner semantics, peer protocol, persistence, and UI SHALL require no change; only provider implementation/composition SHALL differ

#### Scenario: Artico does not leak

- **WHEN** imports, public exports, Domain Externs, protocol types, and comctx contracts are scanned
- **THEN** Artico symbols SHALL exist only in its provider implementation and explicit composition, and only `WireDomain` SHALL obtain `RoomTransportExtern`

#### Scenario: Provider contract parity

- **WHEN** the provider contract suite runs against the Artico implementation and deterministic fake
- **THEN** both SHALL satisfy stable peer identity, join/leave, trusted inbound source, exact `undefined|string|string[]|[]` send meanings, one selected-array call with first-error interruption, room-level failure, close, error, and dispose semantics without adding delivery acknowledgement

## REMOVED Requirements

### Requirement: Physical sends isolate per-target readiness transitions

**Reason**: Owner selected one explicit `Room.send(body, peerIds)` call and Artico's native array settlement. WebChat no longer snapshots transport readiness or attempts each target independently, so target-local containment and later-target continuation are incorrect authority.

**Migration**: `Product room-wide sends use one explicit logical-target array` is the sole current send-target requirement. Logical membership excludes signaling-only connecting Calls, while a selected peer that closes later preserves Artico's original first-throw interruption and existing whole-send failure route. No provider-call retry, outbox, status, acknowledgement, or compatibility path exists; the existing zero-call World release preflight retry remains unchanged.
