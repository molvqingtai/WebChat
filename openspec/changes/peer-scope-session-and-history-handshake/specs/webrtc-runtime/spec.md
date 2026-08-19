## ADDED Requirements

### Requirement: Session and History share one peer-scoped connection topology

Each current admitted Chat peer-join callback SHALL independently invoke one target-only local Session send and one target-only outgoing History requester for that callback's trusted `roomId` and admitted `sourcePeerId`. Each protocol SHALL retain its own progress, success, failure, and terminal State; neither SHALL wait for, authorize, settle, restart, or cancel the other.

Initial Session publication SHALL NOT use an omitted target, room-wide broadcast, all-peer snapshot, baseline-peer set, missed-peer catch-up list, or delayed room-size decision. Receiving a valid Session SHALL validate and apply only that remote Session; it SHALL NOT itself trigger a Session reply. Every History Pull delivered by Wire's trusted-room, current-generation, and schema-valid accepted-message path SHALL create or advance source-owned provider work directly from its transport `roomId`, `sourcePeerId`, and `syncId`, without requiring a Session binding, Wire source-membership query, accepted Session, `sessionId`, `presenceId`, user identity, or Presence observation. Push SHALL retain its exact requester `syncId` and owning-source match plus its existing valid late-page boundary. Text, Reaction, and World publication SHALL retain their existing room-wide behavior.

This change SHALL add no peer-edge registry, pending-edge owner, retry, or new generation State. Existing Wire/Connection leave, reconnect, replacement, queue, and generation behavior SHALL remain unchanged.

#### Scenario: Joining peer exchanges independently with existing peers

- **GIVEN** B and C have an established current relationship
- **WHEN** A joins and each A-B and A-C physical relationship is admitted
- **THEN** B and C SHALL each target-send exactly one local Session and start exactly one History requester toward A, while A SHALL independently target-send exactly one local Session and start exactly one History requester toward each admitted B and C source
- **AND** no Session send SHALL omit its target, no endpoint SHALL wait for a room membership count or the other protocol, and B-C SHALL not restart

#### Scenario: Protocol-valid Pull does not wait for lifecycle binding

- **GIVEN** a History Pull has passed Wire's trusted-room, current-generation, and schema checks and no remote Session binding or Wire source-membership record exists
- **WHEN** the accepted-message event reaches History
- **THEN** History SHALL create or advance provider work directly from the event's transport room/source and message `syncId`, without waiting for or creating a Session, Presence, or replacement admission binding
- **AND** later Session success, rejection, repetition, or projection change SHALL neither restart nor retroactively authorize that History attempt

#### Scenario: Push keeps requester-source ownership and late-page behavior

- **GIVEN** a requester owns one `syncId` and one `sourcePeerId`
- **WHEN** a Push arrives for that attempt, including a valid late page after source departure or loading settlement
- **THEN** only the exact owning source SHALL advance it under the existing late-page boundary, without a new current-Wire-admission requirement or Session binding check

#### Scenario: Empty room commits without peer sends

- **WHEN** a local domain joins a Chat room with no admitted remote source
- **THEN** its local connection and Session SHALL commit without any Session or History send and without waiting for a peer count or timeout

#### Scenario: Late peer adds only new edges

- **GIVEN** A and B have completed or terminalized both directional Session and History lanes
- **WHEN** C is later admitted by A and B
- **THEN** only A-C, C-A, B-C, and C-B SHALL start one Session lane and one History lane each, while A-B and B-A remain unchanged

## MODIFIED Requirements

### Requirement: Runtime Chat session lifecycle

The headless Runtime SHALL bind each Chat source to a session identity and logical generation. Each admitted peer-join callback SHALL target-send strict `session {sessionId, user, presenceId, joinedAt}` to that source before live text or reaction traffic for that source; History MAY start independently from the same callback before remote Session binding. `joinedAt` SHALL be allocated and persisted by Session with a new local logical generation, projected unchanged to wire, and remain unchanged with its `presenceId` across physical session replacement. It SHALL NOT be synthesized from receiver observation, discovery order, a peer snapshot, or `clock.now()`. A bound `sessionId` SHALL not change its `user.id`; an accepted `presenceId` SHALL not change its bound `user.id` or `joinedAt`; live event `userId` SHALL match the transport-bound session user. `name` and `avatar` SHALL remain mutable projection fields: a SESSION for the same accepted identity binding SHALL update that current projection across attached pages without changing logical membership or notices. A new physical incarnation SHALL retain the existing replacement cleanup and fresh History behavior. Reconnect of the same logical generation SHALL not become a new observer join.

#### Scenario: Session binding and replacement

- **WHEN** a source joins Chat, republishes a bound logical generation, sends changed `user.id` or logical time for an accepted generation, or reconnects with a new physical incarnation
- **THEN** the Runtime SHALL target-send its local Session to the callback source, require the remote Session before remote live text/reaction, reject a `user.id` change for the same `sessionId`, reject a `user.id` or `joinedAt` change for the same accepted `presenceId`, reject live events whose `userId` does not match the bound user, and preserve the existing replacement cleanup and fresh History behavior

#### Scenario: Same logical presence refreshes its user projection

- **GIVEN** a source and `presenceId` retain the same `user.id` and `joinedAt`
- **WHEN** a later accepted SESSION changes `name` or `avatar`, or repeats the current values
- **THEN** every attached same-domain page SHALL converge to the current projection idempotently without changing membership count, allocating a generation, emitting a chat/history event, emitting a join/leave notice, or sending a Session reply

#### Scenario: Future HLC does not advance Runtime clock

- **WHEN** the Runtime receives a wire event rejected because its HLC is more than five minutes ahead of the explicit receiver `now`
- **THEN** it SHALL reject the event, leave the central HLC clock unchanged, and continue processing later valid events

### Requirement: Runtime facts have exactly one writable Domain owner

The shared Runtime SHALL split writable authority exactly by responsibility:

- `LifecycleDomain` SHALL uniquely own page leases, per-domain reference counts, the unified five-second grace phase/deadline, and domain-release identity.
- `ConnectionDomain` SHALL uniquely own join, leave, reconnect, recovery attempts, physical-acceptance phase, and current host/domain generation.
- `SessionDomain` SHALL uniquely own committed local/remote Chat sessions, the full committed session snapshot, session incarnation, and central id/HLC allocation State.
- `WorldDomain` SHALL uniquely own the active-domain registry, local World session/snapshot, remote per-source presence snapshots, and derived World presence.
- `HistoryDomain` SHALL uniquely own requester/provider sessions, frozen cutoffs, cursors, budgets, supply ids, batches, and timeout identities.
- `DeliveryDomain` SHALL uniquely own per-domain inbound sequence, volatile un-ACK buffer, byte/event admission, history-batch membership, replay, and ACK completion.
- `WireDomain` SHALL uniquely own trusted room/source membership, provider-ready peer facts, per-room send serialization, per-source decode queues/drop bounds, immutable protocol translation, and provider callback translation.

The application/page Domain SHALL remain the unique owner of retained input, origin records, and UI projections. The comctx Server SHALL only construct the graph and adapt request/reply/subscription registration. Mutable Server maps, a catch-all `NetworkDomain`, generic lock controllers, and direct cross-Domain State imports/writes SHALL NOT own any fact listed above.

The Domain dependency graph SHALL be acyclic. Connection MAY consume Lifecycle, Wire, Session, World, and History; Session MAY consume Wire and Delivery; World MAY consume Wire; History MAY consume Wire, Delivery, and Session only for local domain/session or shared logical-clock facts unrelated to remote-source authorization; Delivery MAY consume Lifecycle; Wire SHALL consume only the immutable public protocol and Runtime-private provider Extern. The resulting dependency chain, together with the allowed edges toward Wire, SHALL remain acyclic. Session SHALL use Delivery only through one admit Command after Session-owned live source/user validation. History SHALL use the Wire accepted-message room/source context, not Session binding, Wire source-membership State, or Presence identity, to create provider work from a protocol-valid Pull. Requester Push SHALL retain exact attempt/source ownership and its current late-page boundary. A Domain SHALL consume another Domain only through its Queries, Commands, and Events.

#### Scenario: Owner matrix has no duplicate writer

- **WHEN** each lease, grace, connection generation, committed session/HLC, World presence, History session/cursor/batch, delivery sequence/buffer, and trusted wire/provider fact is traced
- **THEN** exactly one listed Domain SHALL define its writable State and transitions, while every other consumer uses that owner's CQRS surface

#### Scenario: Runtime graph remains acyclic

- **WHEN** Runtime Domain imports and `domain.getDomain(...)` dependencies are inspected
- **THEN** they SHALL follow the documented direction, contain no cycle, and expose no direct import or mutation of another Domain's State definition

#### Scenario: History authority comes from protocol and attempt identity

- **WHEN** History requester start, protocol-valid Pull handling, requester Push ownership, source replacement, and terminal ownership are traced
- **THEN** requester start SHALL come from peer join, Pull SHALL use its accepted-message room/source and `syncId` directly, Push SHALL retain exact attempt/source ownership and valid late-page behavior, and Session binding, Wire source-membership State, Session events, Presence identity, and user identity SHALL provide no History authority

#### Scenario: Server owns no network truth

- **WHEN** the comctx Server and host composition are inspected
- **THEN** they SHALL contain only graph construction, Extern injection, and request/reply/subscription adaptation, with no authoritative session, generation, presence, history, delivery, or trusted-room map
