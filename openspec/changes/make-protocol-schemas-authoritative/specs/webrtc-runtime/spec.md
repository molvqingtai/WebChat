## ADDED Requirements

### Requirement: Protocol validation occurs at exactly two boundaries

The Runtime SHALL parse protocol messages at exactly two boundaries: once when accepting a decoded peer payload and once when loading a message from local persistence. Both boundaries SHALL use the complete static declarative schema exported by `src/protocol`; a declarative local record schema MAY compose that protocol schema with local-only structural fields. A parse failure at either boundary SHALL discard the value before it changes Runtime state, persistence projection, unread state, notifications, system notices, History progress, or page output. The failure SHALL produce no Toast or other user-visible feedback.

The local record schema SHALL use no callback, custom schema, transform, contextual schema factory, or post-parse predicate. It SHALL validate only declaratively expressible structure. Relationships among a database key, nested message ID, nested user ID, or other local/protocol identities SHALL not be validated and SHALL have no handwritten fallback.

No local producer, outbound send, persistence write, History supplier, clock adoption, Session/History consumer, or intermediate Runtime path SHALL parse or manually revalidate an already typed protocol value. Non-protocol authorization, ownership, lifecycle, resource scheduling, and codec representation decisions remain outside this rule, but SHALL NOT inspect message properties to recreate protocol validation.

#### Scenario: Invalid inbound peer value is discarded once

- **WHEN** the codec decodes a peer payload but the room-selected complete schema rejects it at Wire acceptance
- **THEN** no typed message event SHALL be emitted, no downstream Domain SHALL inspect or revalidate the rejected value, and no Toast or other user-visible feedback SHALL appear

#### Scenario: Corrupted local value is discarded on load

- **WHEN** a locally stored message was manually modified and the static local-record schema composed with the protocol schema declaratively rejects it during a read
- **THEN** that record SHALL be omitted from the loaded result and all projections, with no Toast or other user-visible feedback

#### Scenario: Unsupported local identity relationships are absent

- **WHEN** a stored row is structurally valid but a database key or local identity differs from a nested message or user identity
- **THEN** schema parsing SHALL NOT reject it through a callback, post-parse predicate, or other fallback relationship check

#### Scenario: Outbound production does not validate protocol shape

- **WHEN** local code constructs, stores, supplies, or sends a typed protocol message
- **THEN** those paths SHALL perform no protocol schema parse, post-parse predicate, or manual field/resource validation; the receiving peer remains responsible for its own inbound parse

#### Scenario: Accepted values are not revalidated

- **WHEN** Wire emits a typed schema-accepted peer message or `MessageStore` returns a typed schema-accepted record
- **THEN** Session, History, persistence, projection, and delivery paths SHALL consume that value without another protocol validation stage

### Requirement: Local domain release uses one five-second lifecycle grace

When the last authoritative physical tab binding of a domain is removed because the trusted tab closed, lost content eligibility, or moved to another Runtime domain, `LifecycleDomain` SHALL uniquely own one unified five-second local-domain grace phase and deadline. Page ping, heartbeat, Port, visibility, freeze, discard, page-context detach, and connectivity timeout SHALL NOT start this grace while the physical tab binding remains. During grace, Connection SHALL retain that domain's ChatRoom connection, Session/History SHALL retain domain State, Delivery SHALL retain the volatile inbound un-ACK buffer, and World SHALL retain domain presence.

On local-domain grace expiry, the Lifecycle domain-released Event SHALL begin one fenced release. Session SHALL remove the local active-generation authority through its existing private local-persistence boundary, and Session, History, Delivery, and World SHALL release only that domain's owned State. Connection SHALL physically leave Chat and the last World room after required local cleanup; it SHALL produce no Chat end message and SHALL wait on no end-send, retry, settlement, or settled-cleanup state. The release fence SHALL reject text/reaction allocation and live send only from release start through physical departure. A trusted eligible tab binding for the same domain that returns during local-domain grace SHALL cancel that grace and read the current Runtime snapshot without a false offline/online transition.

Remote logical leave is independent: Artico physical departure starts the observer-side Session grace defined below. No persistent outbound outbox, delivery-status retry, or final-end record survives a completed local release; only the separately specified volatile inbound un-ACK buffer participates in the local lifecycle.

#### Scenario: Refresh within local-domain grace boundary

- **WHEN** a user refreshes the only eligible tab of a domain and its old page context disconnects before the new document attaches
- **THEN** the background SHALL retain the same physical tab binding, local-domain grace SHALL not start, and the domain connection and State SHALL continue without rejoin flapping, presence flicker, or message loss caused by the refresh

#### Scenario: Connectivity loss does not impersonate domain release

- **GIVEN** the only eligible tab of a domain remains open
- **WHEN** its ping, heartbeat, Port, visibility, frozen, discarded, or page-context attachment state is lost
- **THEN** bounded connectivity recovery MAY run, but no local-domain grace or physical room departure SHALL begin and remote membership SHALL remain unchanged

#### Scenario: Application reconnect preserves the logical generation

- **GIVEN** the application Reconnect Effect retains the frozen `leaveRoom()` then `joinRoom(command)` composition
- **WHEN** the Runtime ChatRoom implementation executes that composition for an active domain
- **THEN** `leaveRoom()` SHALL invoke current-domain Runtime reconnect rather than local final release, the replacement physical Chat session SHALL reuse the same `presenceId`, and a remote PeerLeave followed by the same presence within five seconds SHALL produce neither a confirmed leave nor another join; the Domain child SHALL NOT mutate the World registration registry, while the same ready-state AppButton action SHALL independently run the separately fenced World replacement defined by the manual Refresh contract

#### Scenario: Local active-generation cleanup rejects

- **GIVEN** a committed active local presence and a PresenceStore operation that rejects removal of its active record
- **WHEN** local final release begins
- **THEN** the release SHALL retain its current fence and physical membership, create no final-end state or wire value, and surface the existing retryable request-local failure without allowing allocation or live send to bypass the current release owner

#### Scenario: Local cleanup succeeds after storage recovery

- **GIVEN** a prior local release was fenced by active-record cleanup rejection and the PresenceStore later recovers
- **WHEN** release is requested again
- **THEN** Session SHALL remove the local active-generation record once, release its domain State, and allow Connection to leave Chat and the last World room without publishing any Chat lifecycle message

#### Scenario: Release fence has one current phase

- **GIVEN** Session owns a current local release that has not physically departed
- **WHEN** the current or replacement host requests text allocation, reaction allocation, or live Chat send
- **THEN** both Server preflight and the authoritative Session Command SHALL reject before HLC allocation or Wire send, and the fence SHALL disappear with completed physical domain release rather than transition through end-specific states

#### Scenario: Host replacement continues only current local cleanup

- **GIVEN** local active-generation cleanup or physical departure is unsettled when the Runtime host is replaced
- **WHEN** the replacement host restores the same domain operation
- **THEN** it SHALL continue only the current local cleanup/release ownership, SHALL publish no Chat end value, and SHALL expose no duplicate active authority or final-end marker

#### Scenario: Readiness helper distinguishes mounted UI from convergence

- **WHEN** automated acceptance observes an already-mounted usable chat textarea after a refresh or restart
- **THEN** the helper SHALL accept that UI readiness immediately; a separate bounded eventual membership/presence wait MAY guard against a hang, and the five-second local-domain grace SHALL NOT be treated as a UI-convergence deadline

#### Scenario: Local-domain grace expiry

- **WHEN** no eligible physical tab binding for the domain returns within five seconds and required local cleanup succeeds
- **THEN** the ChatRoom connection, Runtime domain State, volatile inbound un-ACK delivery buffer, and WorldRoom presence for that domain SHALL all be released or removed without an outbound lifecycle frame or persistent final-end retry

#### Scenario: Event outside local-domain grace

- **WHEN** an inbound event targets a domain that is unregistered or past its local-domain grace
- **THEN** the system SHALL discard the event because no persistence location exists for it

## MODIFIED Requirements

### Requirement: Immutable peer values terminate in explicit Domain mappings

`WireDomain` SHALL terminate every protocol DTO at one typed accepted-message Event and SHALL NOT expose raw provider callbacks, decoded unknown values, or a shared mutable wire model. `SessionMessage` SHALL enter Session binding/generation commit Commands. `TextMessage` and `ReactionMessage` SHALL enter Session source/user validation and then Delivery admission. `HistoryMessagesPull` and `HistoryMessagesPush` SHALL enter History Commands; History SHALL verify the current trusted source/session binding through a Session Query before its requester/provider transition, with accepted Push batches entering Delivery atomically. `WorldRoomMessage` SHALL enter World source-snapshot replacement. Provider peer-ready/leave and room-close/error facts SHALL enter Connection transitions; a trusted PeerLeave for a bound Chat source SHALL reach Session's physical-source departure Command, while Connection requests World/History cleanup through their named Commands rather than mutating those Domains.

Outbound `SessionMessage` SHALL originate from Session after an accepted Connection generation. No outbound Chat lifecycle-end value exists. Outbound Text/Reaction SHALL use Session-owned id/HLC allocation and a Wire send Command. History Pull/Push SHALL originate from History State and page-supply outcomes. `WorldRoomMessage` SHALL originate from World's current full snapshot only after Connection acceptance. All outbound values SHALL use the strict current schemas and codec algorithm.

#### Scenario: Chat message crosses one trust and delivery path

- **WHEN** Wire accepts a TextMessage or ReactionMessage from a transport-confirmed source
- **THEN** Session SHALL validate the committed source/user binding before Delivery receives one admit Command, and no other Domain or adapter SHALL store a parallel writable copy

#### Scenario: History response crosses one owner path

- **WHEN** Wire accepts a `HistoryMessagesPush`
- **THEN** History SHALL first verify the current trusted source/session binding through a Session Query, then validate its requester/provider/page/budget State and issue at most one atomic Delivery batch admission, without Wire, Server, or the ChatRoom adapter owning the History session

#### Scenario: World snapshot crosses one owner path

- **WHEN** Wire accepts a WorldRoomMessage or Connection accepts a generation that must publish local presence
- **THEN** World SHALL be the only source-snapshot/presence owner and SHALL replace or publish one full current snapshot through the current protocol

#### Scenario: Physical leave crosses one lifecycle path

- **WHEN** the provider reports PeerLeave for a transport-confirmed Chat source
- **THEN** Connection SHALL route that source fact to Session's physical-departure Command, Session SHALL own the pending logical-presence grace, and no decoded peer message or second Domain SHALL classify the leave

### Requirement: Session classifies logical presence across physical lifecycles

Session SHALL uniquely own local active-generation State, a bounded remote observer ledger, physical-source bindings, and one pending physical-leave deadline per affected remote presence. A private two-method `PresenceStoreExtern` SHALL persist only the local active-generation record through `browser.storage.session` across supported Runtime host replacement; it SHALL NOT expand MessageStore, the origin database schema, `RuntimeServer`, `ChatRoomExtern`, or any UI/public model. No in-flight end, retryable pending end, settled cleanup, observer end marker, or other final-end record SHALL exist. Session SHALL allocate exact `{presenceId, joinedAt}` only for initial join or true return after completed local release. Refresh, reconnect, recovery, replay, duplicate SESSION, additional physical session, page reattach, and supported host replacement SHALL reuse the retained generation and logical time and emit snapshot convergence without a logical join/leave.

Chrome MV3 SHALL construct the concrete session-backed PresenceStore in the background Service Worker and expose only its existing `load`/`save` methods to the Offscreen Runtime through a dedicated comctx adapter over a point-to-point Runtime Port. Port name and comctx namespace SHALL be routing values rather than authority. Before delivering a message, Background SHALL require the transport sender's runtime id, exact Offscreen document URL, and absence of a tab; content, options, and every other extension source SHALL be disconnected without reading or writing durable state. Every provider response SHALL resolve through the exact request-to-Port binding recorded when its request arrived. If that binding has detached or been replaced, the response SHALL be dropped and SHALL NOT fall back to the current active Port. Offscreen SHALL admit a response only while that request remains pending on the same binding; uncorrelated, replayed, old-binding, wrong-namespace, wrong-direction, and broadcast responses SHALL reach no comctx callback. From request-ID response registration, each one-shot call SHALL reserve exactly one ordered transport generation. Generic response subscription SHALL NOT open a Port. The local heartbeat response subscription SHALL unregister before the actual `apply`, and that `apply` SHALL consume the oldest remaining request reservation. If the reserved generation terminates before pending insertion, the call SHALL reject before connecting or posting to a replacement and the adapter SHALL remove that operation's one-shot response entry. Port disconnect, synchronous connect/send failure, and adapter disposal SHALL reject every request and pre-send reservation owned by the terminal generation exactly once and release every adapter-owned per-operation response entry, without hanging or automatically replaying `load` or `save`; stale and late traffic SHALL traverse no terminal operation callback, and only a later new application call with a new request ID may create a replacement Port and correlation. Provider-owned long-lived callback handles SHALL retain their existing refresh/re-registration lifetime and SHALL NOT be removed by this one-shot cleanup. The dedicated adapter SHALL use Port send/disconnect as its liveness authority, satisfy comctx heartbeat preflight locally, and transmit only actual one-shot PresenceStore operations. Offscreen SHALL register no broadcast Runtime-message listener for PresenceStore, so another context cannot forge a provider response or observe one through that adapter. The Offscreen document SHALL receive the dependency through host assembly and SHALL NOT dereference an unavailable `browser.storage.session`, create memory storage, or route presence records through tabs/pages. Firefox MV2 SHALL pass the same concrete session-backed store directly from its persistent Background Page into the same shared host. Storage rejection and authenticated-Port termination SHALL reach Session's existing request-local active-generation or release fences without acknowledging, discarding, or weakening the current local authority; a later call after Service Worker recreation SHALL reconnect and use the same session-backed active record.

The first accepted strict remote SESSION SHALL bind exact `user.id` and `joinedAt` to its source and `presenceId` in the observer ledger and record the current `name`/`avatar` projection. A SESSION with missing, malformed, non-finite, fractional, unsafe, or negative `joinedAt` SHALL fail closed before binding. A later SESSION for the same accepted generation SHALL accept a changed projection only when `user.id` and `joinedAt` match, while an equal projection is idempotent. A different `user.id` or `joinedAt` SHALL reject source-locally. Every rejected SESSION SHALL leave prior accepted binding, membership, projection, History, pending leave, and notices unchanged; it SHALL create no fallback timestamp, user-visible notice, or global recovery.

For one committed local generation, a remote generation SHALL be eligible for an observer-local join only when its accepted `joinedAt` is strictly greater than local `joinedAt` and that user transitions from zero displayed logical generations to one. Equal or earlier time SHALL be historical snapshot convergence even when both peer discovery and SESSION occur only after local commit. Peer discovery and `baselinePeerIds` MAY retain physical catch-up bookkeeping but SHALL NOT decide logical order. A later remote SESSION received during a provisional local attempt SHALL remain attempt-owned and invisible until that attempt commits; rollback or supersession SHALL emit nothing.

When PeerLeave removes the last current physical source bound to an accepted remote `presenceId`, Session SHALL start exactly one five-second pending-leave deadline for that presence and SHALL retain the generation in every online snapshot throughout the deadline. Another current physical source for the same presence prevents pending leave. Duplicate PeerLeave facts SHALL be idempotent and SHALL NOT restart or extend the deadline. A valid SESSION that rebinds the same `presenceId`, `user.id`, and `joinedAt` before expiry SHALL cancel the pending leave, fence its stale timer, preserve the current projection, and emit no leave or join. On expiry, if no current source has rebound that presence, Session SHALL remove only that generation and mark it ended in the bounded observer ledger. It SHALL persist one observer-local leave only when the user then has no other active or grace-preserved presence; otherwise it SHALL emit no leave. A SESSION for an expired generation SHALL NOT resurrect it.

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
- **WHEN** the control executes preparation baseline, B first join, duplicate/C publication, transient B loss/D same-presence recovery inside grace, D physical departure with grace expiry, and B later return
- **THEN** B and A SHALL each persist one join for the first logical transition; duplicate/C/loss/recovery SHALL add no notice; A SHALL keep B online during leave grace and persist one leave only on expiry; and later return SHALL persist one fresh self join plus one fresh observer join

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
- **THEN** Session SHALL remove that presence exactly once and persist one leave only if the user has no other active or grace-preserved presence

#### Scenario: Another presence suppresses final-user leave

- **GIVEN** one user's presence is expiring while that user has another active or grace-preserved presence
- **WHEN** the first presence reaches its leave deadline
- **THEN** Session SHALL remove only the expired presence, keep the user displayed online, and emit no leave or compensating join

#### Scenario: Physical loss remains provisional

- **WHEN** a bound presence loses its last physical source and later republishes the same generation within five seconds
- **THEN** Session SHALL keep the presence displayed throughout, cancel the pending leave on the valid rebind, and emit no leave/join pair

#### Scenario: Duplicate and late lifecycle facts

- **WHEN** PeerLeave is duplicated, an unbound source leaves, a SESSION is duplicated, an accepted generation changes identity, or an expired generation republishes
- **THEN** Session SHALL start or cancel at most one matching deadline, reject mutation or resurrection, preserve every unrelated presence, and persist no duplicate notice

## REMOVED Requirements

### Requirement: Unified five-second lifecycle grace

**Reason**: The former requirement coupled local page-domain grace to a peer end transaction. Current local release and remote PeerLeave grace are independent owners and no peer end transaction exists.

**Migration**: `Local domain release uses one five-second lifecycle grace` retains current page-domain behavior and local cleanup. `Session classifies logical presence across physical lifecycles` owns the separate five-second remote online grace after Artico PeerLeave.
