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

## MODIFIED Requirements

### Requirement: Session classifies logical presence across physical lifecycles

Session SHALL uniquely own local active-generation State, a bounded remote observer ledger, physical-source bindings, and one pending physical-leave deadline per affected remote presence. A private two-method `PresenceStoreExtern` SHALL persist only the local active-generation record through `browser.storage.session` across supported Runtime host replacement; it SHALL NOT expand MessageStore, the origin database schema, `RuntimeServer`, `ChatRoomExtern`, or any UI/public model. No in-flight end, retryable pending end, settled cleanup, observer end marker, or other final-end record SHALL exist. Session SHALL allocate exact `{presenceId, joinedAt}` only for initial join or true return after completed local release. Refresh, reconnect, recovery, replay, duplicate SESSION, additional physical session, page reattach, and supported host replacement SHALL reuse the retained generation and logical time and emit snapshot convergence without a logical join/leave.

Chrome MV3 SHALL construct the concrete session-backed PresenceStore in the background Service Worker and expose only its existing `load`/`save` methods to the Offscreen Runtime through a dedicated comctx adapter over a point-to-point Runtime Port. Port name and comctx namespace SHALL be routing values rather than authority. Before delivering a message, Background SHALL require the transport sender's runtime id, exact Offscreen document URL, and absence of a tab; content, options, and every other extension source SHALL be disconnected without reading or writing durable state. Every provider response SHALL resolve through the exact request-to-Port binding recorded when its request arrived. If that binding has detached or been replaced, the response SHALL be dropped and SHALL NOT fall back to the current active Port. Offscreen SHALL admit a response only while that request remains pending on the same binding; uncorrelated, replayed, old-binding, wrong-namespace, wrong-direction, and broadcast responses SHALL reach no comctx callback. From request-ID response registration, each one-shot call SHALL reserve exactly one ordered transport generation. Generic response subscription SHALL NOT open a Port. The local heartbeat response subscription SHALL unregister before the actual `apply`, and that `apply` SHALL consume the oldest remaining request reservation. If the reserved generation terminates before pending insertion, the call SHALL reject before connecting or posting to a replacement and the adapter SHALL remove that operation's one-shot response entry. Port disconnect, synchronous connect/send failure, and adapter disposal SHALL reject every request and pre-send reservation owned by the terminal generation exactly once and release every adapter-owned per-operation response entry, without hanging or automatically replaying `load` or `save`; stale and late traffic SHALL traverse no terminal operation callback, and only a later new application call with a new request ID may create a replacement Port and correlation. Provider-owned long-lived callback handles SHALL retain their existing refresh/re-registration lifetime and SHALL NOT be removed by this one-shot cleanup. The dedicated adapter SHALL use Port send/disconnect as its liveness authority, satisfy comctx heartbeat preflight locally, and transmit only actual one-shot PresenceStore operations. Offscreen SHALL register no broadcast Runtime-message listener for PresenceStore, so another context cannot forge a provider response or observe one through that adapter. The Offscreen document SHALL receive the dependency through host assembly and SHALL NOT dereference an unavailable `browser.storage.session`, create memory storage, or route presence records through tabs/pages. Firefox MV2 SHALL pass the same concrete session-backed store directly from its persistent Background Page into the same shared host. Storage rejection and authenticated-Port termination SHALL reach Session's existing request-local active-generation or release fences without acknowledging, discarding, or weakening the current local authority; a later call after Service Worker recreation SHALL reconnect and use the same session-backed active record.

The first accepted strict remote SESSION SHALL bind exact `user.id` and `joinedAt` to its source and `presenceId` in the observer ledger and record the current `name`/`avatar` projection. A SESSION with missing, malformed, non-finite, fractional, unsafe, or negative `joinedAt` SHALL fail closed before binding. A later SESSION for the same accepted generation SHALL accept a changed projection only when `user.id` and `joinedAt` match, while an equal projection is idempotent. A different `user.id` or `joinedAt` SHALL reject source-locally. Every rejected SESSION SHALL leave prior accepted binding, membership, projection, History, pending leave, and notices unchanged; it SHALL create no fallback timestamp, user-visible notice, or global recovery.

For one committed local generation, a remote generation SHALL be eligible for an observer-local join only when its accepted `joinedAt` is strictly greater than local `joinedAt` and that user transitions from zero displayed logical generations to one. Equal or earlier time SHALL be historical snapshot convergence even when both peer discovery and SESSION occur only after local commit. Peer discovery and `baselinePeerIds` MAY retain physical catch-up bookkeeping but SHALL NOT decide logical order. A later remote SESSION received during a provisional local attempt SHALL remain attempt-owned and invisible until that attempt commits; rollback or supersession SHALL emit nothing.

When PeerLeave removes the last current physical source bound to an accepted remote `presenceId`, Session SHALL start exactly one five-second pending-leave deadline for that presence and SHALL retain the generation in every online snapshot throughout the deadline. Another current physical source for the same presence prevents pending leave. Duplicate PeerLeave facts SHALL be idempotent and SHALL NOT restart or extend the deadline. A valid SESSION that rebinds the same `presenceId`, `user.id`, and `joinedAt` before expiry SHALL cancel the pending leave, fence its stale timer, preserve the current projection, and emit no leave or join. On expiry, if no current source has rebound that presence, Session SHALL remove only that generation and mark it ended in the bounded observer ledger. It SHALL persist one observer-local leave only when the user then has no other active or grace-preserved presence; otherwise it SHALL emit no leave.

An observer-local `ended` classification after expiry SHALL remain correctable because v5 has no peer-authored logical-end message. Session SHALL accept the same logical generation after expiry only when a strict SESSION arrives through the currently trusted Chat room generation from a currently admitted physical source, carries a physical `sessionId` different from the ended binding, exactly matches the observer's accepted `presenceId`, `user.id`, and `joinedAt`, and conflicts with no newer active binding or logical generation. Session SHALL then replace only the old physical binding, mark the same logical observation active, cancel or fence matching old physical-leave work, and converge membership without allocating a new logical generation, changing `joinedAt`, or emitting a duplicate logical join solely for the correction.

Arrival order alone SHALL NOT establish current authority. A SESSION from an untrusted or superseded room, source, attempt, or connection generation; an exact replay of the ended physical `sessionId`; a conflicting `user.id` or `joinedAt`; a binding superseded by a newer accepted logical generation; or delayed work from a prior physical generation SHALL remain rejected without changing current membership, History, projection, or notices. This classification SHALL apply consistently to initial join, manual reconnect, automatic recovery, same-domain page attach or reattach, return during grace, and supported Runtime host recovery. A path that retains one already-live connection SHALL neither manufacture a new physical or logical generation nor alter membership.

On graceful local release, Session SHALL remove its private active-generation record and allow Connection to leave the Chat room through the local release owner without sending a peer lifecycle message or creating a final-end transaction. The departing local client need not persist its own leave.

The local self-join notice SHALL be generation-scoped, persist immediately after successful new-generation join without waiting for History, and consume only Runtime private join provenance. Reconnect/recovery/host replacement SHALL not create a candidate; later true return SHALL use a later stable generation event time and produce a distinct notice. All SystemNotice records SHALL remain observer-local: they SHALL never be encoded or sent on the peer wire, included in History Pull/Push, or replayed from another peer's History. Sender-asserted `joinedAt` SHALL be authoritative only for observer-local notice ordering after strict source binding and SHALL NOT authorize identity, routing, resource admission, or a globally trusted total order under arbitrary clock skew.

#### Scenario: Chrome Offscreen mounts with background-owned durability

- **GIVEN** a Chrome MV3 Offscreen document does not expose `browser.storage.session` while the background Service Worker does
- **WHEN** the shared Runtime host mounts and Session loads or saves an active presence record
- **THEN** the Offscreen host SHALL remain available, the request SHALL use the private background PresenceStore adapter, and the exact session-backed active record or persistence rejection SHALL return without a volatile fallback or page relay

#### Scenario: Unauthorized extension contexts cannot access PresenceStore

- **GIVEN** content and options contexts know the deterministic Port name and comctx namespace
- **WHEN** either context opens the named Port and sends a valid `load` or `save` injector envelope
- **THEN** Background SHALL reject the transport source before comctx dispatch, return no lifecycle record, perform no storage write, and leave the active-record bytes unchanged

#### Scenario: Forged provider response cannot reach Offscreen

- **WHEN** a content, options, or other extension context broadcasts a provider-shaped response with the exact namespace and request id
- **THEN** the Offscreen PresenceStore injector SHALL receive nothing because it listens only to its background-owned point-to-point Port

#### Scenario: Service Worker recreation preserves the private route

- **WHEN** the accepted Port disconnects with a request in flight and the Service Worker provider is later recreated
- **THEN** every request owned by that Port SHALL reject through the existing request-local fence without replay, and only the next new `load`/`save` SHALL reconnect to the authenticated provider and use the retained active record

#### Scenario: Old provider completion cannot cross into a replacement Port

- **GIVEN** an authenticated request arrived through one Port and that binding detached before its provider operation completed
- **WHEN** a replacement authenticated Port becomes active and the old operation later produces its response
- **THEN** Background SHALL drop the old response because its original request binding no longer exists; the replacement Port SHALL receive nothing and Session SHALL not advance from that completion

#### Scenario: Terminal send failure settles every binding-owned request

- **GIVEN** one or more Offscreen PresenceStore requests are pending on the same Port
- **WHEN** a later send on that Port throws a disconnected-Port error before the asynchronous disconnect event is observed
- **THEN** every request owned by that terminal binding SHALL reject without timeout, the operation already accepted SHALL not be replayed, and only a later new request may create a new Port and correlation

#### Scenario: Pre-send request cannot migrate generations

- **GIVEN** comctx generated request IDs and registered one or more one-shot response callbacks against a live generation, but their `apply` messages have not entered the pending registry
- **WHEN** that generation disconnects before those messages can be posted
- **THEN** every prepared call SHALL reject through its original generation, no replacement Port SHALL receive any original `load`/`save` bytes, and only a later application call with a new request ID may connect and settle

#### Scenario: Terminal operations release adapter-owned response entries

- **GIVEN** one-shot `load` or `save` operations registered response callbacks before or after pending insertion on one generation
- **WHEN** connect, post, disconnect, termination, or disposal makes that generation terminal
- **THEN** every affected operation SHALL reject, every adapter-owned response entry and reservation SHALL return to baseline, stale or late responses SHALL settle nothing, no original bytes SHALL migrate to a replacement, and a later fresh request SHALL use a new correlation

#### Scenario: Dispose settles a prepared first call

- **GIVEN** a one-shot call registered its response callback while no Port was open and its `apply` has not started
- **WHEN** the Offscreen adapter is disposed
- **THEN** the call SHALL reject locally, its adapter-owned response entry SHALL be released, no Port SHALL open, and no PresenceStore operation SHALL be posted

#### Scenario: Firefox uses the equivalent direct store

- **WHEN** Firefox MV2 mounts the shared Runtime in its persistent Background Page
- **THEN** host assembly SHALL pass the concrete session-backed PresenceStore directly and preserve the same strict active record, rejection semantics, and supported replacement behavior

#### Scenario: Six-timepoint A/B/C/D lifecycle

- **GIVEN** independent actual Runtime Server/Session/Connection stacks use deterministic in-repo transport, A is an existing observer, B is a new local user, C is an additional physical source for B's generation, and D is B's replacement Runtime host
- **WHEN** the control executes preparation baseline, B first join, duplicate/C publication, transient B loss/D same-presence recovery inside grace, D physical departure with grace expiry, and B later returns with a new logical generation after completed local release
- **THEN** B and A SHALL each persist one join for the first logical transition; duplicate/C/loss/recovery SHALL add no notice; A SHALL keep B online during leave grace and persist one leave only on expiry; and the later true return SHALL persist one fresh self join plus one fresh observer join

#### Scenario: Delayed discovery uses logical join order

- **GIVEN** A logically joined before B, but B discovers A and receives A's SESSION only after B commits
- **WHEN** A's accepted `joinedAt` is less than or equal to B's local `joinedAt`
- **THEN** B SHALL converge A into the current membership snapshot without persisting `A joined the chat`, while A SHALL persist B's later join once

#### Scenario: Equal logical time is not later

- **GIVEN** B has committed its local logical generation and has no displayed generation for remote A
- **WHEN** B first accepts A's strict SESSION with `joinedAt` equal to B's local `joinedAt`
- **THEN** B SHALL converge A as historical snapshot State without an A join notice

#### Scenario: A-before-B is invariant across delivery timing

- **GIVEN** A's accepted logical generation began before B's and remains displayed
- **WHEN** B receives A discovery and the strict historical SESSION before B commit, split across B commit in either order, or both only after B commit
- **THEN** B SHALL converge membership with exactly `[B joined]`, A SHALL converge with exactly `[A joined, B joined]`, and no delivery order or receiver clock SHALL create an `A joined` notice for B

#### Scenario: Missing or invalid logical time cannot create membership

- **GIVEN** a source sends a v5 SESSION with missing or invalid `joinedAt`, or mutates `joinedAt` after its generation was accepted
- **WHEN** the Runtime parses or applies that frame
- **THEN** it SHALL reject the complete SESSION source-locally, preserve every prior accepted fact, synthesize no receiver-local replacement time, persist no SystemNotice, and leave other sources operational

#### Scenario: Later zero-to-one generation creates one local notice only

- **GIVEN** B is committed and no active or grace-preserved generation for remote C is displayed
- **WHEN** B accepts C's strict SESSION with `joinedAt` greater than B's local time and C transitions from zero displayed generations to one
- **THEN** B SHALL persist exactly one observer-local `C joined` SystemNotice, duplicates and physical recovery SHALL add none, and that notice SHALL never enter peer wire or History exchange

#### Scenario: Provisional later join becomes visible only on commit

- **GIVEN** B's local join is provisional and later C sends a valid SESSION whose `joinedAt` is strictly greater than B's
- **WHEN** B's attempt commits, rolls back, or is superseded
- **THEN** C's join candidate SHALL become observable exactly once only on commit and SHALL produce no membership or notice from rolled-back or superseded work

#### Scenario: PeerLeave keeps the user online during grace

- **GIVEN** a bound remote presence has lost its last current physical source
- **WHEN** fewer than five seconds have elapsed and no valid same-presence SESSION has rebound
- **THEN** every online snapshot SHALL continue to display that presence and user, and Session SHALL emit no leave

#### Scenario: Same-presence recovery cancels leave

- **GIVEN** a bound remote presence is pending physical-leave expiry
- **WHEN** a current source publishes a valid SESSION with the same `presenceId`, `user.id`, and `joinedAt` before five seconds elapse
- **THEN** Session SHALL cancel the pending leave, fence the old deadline, preserve membership, and emit neither leave nor join

#### Scenario: Grace expiry removes only the affected presence

- **GIVEN** a remote presence remains without a current source through its full five-second leave grace
- **WHEN** the pending-leave deadline expires
- **THEN** Session SHALL remove that presence exactly once, mark its observer record ended, and persist one leave only if the user has no other active or grace-preserved presence

#### Scenario: Another presence suppresses final-user leave

- **GIVEN** one user's presence is expiring while that user has another active or grace-preserved presence
- **WHEN** the first presence reaches its leave deadline
- **THEN** Session SHALL remove only the expired presence, keep the user displayed online, and emit no leave or compensating join

#### Scenario: Physical loss remains provisional

- **WHEN** a bound presence loses its last physical source and later republishes the same generation within five seconds
- **THEN** Session SHALL keep the presence displayed throughout, cancel the pending leave on the valid rebind, and emit no leave/join pair

#### Scenario: Observer-stale expiry can be corrected by current provenance

- **GIVEN** five-second expiry removed a presence and recorded its observer-local leave, but the same remote logical generation remains online
- **WHEN** a currently admitted source in the current trusted room generation publishes a strict SESSION with a new physical `sessionId` and the exact accepted `presenceId`, `user.id`, and `joinedAt`, with no newer binding or logical generation conflict
- **THEN** Session SHALL replace the ended physical binding, classify the same logical observation active, converge membership, and emit no duplicate logical join solely for the correction

#### Scenario: Manual reconnect accepts a new physical binding for the same logical presence

- **GIVEN** a remote logical presence is observer-stale `ended`, its peer remains logically online, and manual reconnect establishes a current trusted source with a new physical `sessionId`
- **WHEN** that source sends a strict SESSION matching the ended record's `presenceId`, `user.id`, and `joinedAt`
- **THEN** Session SHALL accept the new physical binding, classify the same logical observation active, converge membership, and emit no duplicate logical join solely for the correction

#### Scenario: Automatic recovery accepts the current physical replacement

- **GIVEN** automatic connection recovery replaces a physical source for a retained logical generation after an observer marked its old physical binding ended
- **WHEN** the current trusted replacement publishes a new `sessionId` with the exact accepted logical identity and time
- **THEN** Session SHALL accept and converge the retained generation without requiring AppButton Refresh or complete domain release

#### Scenario: Page lifecycle cannot preserve a stale observer rejection

- **GIVEN** same-domain attach or reattach, return during grace, or supported host recovery can receive SESSION for an existing logical `presenceId`
- **WHEN** its current trusted physical source proves a new strictly matching session binding
- **THEN** Session SHALL accept and converge that binding even if restored observer state was `ended`, while a path that merely retains one live connection SHALL neither manufacture a new physical or logical generation nor alter membership

#### Scenario: Exact ended physical session replay remains rejected

- **GIVEN** an observer ended one physical binding for a logical presence
- **WHEN** a delayed or duplicated SESSION carries that ended binding's same `sessionId`
- **THEN** Session SHALL reject it and SHALL NOT reactivate membership, change projection, restart History, or create a lifecycle notice

#### Scenario: Superseded transport work cannot claim current authority

- **GIVEN** a new room, source, attempt, or connection generation owns current SESSION admission
- **WHEN** a prior room, source, attempt, or generation callback delivers a matching or mutated SESSION after supersession
- **THEN** Session SHALL reject or ignore it before observer correction, and only the current trusted physical generation MAY establish a binding

#### Scenario: Logical identity conflict is not a legal rebind

- **GIVEN** an ended observer record binds one `presenceId` to exact `user.id` and `joinedAt`
- **WHEN** a SESSION reuses that `presenceId` with a different user, a different logical join time, or after a newer accepted generation superseded it
- **THEN** Session SHALL reject the SESSION source-locally and preserve all current accepted membership, projection, History, and notices

#### Scenario: Freshness requires evidence rather than last arrival

- **WHEN** multiple SESSION frames for an observer-stale presence arrive in different orders
- **THEN** acceptance SHALL be determined by current trusted physical membership, a new physical binding, exact logical identity, and generation fencing rather than wall clock or arrival order

#### Scenario: Duplicate and late lifecycle facts

- **WHEN** PeerLeave is duplicated, an unbound source leaves, SESSION is duplicated, an accepted generation changes identity, an exact ended physical session replays, or an observer-stale generation presents a current-provenance replacement
- **THEN** Session SHALL start or cancel at most one matching deadline, reject mutation and stale replay, accept only the strictly proven replacement, preserve every unrelated presence, and persist no duplicate notice
