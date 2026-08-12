## ADDED Requirements

### Requirement: Manual Refresh rebuilds current-domain connection state from a clean baseline

An accepted AppButton Refresh SHALL fully destroy all connection state owned by the current domain before its replacement can synchronize or commit. This destruction SHALL include the domain's physical Chat transport owner and peer; trusted room membership; Connection attempt, generation, phase/readiness, retry, and recovery work; committed and provisional Session state; remote presence observations including active or ended records; pending leaves; History requester/provider work and synchronization bindings; volatile Delivery buffer, sequence, batch, and acknowledgement state; member snapshots; baseline and catch-up facts; send/decode queues; and every domain-scoped timer, cache, callback, operation, or fence. No destroyed fact SHALL seed the replacement snapshot, reject an otherwise valid current SESSION, replay an old delivery, publish an old result, or settle current work.

After the reset settles, Refresh SHALL use the same canonical current-domain join, SESSION exchange, validation, and member-snapshot commit path used by a clean domain connection. It SHALL rotate physical `peerId` and `sessionId` while retaining the active local logical `presenceId` and `joinedAt`; preserving that logical identity SHALL neither preserve a remote observation nor generate a false logical leave or join. Every page currently attached to that domain SHALL converge to the replacement's committed snapshot.

The destruction SHALL be scoped to the current domain's connection state. The current domain's page lease SHALL remain attached, but no prior connection phase or readiness result SHALL satisfy the replacement; readiness SHALL be re-established only by the canonical clean attempt. Persistent message history, configured user identity and settings, the current page and its page-owned state, the shared World peer, World state for all sites, and every other domain's Chat connection, sessions, presence, messages, member snapshot, History/Delivery work, and recovery state SHALL remain unchanged. Refresh SHALL re-publish the current domain's presence through the existing flow. It SHALL NOT change peer wire messages or schemas, codec or version, protocol namespaces, room identifiers, peer compatibility, persistence schemas, or the public `ChatRoom` interface, and SHALL add no alternate refresh-only synchronization path, fallback, migration, or compatibility layer.

#### Scenario: Ended remote observation cannot survive Refresh

- **GIVEN** a healthy four-member room where the current domain's stale connection state contains an `ended` observation for one still-online member and therefore exposes only three members
- **WHEN** the user activates AppButton Refresh once and that member publishes its valid current SESSION with the same logical presence identity
- **THEN** the discarded observation SHALL NOT reject the SESSION, the canonical replacement SHALL commit all four current members, and no tab close or five-second release wait SHALL be required

#### Scenario: Replacement starts after complete current-domain connection destruction

- **GIVEN** the current domain has a Chat owner and trusted room, current attempt/generation/readiness, Session and observer state, pending leaves, History work, volatile Delivery state, member snapshot, baseline or catch-up facts, queues, timers, callbacks, and pending recovery work
- **WHEN** an accepted AppButton Refresh starts its replacement
- **THEN** the old physical owner SHALL be gone and none of those facts SHALL seed, reject, replay, publish, time, cancel, or settle the replacement, and only facts received or created through the replacement's canonical synchronization MAY establish its connection, readiness, or committed snapshot

#### Scenario: Refresh preserves logical presence while rotating physical identity

- **GIVEN** the current domain has one active local logical presence and a committed physical Chat peer
- **WHEN** AppButton Refresh completes successfully
- **THEN** the replacement SHALL have a new `peerId` and `sessionId`, SHALL retain the current `presenceId` and `joinedAt`, SHALL re-publish current-domain presence, and SHALL create no logical leave/join notice solely because of Refresh

#### Scenario: Same-domain pages converge to one clean replacement

- **GIVEN** multiple pages are attached to the current domain and share its Chat connection
- **WHEN** one page activates AppButton Refresh
- **THEN** the Runtime SHALL perform one current-domain clean replacement and every attached same-domain page SHALL converge to its one committed member snapshot without retaining or replaying the old snapshot

#### Scenario: Volatile History and Delivery work does not cross Refresh

- **GIVEN** the current domain owns active History synchronization, pending supply or feedback work, buffered inbound deliveries, batch acknowledgement state, and old-generation send or decode queues
- **WHEN** AppButton Refresh destroys the domain connection state
- **THEN** all such current-domain work SHALL be cancelled or discarded before replacement, no old record or terminal SHALL be replayed into the new generation, and persistent message records already stored by the page SHALL remain unchanged

#### Scenario: Preserved data and unrelated network scopes are unchanged

- **GIVEN** the current domain has persistent messages and page state while the shared World peer and another domain's Chat connection are active
- **WHEN** AppButton Refresh rebuilds the current domain
- **THEN** the messages, configured identity and settings, current page, shared World peer, World site state, and other domain's Chat peer, sessions, presence, messages, member snapshot, and recovery work SHALL remain unchanged

#### Scenario: Refresh uses the existing external contract

- **WHEN** the current-domain clean Refresh is implemented and exercised against an existing peer
- **THEN** it SHALL use the existing room and SESSION synchronization contract without changing a wire message, schema, codec, version, namespace, room identifier, public `ChatRoom` method, or peer upgrade requirement

#### Scenario: Clean Refresh is behaviorally distinct from last-tab release

- **GIVEN** the current page remains attached and the current local logical presence is active
- **WHEN** AppButton Refresh resets connection state
- **THEN** it SHALL obtain the member-recovery result of a clean domain connection without deleting persistent data, waiting for the last-tab grace, removing the current page lease, retiring the logical presence, or rebuilding the shared World peer

#### Scenario: Common SESSION guard is audited across lifecycle entries

- **GIVEN** SESSION validation is shared by initial join, reconnect, recovery, page reattachment, and same-domain lifecycle paths
- **WHEN** implementation verification enumerates every path that can accept a SESSION for an existing logical `presenceId`
- **THEN** each path SHALL either start without prior domain connection state, intentionally remain inside the same live connection state, or have a focused regression proving a valid current SESSION cannot be rejected solely by a stale ended observation; each regression SHALL also prove truly stale physical or logical work remains rejected

### Requirement: Current physical SESSION evidence corrects stale observer finality

The SESSION receive rule SHALL apply consistently to initial join, manual reconnect, automatic recovery, same-domain page attach or reattach, return during grace, and supported Runtime host recovery. An observer-local `ended` record SHALL NOT by itself permanently reject a later SESSION for the same logical presence.

The Runtime SHALL accept an observer-stale logical generation only when the SESSION is strict, arrives through the currently trusted Chat room generation from a currently admitted physical source, carries a physical `sessionId` different from the ended binding, exactly matches the accepted `presenceId`, `user.id`, and `joinedAt`, and conflicts with no newer active binding or logical generation. That acceptance SHALL replace the old physical binding, classify the same logical generation active, converge current membership, and fence any old pending leave or physical work. It SHALL NOT allocate a new logical generation, change logical join time, or create a duplicate logical join solely because physical connectivity recovered.

Arrival order alone SHALL NOT establish authority. A SESSION from an untrusted or superseded room/source/attempt, a SESSION carrying the ended binding's same physical `sessionId`, a conflicting `user.id` or `joinedAt`, a binding superseded by a newer accepted generation, or delayed work from a prior physical generation SHALL remain rejected without changing current membership, history, projection, or notices. This classification SHALL use existing trusted transport context and SESSION fields; it SHALL change no wire schema, version, codec, namespace, room identifier, or public interface.

#### Scenario: Manual reconnect accepts a new physical binding for the same logical presence

- **GIVEN** a remote logical presence is observer-stale `ended`, its peer remains logically online, and manual reconnect establishes a current trusted source with a new physical `sessionId`
- **WHEN** that source sends a strict SESSION matching the ended record's `presenceId`, `user.id`, and `joinedAt`
- **THEN** the Runtime SHALL accept the new physical binding, classify the same logical generation active, converge membership, and emit no duplicate logical join solely for the recovery

#### Scenario: Automatic recovery accepts the current physical replacement

- **GIVEN** automatic connection recovery replaces a physical source for a retained logical generation after an observer marked its old physical binding ended
- **WHEN** the current trusted replacement publishes a new `sessionId` with the exact accepted logical identity and time
- **THEN** the shared SESSION rule SHALL accept it and converge the retained generation without requiring AppButton Refresh or complete domain release

#### Scenario: Page lifecycle cannot preserve a stale observer rejection

- **GIVEN** same-domain attach or reattach, return during grace, or supported host recovery can receive SESSION for an existing logical `presenceId`
- **WHEN** its current trusted physical source proves a new strictly matching session binding
- **THEN** the path SHALL accept and converge that binding even if restored observer state was `ended`, while a path that merely retains one live connection SHALL neither manufacture a new SESSION generation nor alter membership

#### Scenario: Exact ended physical session replay remains rejected

- **GIVEN** an observer ended one physical binding for a logical presence
- **WHEN** a delayed or duplicated SESSION carries that ended binding's same `sessionId`
- **THEN** the Runtime SHALL reject it and SHALL NOT reactivate membership, change projection, restart History, or create a lifecycle notice

#### Scenario: Superseded transport work cannot claim current authority

- **GIVEN** a new room, source, attempt, or connection generation owns current SESSION admission
- **WHEN** a prior room/source/attempt callback delivers a matching or mutated SESSION after supersession
- **THEN** the Runtime SHALL reject or ignore it before observer correction, and only the current trusted physical generation MAY establish a binding

#### Scenario: Logical identity conflict is not a legal rebind

- **GIVEN** an ended observer record binds one `presenceId` to exact `user.id` and `joinedAt`
- **WHEN** a SESSION reuses that `presenceId` with a different user, a different logical join time, or after a newer accepted generation superseded it
- **THEN** the Runtime SHALL reject the SESSION source-locally and preserve all current accepted membership, projection, history, and notices

#### Scenario: Freshness requires evidence rather than last arrival

- **WHEN** multiple SESSION frames for an observer-stale presence arrive in different orders
- **THEN** acceptance SHALL be determined by current trusted physical membership, new physical binding, exact logical identity, and generation fencing rather than wall clock or arrival order, and no wire or public contract change SHALL be required
