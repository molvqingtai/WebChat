## ADDED Requirements

### Requirement: Artico room demand repairs a retained disconnected peer

The private Artico RoomTransport provider SHALL maintain this invariant: while desired room demand is non-empty, it owns either one non-terminal peer generation or exactly one restart capable of creating it. When `join(roomId)` changes demand from empty to non-empty and the retained peer is already `disconnected`, the provider SHALL enter the same generation-owned restart used by close recovery before that join waits for physical readiness. It SHALL NOT depend on receiving a future duplicate `close` event for a state transition that already occurred.

Concurrent Chat and World demand, repeated joins, a close-driven restart, and a delayed restart timer SHALL converge on one replacement owner. Every peer callback and timer SHALL be generation-fenced so an old peer cannot join current rooms, reject or settle current work, or replace a newer peer. `leave()` SHALL remove only its room's demand; `dispose()` SHALL cancel owned restart work and settle pending joins once. The host-lifetime peer id SHALL remain stable across replacement peers. This repair SHALL add no unbounded retry loop, connecting watchdog, page-owned peer, or public ChatRoom method.

#### Scenario: Fresh demand replaces an already disconnected peer

- **GIVEN** desired rooms are empty and the retained Artico peer is already `disconnected` after its one close edge was observed while no room was desired
- **WHEN** a later Chat or World `join(roomId)` adds fresh demand
- **THEN** the provider SHALL create or await exactly one current replacement before the join waits for readiness and SHALL not wait for another close event from the old peer

#### Scenario: Concurrent room demand shares one restart

- **GIVEN** a disconnected retained peer and no desired room
- **WHEN** Chat and World joins arrive concurrently or repeatedly while replacement is pending
- **THEN** all current demand SHALL share one restart owner, one replacement peer generation, and the current room joins without duplicate peers or timers

#### Scenario: Stale callbacks cannot affect replacement

- **GIVEN** one peer generation has been superseded by a replacement
- **WHEN** the old peer emits delayed open, error, or close, or its delayed restart timer fires
- **THEN** that stale work SHALL not join a room, settle current pending work, schedule another current replacement, or alter the new peer generation

#### Scenario: Leave and dispose settle owned recovery

- **WHEN** a room leaves or the provider is disposed while restart or readiness work is pending
- **THEN** only the matching desired demand SHALL be removed, dispose SHALL cancel all owned restart work, and every affected pending join SHALL settle exactly once without an automatic unbounded loop

### Requirement: Same-domain supersession is internal cancellation

Connection SHALL preserve newest-wins generation fencing for overlapping same-domain join, identity refresh, host recovery, and manual Refresh attempts. Replacing an older attempt SHALL produce one machine-classified internal cancellation rather than an ordinary message-only error. Cancellation SHALL settle the old caller and its cleanup, but SHALL emit no `Room.OnErrorEvent`, generic error Toast, success result, committed join, or stale identity/presence. The cancelled attempt SHALL not clear or overwrite a newer request, snapshot, user/site input, button pending state, or feedback owner.

Only the winning attempt SHALL own the real operation success or failure and current identity convergence for every attached same-domain page. `user.id` and the logical generation time SHALL remain immutable binding facts, while the winning same-id `name`/`avatar` refresh SHALL replace the current user projection across those pages without a logical join, leave, or notice; an equal projection SHALL be idempotent. Initial join and recovery state SHALL return from cancelled work without remaining stuck in loading. Every genuine provider, protocol, persistence, Runtime, and join failure SHALL continue through its existing error/Toast path. Cancellation SHALL NOT be recognized by comparing `error.message`, translated text, or Toast copy, and SHALL not introduce a second operation/pending/error owner.

#### Scenario: Superseded identity refresh is silent and settled

- **GIVEN** two same-domain pages trigger overlapping identity refresh attempts and the newer generation supersedes the older
- **WHEN** the old operation settles its cancellation
- **THEN** it SHALL release only its own pending state, emit no error Toast or false success, retain no stale identity input, and leave the newer attempt as the sole current owner

#### Scenario: Manual recovery and host recovery retain the winner

- **GIVEN** avatar refresh overlaps manual Refresh or Runtime host recovery
- **WHEN** completion and failure callbacks arrive in any order
- **THEN** only the newest current attempt SHALL commit identity, presence, snapshot, and terminal feedback; every stale callback SHALL be unable to clear or overwrite it

#### Scenario: Genuine failure remains visible

- **GIVEN** the current winning attempt fails for a real provider, protocol, persistence, Runtime, or join reason rather than supersession
- **WHEN** the operation settles
- **THEN** the existing request-local error path and generic Toast SHALL remain observable, and the application SHALL return to its defined retryable state

### Requirement: Content RPC routing ignores only URL fragment

Content-script eligibility, Runtime domain identity, page lease identity, and cross-context RPC target equivalence SHALL treat `URL.hash` as an in-document position rather than document identity. The Runtime domain SHALL remain `document.location.origin`. Background and Offscreen routing SHALL preserve the exact trusted tab id supplied by extension sender context and compare one canonical document-navigation identity containing scheme, host, port, path, and query while excluding only fragment. Payload-supplied tab identity SHALL not become trusted.

A direct page URL containing a fragment SHALL complete coordinator/Runtime attachment and mount the existing Shadow UI exactly once. Changing only hash after mount or during the initial handshake SHALL retain the same page id, lease, Runtime domain, logical presence, and UI mount; it SHALL produce no join/leave or remount. A real navigation that changes the document, path, or query MAY replace the page through the existing unload/new-content lifecycle, but a response owned by the prior document SHALL not settle the new one. Recycled tab id, wrong tab, untrusted sender, wrong namespace/direction, missing target, and stale provider response SHALL remain denied.

The repair SHALL not query or broadcast to every same-origin tab, route by origin alone, remove response correlation, add fragment-specific business logic, or add a pre-App loading/unavailable/Retry/status fallback. The existing bootstrap SHALL still mount only after valid `initClient()` settlement; this change restores that exact response route.

#### Scenario: Direct fragment URL mounts the control

- **WHEN** a supported HTTPS page opens directly at a URL such as `https://www.v2ex.com/t/1230408#reply1`
- **THEN** the content client SHALL complete its first Runtime RPC route and mount exactly one existing WebChat control without stripping or navigating away from the visible fragment

#### Scenario: Mounted hashchange preserves one client

- **GIVEN** the WebChat control is mounted and joined
- **WHEN** only `location.hash` changes
- **THEN** the same page id, lease, domain, UI mount, and logical presence SHALL remain, with zero reconnect, join, leave, or lifecycle notice

#### Scenario: In-flight hashchange preserves the first handshake

- **GIVEN** content bootstrap has started but the first coordinator or Runtime response has not settled
- **WHEN** the page changes from one fragment to another
- **THEN** the trusted response SHALL still route to that same live document, `initClient()` SHALL settle once, and exactly one control SHALL mount

#### Scenario: Real navigation keeps stale-response protection

- **GIVEN** a provider response is correlated to one tab and canonical document-navigation identity
- **WHEN** that tab is recycled or genuinely navigates to a different scheme, host, port, path, or query before the response arrives
- **THEN** the old response SHALL be rejected and SHALL not settle the replacement page, while another same-origin tab receives nothing

### Requirement: ClientLease recovery and connecting feedback are bounded

Each ClientLease lifecycle SHALL own at most one current startup or recovery generation. Repeated watchdog failure, generation/host-id/page-attachment mismatch, and overlapping recovery calls SHALL share that generation rather than issue parallel attach sequences or reset its budget. The existing 15,000ms startup/recovery timeout SHALL be one overall generation deadline. Every `registerPage()` and `attachPage()` attempt SHALL have a hard deadline no greater than 5,000ms and no greater than the generation's remaining budget. Expiry SHALL cancel that request's local ownership and reject the attempt; bounded retry MAY continue only inside the original overall deadline.

A fresh `init()` or `detach()` SHALL abort the prior lifecycle and retire its requests. A response or rejection from an expired, aborted, detached, or superseded request SHALL be ignored and SHALL NOT publish HostPhase, replace a snapshot, start a watchdog, settle a newer recovery, or detach/unregister the current winning lease. Host replacement, Port loss, missing response, and a provider that remains pending forever SHALL therefore settle the current generation as `ready` after one valid current attachment or `unavailable` when its original budget is exhausted. No path SHALL leave HostPhase permanently `connecting`.

Readiness presentation SHALL remain downstream of Runtime truth. A page refresh that attaches to an already healthy retained Runtime within the 300ms presentation grace SHALL create one current page lease and SHALL publish neither `WebChat connecting` nor `Ready to chat`. A real current connecting transition that survives the grace MAY publish the existing stable loading entry. Once visible, that entry SHALL be dismissed by current ready or replaced by unavailable no later than the original 15,000ms deadline. The grace SHALL NOT delay operation, extend the recovery budget, add another readiness state, or survive ready, unavailable, detach, remount, or a newer recovery. No alternate bootstrap UI, Toast renderer, structure, or visual style SHALL be added.

#### Scenario: Healthy retained Runtime refresh stays silent

- **GIVEN** the Runtime host remains healthy and ready while one content document is refreshed
- **WHEN** the new page lifecycle registers and attaches within the 300ms feedback grace
- **THEN** exactly one current page lease and application mount SHALL result, with no `WebChat connecting`, `Ready to chat`, unavailable feedback, host replacement, or logical join/leave caused by the refresh

#### Scenario: Pending register or attach cannot exceed its deadline

- **GIVEN** the current `registerPage()` or `attachPage()` attempt never resolves or rejects
- **WHEN** its 5,000ms per-RPC deadline and then the generation's original 15,000ms overall deadline elapse
- **THEN** each expired request SHALL lose settlement ownership, retry SHALL remain bounded by the original budget, and the generation SHALL settle unavailable rather than remain connecting

#### Scenario: Rejection or control-plane loss can recover within the budget

- **GIVEN** register/attach rejects, its Port or response route is lost, or the host is replaced during recovery
- **WHEN** a later current attempt attaches a valid replacement before the original overall deadline
- **THEN** the shared recovery generation SHALL settle ready once with the replacement snapshot and SHALL cancel any pending connecting-feedback timer

#### Scenario: Concurrent recovery signals share one owner

- **GIVEN** a watchdog failure and one or more generation, host-id, or page-lease mismatch signals overlap
- **WHEN** recovery is already in flight for the current lifecycle
- **THEN** every signal SHALL join one recovery task, deadline, register/attach sequence owner, and feedback generation without parallel attempts or budget reset

#### Scenario: Late response cannot affect the winner

- **GIVEN** an old RPC expired, was aborted by detach/init, or belongs to a superseded recovery, and a newer current lease exists
- **WHEN** the old RPC later resolves or rejects
- **THEN** it SHALL not publish ready/unavailable, replace the snapshot, start a watchdog, clear current feedback, settle the newer task, or release the winner's lease

#### Scenario: Visible connecting always reaches a terminal state

- **GIVEN** current recovery remains connecting beyond the 300ms presentation grace and the stable loading entry becomes visible
- **WHEN** a current attachment succeeds or the original recovery budget expires
- **THEN** the same readiness entry SHALL settle to dismissal on ready or unavailable error within that budget and SHALL never remain loading permanently

### Requirement: Six repairs share one acceptance authority

The Refresh recovery baseline with request-local success dismissal, disconnected-peer repair, supersession cancellation, logical join-time repair, fragment-insensitive startup, and bounded ClientLease recovery SHALL be delivered as one cumulative immutable source exact. A successful manual Refresh SHALL dismiss only its own loading entry after the accepted dwell and SHALL NOT publish `Ready to chat`; a genuine failure SHALL retain the matching error Toast. Intermediate heads and evidence from `a6021495` SHALL remain diagnostic only and SHALL not authorize final review, QA, checkout synchronization, publication, or release. The final exact SHALL receive fresh Reviewer and QA decisions on the complete combined matrix, followed by one Owner six-scenario product acceptance.

#### Scenario: Partial success does not authorize delivery

- **WHEN** any subset of the six repairs has a passing implementation or prior evidence
- **THEN** no partial head SHALL be synchronized or published as the requested repair, and the remaining outcomes SHALL stay part of the same final candidate

#### Scenario: Final acceptance covers all six outcomes

- **WHEN** the final cumulative exact passes fresh independent Reviewer and QA gates
- **THEN** the Owner SHALL verify failed-join Refresh with no success Toast, disconnected-peer retry, multi-page identity update without supersession Toast, A-before-B join-notice order, direct fragment-URL startup, and retained-Runtime refresh plus bounded connecting recovery before publication authority exists

### Requirement: Peer wire protocol is replaced with v3 without compatibility

The peer-to-peer wire protocol SHALL use the v3 contract defined by the `peer-wire-protocol` capability. The system SHALL NOT bridge, translate, or interoperate with released v1 or v2 protocols, and v1, v2, and v3 clients SHALL be isolated by both Chat and World room namespaces so no generation parses another's traffic or advertises an incompatible peer.

#### Scenario: v1 v2 v3 isolation

- **WHEN** v1, v2, and v3 clients exchange traffic in a shared physical environment
- **THEN** they SHALL not share Chat or World room namespaces and no compatibility fallback SHALL exist

#### Scenario: Old protocol removal remains complete

- **WHEN** the release candidate is inspected
- **THEN** old protocol schemas, the JSONR interop adapter, page-side message routing, reaction toggle, history upsert, HLC-only history cursor, and v1/v2 active namespace inputs SHALL be absent

## MODIFIED Requirements

### Requirement: Runtime Chat session lifecycle

The headless Runtime SHALL bind each Chat source to a session identity and logical generation. A join SHALL send strict `session {sessionId, user, presenceId, joinedAt}` before live text, reaction, or history traffic. `joinedAt` SHALL be the generation time owned by Session and SHALL remain unchanged with its `presenceId` across physical session replacement. A bound `sessionId` SHALL not change its `user.id`; an accepted `presenceId` SHALL not change its bound `user.id` or `joinedAt`; live event `userId` SHALL match the transport-bound session user. `name` and `avatar` SHALL remain mutable projection fields: a SESSION for the same accepted identity binding SHALL update that current projection across attached pages without changing logical membership or notices. A new physical incarnation SHALL retire the old source binding and old history sync, and SHALL trigger exactly one fresh history request for the replacement without running it concurrently with unsettled old source work. Reconnect of the same logical generation SHALL not become a new observer join.

#### Scenario: Session binding and replacement

- **WHEN** a source joins Chat, republishes a bound logical generation, sends changed `user.id` or logical time for an accepted generation, or reconnects with a new physical incarnation
- **THEN** the Runtime SHALL require the session message first, reject a `user.id` change for the same `sessionId`, reject a `user.id` or `joinedAt` change for the same accepted `presenceId`, reject live events whose `userId` does not match the bound user, retire the old source binding/sync for a new incarnation, and issue exactly one fresh history request for the replacement

#### Scenario: Same logical presence refreshes its user projection

- **GIVEN** a source and `presenceId` retain the same `user.id` and `joinedAt`
- **WHEN** a later accepted SESSION changes `name` or `avatar`, or repeats the current values
- **THEN** every attached same-domain page SHALL converge to the current projection idempotently without changing membership count, allocating a generation, emitting a chat/history event, or emitting a join/leave notice

#### Scenario: Future HLC does not advance Runtime clock

- **WHEN** the Runtime receives a wire event rejected because its HLC is more than five minutes ahead of the explicit receiver `now`
- **THEN** it SHALL reject the event, leave the central HLC clock unchanged, and continue processing later valid events

### Requirement: Session classifies logical presence across physical lifecycles

Session SHALL uniquely own local active-generation state, unsettled in-flight final-end identity, rejected retryable pending-final-end identity, observer-accepted settled-cleanup identity, and a bounded observer ledger. A private two-method `PresenceStoreExtern` SHALL persist those facts through `browser.storage.session` across supported Runtime host replacement; it SHALL NOT expand MessageStore, the origin database schema, `RuntimeServer`, `ChatRoomExtern`, or any UI/public model. Active lease, in-flight final end, retryable pending final end, and settled cleanup SHALL be four mutually exclusive strict records. Session SHALL allocate exact `{presenceId, joinedAt}` only for initial join or true return after complete final end. Refresh, reconnect, recovery, replay, duplicate SESSION, additional physical session, page reattach, supported host replacement, and replacement recovery of any final-end marker SHALL reuse the retained generation and logical time and emit snapshot convergence without a logical join/leave.

Chrome MV3 SHALL construct the concrete session-backed PresenceStore in the background Service Worker and expose only its existing `load`/`save` methods to the Offscreen Runtime through a dedicated comctx adapter over a point-to-point Runtime Port. Port name and comctx namespace SHALL be routing values rather than authority. Before delivering a message, Background SHALL require the transport sender's runtime id, exact Offscreen document URL, and absence of a tab; content, options, and every other extension source SHALL be disconnected without reading or writing durable state. Every provider response SHALL resolve through the exact request-to-Port binding recorded when its request arrived. If that binding has detached or been replaced, the response SHALL be dropped and SHALL NOT fall back to the current active Port. Offscreen SHALL admit a response only while that request remains pending on the same binding; uncorrelated, replayed, old-binding, wrong-namespace, wrong-direction, and broadcast responses SHALL reach no comctx callback. From request-ID response registration, each one-shot call SHALL reserve exactly one ordered transport generation. Generic response subscription SHALL NOT open a Port. The local heartbeat response subscription SHALL unregister before the actual `apply`, and that `apply` SHALL consume the oldest remaining request reservation. If the reserved generation terminates before pending insertion, the call SHALL reject before connecting or posting to a replacement and the adapter SHALL remove that operation's one-shot response entry. Port disconnect, synchronous connect/send failure, and adapter disposal SHALL reject every request and pre-send reservation owned by the terminal generation exactly once and release every adapter-owned per-operation response entry, without hanging or automatically replaying `load` or `save`; stale and late traffic SHALL traverse no terminal operation callback, and only a later new application call with a new request ID may create a replacement Port and correlation. Provider-owned long-lived callback handles SHALL retain their existing refresh/re-registration lifetime and SHALL NOT be removed by this one-shot cleanup. The dedicated adapter SHALL use Port send/disconnect as its liveness authority, satisfy comctx heartbeat preflight locally, and transmit only actual one-shot PresenceStore operations. Offscreen SHALL register no broadcast Runtime-message listener for PresenceStore, so another context cannot forge a provider response or observe one through that adapter. The Offscreen document SHALL receive the dependency through host assembly and SHALL NOT dereference an unavailable `browser.storage.session`, create memory storage, or route presence records through tabs/pages. Firefox MV2 SHALL pass the same concrete session-backed store directly from its persistent Background Page into the same shared host. Storage rejection and authenticated-Port termination SHALL reach Session's existing request-local failure fences without acknowledging, discarding, or weakening the durable transition; a later call after Service Worker recreation SHALL reconnect and use the same session-backed record.

The first accepted remote SESSION SHALL bind exact `user.id` and `joinedAt` to its source and `presenceId` in the observer ledger and record the current `name`/`avatar` projection. A later SESSION for the same accepted generation SHALL accept a changed projection when `user.id` and `joinedAt` match, while an equal projection is idempotent; a different `user.id` or `joinedAt` SHALL be rejected source-locally. Projection refresh SHALL change no logical membership or notice eligibility. For one committed local generation, a remote generation SHALL be eligible for an observer-local join only when its accepted `joinedAt` is strictly greater than local `joinedAt` and that user transitions from zero active logical generations to one. Equal or earlier time SHALL be historical snapshot convergence even when both peer discovery and SESSION occur only after local commit. Peer discovery and `baselinePeerIds` MAY retain physical catch-up bookkeeping but SHALL NOT decide logical order. A later remote SESSION received during a provisional local attempt SHALL remain attempt-owned and invisible until that attempt commits; rollback or supersession SHALL emit nothing. Physical `PeerLeft` SHALL not produce a logical leave. A valid SESSION_END SHALL produce one observer-local leave only when the user transitions from one active generation to zero. On graceful final local release, Session SHALL replace the active lease with an in-flight final-end identity, send SESSION_END, durably remove that identity after settlement, and only then allow Connection to leave the Chat room. The departing local client need not persist its own leave.

The local self-join notice SHALL be generation-scoped, persist immediately after successful new-generation join without waiting for history, and consume only Runtime private join provenance. Reconnect/recovery/host replacement SHALL not create a candidate; later true return SHALL use a later stable generation event time and produce a distinct notice. All SystemNotice records SHALL remain observer-local and SHALL never enter ChatMessage history. Sender-asserted `joinedAt` SHALL be used only for observer-local notice ordering and SHALL NOT authorize identity, routing, resource admission, or a globally trusted total order under arbitrary clock skew.

#### Scenario: Chrome Offscreen mounts with background-owned durability

- **GIVEN** a Chrome MV3 Offscreen document does not expose `browser.storage.session` while the background Service Worker does
- **WHEN** the shared Runtime host mounts and Session loads or saves a presence record
- **THEN** the Offscreen host SHALL remain available, the request SHALL use the private background PresenceStore adapter, and the exact session-backed record or persistence rejection SHALL return without a volatile fallback or page relay

#### Scenario: Unauthorized extension contexts cannot access PresenceStore

- **GIVEN** content and options contexts know the deterministic Port name and comctx namespace
- **WHEN** either context opens the named Port and sends a valid `load` or `save` injector envelope
- **THEN** Background SHALL reject the transport source before comctx dispatch, return no lifecycle record, perform no storage write, and leave the durable bytes unchanged

#### Scenario: Forged provider response cannot reach Offscreen

- **WHEN** a content, options, or other extension context broadcasts a provider-shaped response with the exact namespace and request id
- **THEN** the Offscreen PresenceStore injector SHALL receive nothing because it listens only to its background-owned point-to-point Port

#### Scenario: Service Worker recreation preserves the private route

- **WHEN** the accepted Port disconnects with a request in flight and the Service Worker provider is later recreated
- **THEN** every request owned by that Port SHALL reject through the existing request-local fence without replay, and only the next new `load`/`save` SHALL reconnect to the authenticated provider and use the retained session-storage record

#### Scenario: Old provider completion cannot cross into a replacement Port

- **GIVEN** an authenticated request arrived through one Port and that binding detached before its provider operation completed
- **WHEN** a replacement authenticated Port becomes active and the old operation later produces its response
- **THEN** Background SHALL drop the old response because its original request binding no longer exists; the replacement Port SHALL receive nothing and Session SHALL not advance from that completion

#### Scenario: Terminal send failure settles every binding-owned request

- **GIVEN** one or more Offscreen PresenceStore requests are pending on the same Port
- **WHEN** a later send on that Port throws a disconnected-Port error before the asynchronous disconnect event is observed
- **THEN** every request owned by that terminal binding SHALL reject without timeout, the operation that was already accepted SHALL not be replayed, and only a later new request may create a new Port and correlation

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
- **THEN** the call SHALL reject locally, its adapter-owned response entry SHALL be released, no Port SHALL open, and no durable PresenceStore operation SHALL be posted

#### Scenario: Firefox uses the equivalent direct store

- **WHEN** Firefox MV2 mounts the shared Runtime in its persistent Background Page
- **THEN** host assembly SHALL pass the concrete session-backed PresenceStore directly and preserve the same strict records, rejection semantics, and supported replacement behavior

#### Scenario: Six-timepoint A B C D lifecycle

- **GIVEN** independent actual Runtime Server/Session/Wire stacks use deterministic in-repo transport, A is an existing observer, B is a new local user, C is an additional physical session for B's generation, and D is B's replacement Runtime host
- **WHEN** the control executes preparation baseline, B first join, duplicate/C publication, transient B loss/D recovery, D final release, and B later return
- **THEN** B and A SHALL each persist one join for the first logical transition; duplicate/C/loss/recovery SHALL add no notice; A SHALL persist one leave on final end; and later return SHALL persist one fresh self join plus one fresh observer join

#### Scenario: Delayed discovery uses logical join order

- **GIVEN** A logically joined before B, but B discovers A and receives A's SESSION only after B commits
- **WHEN** A's accepted `joinedAt` is less than or equal to B's local `joinedAt`
- **THEN** B SHALL converge A into the current membership snapshot without persisting `A joined the chat`, while A SHALL persist B's later join once

#### Scenario: Provisional later join becomes visible only on commit

- **GIVEN** B's local join is provisional and later C sends a valid SESSION whose `joinedAt` is strictly greater than B's
- **WHEN** B's attempt commits, rolls back, or is superseded
- **THEN** C's join candidate SHALL become observable exactly once only on commit and SHALL produce no membership or notice from rolled-back or superseded work

#### Scenario: Physical loss remains provisional

- **WHEN** a bound peer leaves transport without a valid final generation end and later republishes the same generation from reconnect, recovery, host replacement, or rejected-final-end replacement recovery
- **THEN** Session SHALL publish snapshots only and preserve the logical observer state without a leave/join pair

#### Scenario: Duplicate and late lifecycle facts

- **WHEN** SESSION or SESSION_END is duplicated, an accepted generation changes `user.id` or `joinedAt`, or an ended generation's SESSION arrives late
- **THEN** Session SHALL apply the accepted generation/end at most once, reject mutation or resurrection of the generation, and persist no duplicate notice

### Requirement: One-shot migration without dual architecture

The change SHALL be delivered as one candidate that includes the hosts, exact eight-method ChatRoom port, state-free Runtime client, clean-cut internal comctx surface, uniquely owned Lifecycle/Connection/Session/World/History/Delivery/Wire Domain graph, private RoomTransport Extern/provider composition, message delivery, reconnect entry, current v3 peer protocol, exact typed Database extern/default adapters, internal concrete MessageStore, canonical outer-type/outer-id `MessageRecord` with `ChatMessageRecord.message` and `SystemNoticeRecord.notice`, send-first persistence, and complete removal of page-owned WebRTC, v1/v2 active protocol paths, stateful ChatRoom authority, catch-all Network ownership, and old WireExtern/provider route. Persistence and Runtime authority SHALL be complete clean-cut structural replacements rather than minimal repairs; no compatibility wrapper, alias, dual path, dead facade, hidden state channel, provider leak, or test-only accommodation may retain an obsolete owner/record/Store/outbox architecture. No intermediate release SHALL ship multiple architectures or protocol generations. Existing local message history SHALL NOT be imported, migrated, or retained by the canonical database.

#### Scenario: Single-candidate completeness

- **WHEN** the release candidate is inspected
- **THEN** it SHALL contain the full Remesh DDD + CQRS Runtime architecture and current v3 protocol, and SHALL NOT contain any active page-owned WebRTC path, v1/v2 protocol room path, stateful ChatRoom recovery authority, catch-all Network owner, old WireExtern route, or dual writable fact

#### Scenario: No data migration

- **WHEN** the extension upgrades with old unstorage message data present
- **THEN** the old data SHALL be left unread and unconverted, and no migration code, marker, or reaction conversion SHALL exist

## REMOVED Requirements

### Requirement: Peer wire protocol is replaced with v2, without compatibility

**Reason**: Required SESSION logical join time creates the Owner-authorized v3 Chat+World generation.

**Migration**: Current clients join only v3 Chat and World namespaces; v1 and v2 remain isolated without a bridge or fallback.
