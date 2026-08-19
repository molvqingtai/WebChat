## ADDED Requirements

### Requirement: Session and History share one peer-scoped connection topology

Each current admitted Chat peer-join callback SHALL independently invoke one target-only local Session send and one target-only outgoing History requester for that callback's trusted `roomId` and admitted `sourcePeerId`. Each protocol SHALL retain its own progress, success, failure, and terminal State; neither SHALL wait for, authorize, settle, restart, or cancel the other.

Initial Session publication SHALL NOT use an omitted target, room-wide broadcast, all-peer snapshot, baseline-peer set, missed-peer catch-up list, or delayed room-size decision. Receiving a valid Session SHALL validate and apply only that remote Session; it SHALL NOT itself trigger a Session reply. An eligible page-zero History Pull delivered by Wire's trusted-room, current-generation, and schema-valid accepted-message path SHALL create source-owned provider work directly from its transport `roomId`, `sourcePeerId`, and `syncId`, without requiring a Session binding, Wire source-membership query, accepted Session, `sessionId`, `presenceId`, user identity, or Presence observation. Only matching continuous pages SHALL advance it under the existing page-order, replay, resource, bound-`syncId`, and terminal fences; gaps, changed replays, a second `syncId`, post-done pages, and terminal connections SHALL retain their existing behavior. Push SHALL retain its exact requester `syncId` and owning-source match plus its existing valid late-page boundary, including collection after loading settlement. Text, Reaction, and World publication SHALL retain their existing room-wide behavior.

This change SHALL add no peer-edge registry, pending-edge owner, retry, or new generation State. Existing Wire/Connection leave, reconnect, replacement, queue, and generation behavior SHALL remain unchanged.

#### Scenario: Joining peer exchanges independently with existing peers

- **GIVEN** B and C have an established current relationship
- **WHEN** A joins and each A-B and A-C physical relationship is admitted
- **THEN** B and C SHALL each target-send exactly one local Session and start exactly one History requester toward A, while A SHALL independently target-send exactly one local Session and start exactly one History requester toward each admitted B and C source
- **AND** no Session send SHALL omit its target, no endpoint SHALL wait for a room membership count or the other protocol, and B-C SHALL not restart

#### Scenario: Eligible Pull does not wait for lifecycle binding

- **GIVEN** an eligible page-zero History Pull has passed Wire's trusted-room, current-generation, and schema checks and no remote Session binding or Wire source-membership record exists
- **WHEN** the accepted-message event reaches History
- **THEN** History SHALL create provider work directly from the event's transport room/source and message `syncId`, without waiting for or creating a Session, Presence, or replacement admission binding
- **AND** later Session success, rejection, repetition, or projection change SHALL neither restart nor retroactively authorize that History attempt

#### Scenario: Pull progression retains existing protocol fences

- **GIVEN** one provider direction has admitted its eligible page zero and bound its `syncId`
- **WHEN** a matching continuous page, gap, changed replay, different `syncId`, post-done page, or page after terminal connection State arrives
- **THEN** only the matching continuous page SHALL advance under the existing paging and resource rules, while every other case retains its existing inert, drop, or terminal behavior without a Session or membership gate

#### Scenario: Push keeps requester-source ownership and late-page behavior

- **GIVEN** a requester owns one `syncId` and one `sourcePeerId`
- **WHEN** a Push arrives for that attempt, including a valid late page after source departure or loading settlement
- **THEN** only the exact owning source SHALL advance it under the existing late-page boundary, without a new current-Wire-admission requirement or Session binding check
- **AND** loading settlement SHALL NOT by itself terminalize the requester's valid late-page collection

#### Scenario: Empty room commits without peer sends

- **WHEN** a local domain joins a Chat room with no admitted remote source
- **THEN** its local connection and Session SHALL commit without any Session or History send and without waiting for a peer count or timeout

#### Scenario: Late peer adds only new edges

- **GIVEN** A and B have completed or terminalized both directional Session and History lanes
- **WHEN** C is later admitted by A and B
- **THEN** only A-C, C-A, B-C, and C-B SHALL start one Session lane and one History lane each, while A-B and B-A remain unchanged

## MODIFIED Requirements

### Requirement: Physical room acceptance commits a domain join

A Runtime logical room registration or desired-room request SHALL NOT by itself constitute physical room readiness or successful domain join. `ConnectionDomain` SHALL keep every initial domain join provisional until the required physical Chat and World rooms accept and the initial World presence snapshot is accepted through `WireDomain`. Chat Session delivery SHALL NOT be a join-commit prerequisite: after physical Chat-room acceptance, `SessionDomain` SHALL commit its local Session even when no remote peer exists, and each later admitted peer-join callback SHALL independently target-send that current local Session. `ConnectionDomain` SHALL command `SessionDomain` and `WorldDomain` to commit the domain's local-session and local-World facts and complete the join operation exactly once.

For a transient provider/room-not-ready result, the Runtime SHALL use bounded Runtime-owned readiness waiting or automatic retry, or atomically roll back the provisional join before surfacing a retryable failure. It SHALL NOT leave a terminal state that can receive remote Chat sessions or World presence while the local page has no local-session/presence projection. Cold existing-user startup, normal startup, and supported host/process recovery SHALL automatically converge to exact local plus remote Chat membership and World presence without a page reload or manual reconnect. Pages SHALL NOT implement a fallback retry queue or browser-specific business logic.

Each provisional attempt SHALL be fenced by the active host and domain lifecycle generation. Last-page release, explicit leave/reconnect, host replacement, and late provider/room-open callbacks SHALL cancel or supersede the prior attempt; a stale completion SHALL not alter state or emit a projection. One logical join SHALL create at most one physical room for each required room id, commit one local Session generation, and emit at most one initial local World presence. It SHALL send at most one target Session for each admitted peer-join callback and SHALL emit no initial room-wide Session.

Peer-ready and inbound Session events received during a provisional window SHALL belong to the active attempt rather than the retained committed runtime. Each admitted Chat peer callback SHALL target-send the attempt's current local Session once without an initial Chat broadcast, baseline snapshot, or missed-peer catch-up. A peer that becomes ready after an accepted initial World broadcast but before commit, and therefore could not receive that World value, SHALL receive exactly one targeted current World presence after commit. The Runtime SHALL send no World catch-up for a rolled-back or superseded attempt and no duplicate to a peer already covered by the accepted initial World broadcast. A remote Chat Session received during a provisional reconnect SHALL remain invisible to pages until commit and SHALL then appear exactly once in the replacement committed snapshot; it SHALL NOT leak through the previous committed runtime or be overwritten by an empty attempt snapshot.

A bounded room-recovery timeout SHALL retain ownership of the underlying asynchronous join. A timeout surfaced as terminal for an attempt SHALL invalidate and leave or otherwise fence that attempt before a late completion can register trusted membership. An automatically retained retry SHALL remain provisional until its current World presence is accepted. In either case, late physical readiness SHALL NOT leave a persistent physical or trusted World room, or an observable joined snapshot, without an accepted current World presence; a later recovery attempt SHALL publish the full current snapshot before commit.

#### Scenario: Delayed physical room on cold existing-user join

- **GIVEN** an existing page identity and an injected transport whose logical join records desired rooms while physical Chat and World rooms remain unavailable
- **WHEN** the page automatically joins and a remote peer later becomes available before the bounded Runtime retry/window ends
- **THEN** no failed provisional attempt may remain remote-receivable without local projection, the Runtime SHALL eventually commit exactly one local Session and one local World presence, the page SHALL show the exact local-plus-remote memberships, and each admitted peer callback SHALL receive exactly one target Session without an initial Chat broadcast

#### Scenario: Cancelled or superseded delayed join

- **GIVEN** a domain join is waiting for physical room acceptance
- **WHEN** its page lease releases, the host is replaced, the domain reconnects, or an earlier provider opens after a newer generation begins
- **THEN** the stale attempt SHALL not target-send a Session, publish presence, or mutate the current domain, and the current generation alone may converge

#### Scenario: Peer becomes ready during provisional commit

- **GIVEN** a Chat peer callback and the initial World publication occur while the domain join remains provisional
- **WHEN** the peer is admitted and the same attempt later commits
- **THEN** the callback SHALL cause exactly one targeted current Chat Session, and the Runtime SHALL additionally target-send World presence only when that peer missed the accepted initial World broadcast, without any Chat baseline/missed-peer catch-up or stale-attempt send

#### Scenario: Remote session arrives during provisional reconnect

- **GIVEN** a committed domain is retained while a replacement Chat room reconnect remains provisional
- **WHEN** the replacement room receives a remote Session before its callback's targeted local Session settles
- **THEN** the remote Session SHALL remain attempt-owned and invisible to pages before commit, then appear exactly once in the committed replacement snapshot without entering the prior runtime or being overwritten

#### Scenario: World recovery times out before physical readiness

- **GIVEN** a World recovery join remains physically pending beyond its bounded timeout
- **WHEN** the timeout settles and the underlying provider reports readiness later
- **THEN** the timed-out completion SHALL be fenced from trusted membership, or an owned automatic retry SHALL remain provisional until the current full World presence is accepted; no settled state SHALL expose joined World membership without that publication

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

### Requirement: Immutable peer values terminate in explicit Domain mappings

`WireDomain` SHALL terminate every protocol DTO at one typed accepted-message Event and SHALL NOT expose raw provider callbacks, decoded unknown values, or a shared mutable wire model. `SessionMessage` SHALL enter Session binding/generation commit Commands, and `SessionEndMessage` SHALL enter Session's source-bound idempotent generation-end Command. `TextMessage` and `ReactionMessage` SHALL enter Session source/user validation and then Delivery admission. An eligible page-zero `HistoryRequestMessage` SHALL enter History provider State directly from its accepted transport room/source and `syncId`, and matching continuous pages SHALL retain the existing paging/replay/resource/terminal fences without a Session or Wire-membership Query. `HistoryResponseMessage` SHALL enter History requester Commands under exact attempt/source/page ownership, with accepted response batches entering Delivery atomically and valid late pages remaining collectible after loading settlement. `WorldRoomMessage` SHALL enter World source-snapshot replacement. Provider peer-ready/leave and room-close/error facts SHALL enter Connection transitions, which SHALL request Session/World/History cleanup through their Commands rather than mutate them.

The sole typed Effects SHALL own accepted-message kind routing into internal apply Commands. Session's SESSION handler SHALL NOT repeat the SESSION discriminant, Session's live handler SHALL NOT repeat the TEXT/REACTION discriminants, and World's presence handler SHALL NOT repeat the World `sites` or room-identity test after Wire's room-selected schema and the World Effect have narrowed that value. This removal SHALL NOT affect Wire's asynchronous trusted-room/current-generation recheck; Session's current binding, user, HLC, ended-Presence physical-admission and identity rules; World's same-session identity rule; History's attempt/source/paging/replay/timeout/late-page/resource rules; local outbound schema validation; or peer-join/leave routing.

Outbound `SessionMessage` SHALL originate from Session after an accepted Connection generation. Outbound `SessionEndMessage` SHALL originate from final Session release only after private lease retirement and SHALL be sent before physical Chat-room leave. Outbound Text/Reaction SHALL use Session-owned id/HLC allocation and a Wire send Command. History request/response SHALL originate from History State and page-supply outcomes. `WorldRoomMessage` SHALL originate from World's current full snapshot only after Connection acceptance. All outbound values SHALL use the strict current schemas and unchanged codec algorithm; only the Owner-authorized SESSION `presenceId` and SESSION_END shapes differ from the prior baseline.

#### Scenario: Chat message crosses one trust and delivery path

- **WHEN** Wire accepts a TextMessage or ReactionMessage from a transport-confirmed source and the sole live Effect routes that narrowed value
- **THEN** the internal Session apply Command SHALL not repeat the discriminant test, Session SHALL still validate the committed source/user binding and HLC before Delivery receives one admit Command, and no other Domain or adapter SHALL store a parallel writable copy

#### Scenario: History request crosses one owner path

- **WHEN** Wire accepts an eligible first Pull or a matching continuous Pull
- **THEN** History SHALL use accepted transport room/source plus its provider paging, replay, budget, terminal, and exact-owner State without a Session-binding or Wire-membership Query

#### Scenario: History response crosses one owner path

- **WHEN** Wire accepts a HistoryResponseMessage, including a valid exact-owner late page after loading settlement
- **THEN** History SHALL validate its requester source/page/replay/budget/terminal State without a Session-binding or current Wire-membership Query and issue at most one atomic Delivery batch admission, without Wire, Server, or ChatRoom adapter owning the history session

#### Scenario: World snapshot crosses one owner path

- **WHEN** Wire's World-room schema and sole World Effect accept and route a WorldRoomMessage, or Connection accepts a generation that must publish local presence
- **THEN** the internal World apply Command SHALL not repeat the `sites` or World-room test, while World SHALL retain its source/session identity rules and remain the only source-snapshot/presence owner

#### Scenario: Async and stateful guards remain distinct

- **WHEN** an accepted-message path is traced across asynchronous decode, Session, World, History, local outbound construction, and peer-event routing
- **THEN** only the three repeated internal kind/room checks SHALL be absent, while every listed asynchronous lifecycle, binding, identity, HLC, attempt, paging, source-owner, resource, outbound-schema, and peer-router guard SHALL remain
