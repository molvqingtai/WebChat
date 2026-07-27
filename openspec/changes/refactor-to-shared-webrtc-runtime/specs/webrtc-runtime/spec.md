## ADDED Requirements

### Requirement: Shared Remesh Runtime owns all network state

The headless Runtime SHALL consume the immutable public peer contract from `src/protocol/index.ts` through a one-way dependency. The application/page Domain/model layer SHALL own origin-store access, retained user input, local/UI read models, projections, LWW/order behavior, and record helpers. The uniquely owned Runtime Domains SHALL own network/history facts, Wire queue/drop scheduling, and internal page-host control contracts. None of these application or internal Runtime symbols SHALL be exported by the public protocol module.

The system SHALL move all WebRTC peer connections, sessions, presence, and message routing into one shared Remesh DDD + CQRS Runtime per browser. Pages SHALL read Queries, issue Commands, and subscribe to Events only. They MAY retain join input and display projections, but SHALL NOT create, hold, or operate `RTCPeerConnection`, peer routing state, or a writable copy of Runtime network facts. Page-owned WebRTC SHALL be removed with no fallback path.

#### Scenario: Page contains no network ownership

- **WHEN** any content page is inspected or executed
- **THEN** it SHALL NOT construct or retain peer connections, sessions, or routing state, and SHALL consume the Runtime only through the internal comctx surface

#### Scenario: No old-architecture fallback

- **WHEN** Runtime host creation fails on a supported browser
- **THEN** the system SHALL present an explicit unavailable/retry state and SHALL NOT silently restore page-owned WebRTC

### Requirement: Browser hosts adapt only lifecycle

The system SHALL provide one shared Remesh Runtime core consumed by browser-specific hosts: Chrome and Edge SHALL use an Offscreen Document host and Firefox SHALL use an equivalent long-lived persistent Background Page host. Hosts SHALL only create, destroy, and inject browser capabilities into the Runtime and SHALL NOT duplicate ChatRoom or WorldRoom business logic.

#### Scenario: Shared core across browsers

- **WHEN** the Chrome/Edge and Firefox builds are compared
- **THEN** the Runtime business logic SHALL be the same shared Remesh implementation and host files SHALL contain only lifecycle adaptation

#### Scenario: Host lifecycle adaptation

- **WHEN** a browser destroys and recreates its host environment
- **THEN** the host SHALL re-instantiate the shared Runtime core without changing domain business semantics

### Requirement: Background is the sole host coordinator

The extension background SHALL be the only coordinator allowed to create or rebuild the Runtime host. Creation SHALL be single-flight: concurrent page requests SHALL wait for the same ready result. While at least one physical page port is online, a missing or destroyed Runtime within the live coordinator's supported host context SHALL be recreated automatically without user action. For Chrome/Edge, the Service Worker coordinator SHALL retain physical page-port liveness and host-phase observations outside the Offscreen host, so Offscreen destruction is recoverable; after host creation it SHALL replay idempotent attach Commands into `LifecycleDomain`. `LifecycleDomain` SHALL remain the unique owner of domain leases, ref-count, grace, and release State; the coordinator SHALL NOT keep a parallel domain lease/grace map. For Firefox, the coordinator and Runtime host SHALL share the persistent Background Page; supported recovery SHALL be limited to in-context `HostOwner` replacement, while a browser process restart SHALL be recovered when Firefox recreates the Background Page and a restored page idempotently reattaches. Direct `backgroundView.close()` SHALL be outside the supported recoverable lifecycle and SHALL NOT require an event page, reload watchdog, or business fallback. A page watchdog MAY supplement Chrome/Edge probing but SHALL NOT be the only controller. The background coordinator itself MAY be suspended or restarted by the browser; after such a supported restart it SHALL recover physical port/host observations from active ports or idempotent page reattach, reconstruct one host, and dispatch the resulting attach Commands without producing duplicate Lifecycle leases, hosts, or physical rooms.

#### Scenario: Concurrent creation requests

- **WHEN** multiple pages detect a missing Runtime at the same time
- **THEN** exactly one host creation SHALL proceed and all pages SHALL attach to its single ready result

#### Scenario: Automatic rebuild in a supported host context

- **WHEN** Chrome/Edge destroys its Offscreen host, or Firefox replaces an in-context Runtime provider, while a domain page remains online
- **THEN** the coordinator SHALL rebuild the supported host context and re-establish that domain's connections and the WorldRoom without user action

#### Scenario: Stale Offscreen document

- **WHEN** the Offscreen document still exists but the Runtime provider or its identity probe does not respond while a physical page port remains online
- **THEN** the background health sweep SHALL close and recreate the stale document, verify the replacement provider, and replay an idempotent attach Command into the replacement Lifecycle Domain without requiring a page watchdog or retaining a parallel lease map

#### Scenario: DOM-free MV3 health probe

- **WHEN** the Chrome/Edge background service worker probes a newly created or steady-state Offscreen Runtime
- **THEN** the injector SHALL operate without `window`, `document`, or content-page location metadata and SHALL validate the responding provider identity

#### Scenario: Single Firefox replacement owner

- **WHEN** the Firefox persistent Background Page replaces its in-context Runtime
- **THEN** it SHALL dispose the old comctx provider listener, Remesh store, room transport, and Artico peer before exposing one replacement, leaving exactly one provider and physical Runtime

#### Scenario: Chrome MV3 Offscreen destruction recovery

- **WHEN** the production Chrome MV3 Offscreen document is directly destroyed while the Service Worker coordinator retains an active physical page port
- **THEN** the coordinator SHALL automatically recreate the Offscreen host, re-instantiate the shared Runtime, replay one idempotent Lifecycle attach, and restore Runtime readiness and room participation without page-owned fallback or duplicate domain lease authority

#### Scenario: Firefox MV2 process restart recovery

- **WHEN** the test-owned Firefox process is terminated and restarted with the same isolated profile and the target tab is restored, with the harness reinstalling the same exact temporary XPI only as setup if process exit removed it
- **THEN** the test SHALL observe one persistent Background Page, Runtime rejoin, page `ONLINE`, and state re-projection; profile and tab continuity SHALL be asserted separately, and the harness SHALL NOT claim product auto-reinstallation

#### Scenario: Firefox persistent-page boundary

- **WHEN** a diagnostic harness directly closes the Firefox persistent Background Page through `backgroundView.close()`
- **THEN** the result SHALL be recorded as negative evidence of the platform's non-recoverable persistent-page boundary rather than a product failure, and SHALL NOT motivate an event page, reload watchdog, or business fallback

#### Scenario: Deterministic Firefox HostOwner swap

- **WHEN** the Firefox host is disposed and replaced during lifecycle recovery
- **THEN** deterministic `HostOwner` dispose/swap tests SHALL prove that the old provider, store, rooms, and peer are fully disposed before exactly one replacement is exposed

#### Scenario: Observable steady-state host loss

- **WHEN** the coordinator detects provider loss or replacement failure after startup
- **THEN** Lifecycle-backed Runtime snapshots exposed to pages SHALL report the resulting `connecting` or `unavailable` phase instead of a hard-coded `ready` value

#### Scenario: Coordinator restart

- **WHEN** the background coordinator itself is suspended or restarted by the browser
- **THEN** it SHALL recover physical page-port and host-phase observations from active ports or idempotent page reattach, reconstruct one host, and dispatch idempotent Lifecycle attach Commands without producing duplicate domain leases, hosts, or physical rooms

### Requirement: Background service RPC routing is service-specific

Notification and AppAction SHALL use mutually exclusive versioned comctx namespaces. Each service's background provider and content injector SHALL obtain its namespace from the same internal proxy contract combined with the current extension runtime id. A heartbeat SHALL therefore admit only the requested service provider. One Notification or AppAction request SHALL produce one matching provider response, execute its intended side effect exactly once, and return request listeners to the live-provider baseline.

A rejected Notification `push` Promise SHALL be consumed by that request and produce one local observable diagnostic. It SHALL NOT surface as an unhandled Promise or global page error, terminate later notification requests, or remove or duplicate the chat list, barrage, input, OS notification, or AppAction behavior. The existing Notification request Event and all successful behavior SHALL remain unchanged. This isolation SHALL NOT add a public method, retry, fallback, product copy, shared failure authority, comctx fork, Runtime/PresenceStore change, or peer-wire change.

#### Scenario: Notification reaches only its provider

- **GIVEN** Notification and AppAction providers are both live on the extension runtime bus with heartbeat enabled
- **WHEN** the content injector calls Notification `push`
- **THEN** exactly one Notification provider SHALL answer and execute `push` once, AppAction SHALL execute nothing, the request SHALL receive one response, and request listeners SHALL return to baseline

#### Scenario: AppAction reaches only its provider

- **GIVEN** Notification and AppAction providers are both live on the extension runtime bus with heartbeat enabled
- **WHEN** the content injector calls AppAction `openOptionsPage`
- **THEN** exactly one AppAction provider SHALL answer and open Options once, Notification SHALL execute nothing, the request SHALL receive one response, and request listeners SHALL return to baseline

#### Scenario: Notification rejection is request-local

- **GIVEN** a Notification request rejects internally
- **WHEN** `NotificationDomain` issues that request and then issues a later healthy request
- **THEN** the first request SHALL emit one local diagnostic with no unhandled page error, both existing notification request Events SHALL occur, and the later request SHALL execute normally without harming the chat list, barrage, or input

### Requirement: Domain connection sharing and isolation

For each domain, `ConnectionDomain` SHALL maintain at most one connection to the same remote peer, shared by every local page of that domain. Connection, Session, World, History, and Delivery owners SHALL keep different domains isolated from one another.

#### Scenario: Two tabs on one domain

- **WHEN** two pages of the same domain are online
- **THEN** the Runtime SHALL hold exactly one connection to each remote peer of that domain, not one per page

#### Scenario: Cross-domain isolation

- **WHEN** pages of two domains are online
- **THEN** neither domain's connections, sessions, presence, buffered events, nor history-provider cleanup SHALL be visible to or affect the other domain

### Requirement: Physical room acceptance commits a domain join

A Runtime logical room registration or desired-room request SHALL NOT by itself constitute physical room readiness or successful domain join. `ConnectionDomain` SHALL keep every initial domain join provisional until the required physical Chat and World rooms accept the initial Chat `session` and World presence snapshot through `WireDomain`. It SHALL then command `SessionDomain` and `WorldDomain` to commit the domain's local-session and local-World facts and complete the join operation exactly once.

For a transient provider/room-not-ready result, the Runtime SHALL use bounded Runtime-owned readiness waiting or automatic retry, or atomically roll back the provisional join before surfacing a retryable failure. It SHALL NOT leave a terminal state that can receive remote Chat sessions or World presence while the local page has no local-session/presence projection. Cold existing-user startup, normal startup, and supported host/process recovery SHALL automatically converge to exact local plus remote Chat membership and World presence without a page reload or manual reconnect. Pages SHALL NOT implement a fallback retry queue or browser-specific business logic.

Each provisional attempt SHALL be fenced by the active host and domain lifecycle generation. Last-page release, explicit leave/reconnect, host replacement, and late provider/room-open callbacks SHALL cancel or supersede the prior attempt; a stale completion SHALL not alter state or emit a projection. One logical join SHALL create at most one physical room for each required room id and SHALL emit at most one initial local session and one local World presence.

Peer-ready and inbound session events received during a provisional window SHALL belong to the active attempt rather than the retained committed runtime. A peer that becomes ready after an accepted initial Chat or World broadcast but before commit, and therefore could not receive that broadcast, SHALL receive exactly one targeted current local Chat session or World presence after commit for each missed room. The Runtime SHALL send no catch-up for a rolled-back or superseded attempt and no duplicate to a peer already covered by the accepted initial broadcast. A remote Chat session received during a provisional reconnect SHALL remain invisible to pages until commit and SHALL then appear exactly once in the replacement committed snapshot; it SHALL NOT leak through the previous committed runtime or be overwritten by an empty attempt snapshot.

A bounded room-recovery timeout SHALL retain ownership of the underlying asynchronous join. A timeout surfaced as terminal for an attempt SHALL invalidate and leave or otherwise fence that attempt before a late completion can register trusted membership. An automatically retained retry SHALL remain provisional until its current presence/session is accepted. In either case, late physical readiness SHALL NOT leave a persistent physical or trusted World room, or an observable joined snapshot, without an accepted current World presence; a later recovery attempt SHALL publish the full current snapshot before commit.

#### Scenario: Delayed physical room on cold existing-user join

- **GIVEN** an existing page identity and an injected transport whose logical join records desired rooms while physical Chat and World rooms remain unavailable
- **WHEN** the page automatically joins and a remote peer later becomes available before the bounded Runtime retry/window ends
- **THEN** no failed provisional attempt may remain remote-receivable without local projection, the Runtime SHALL eventually emit exactly one local session and one local World presence, the page SHALL show the exact local-plus-remote memberships, and each required physical room/session/presence SHALL occur once

#### Scenario: Cancelled or superseded delayed join

- **GIVEN** a domain join is waiting for physical room acceptance
- **WHEN** its page lease releases, the host is replaced, the domain reconnects, or an earlier provider opens after a newer generation begins
- **THEN** the stale attempt SHALL not send a session/presence or mutate the current domain, and the current generation alone may converge

#### Scenario: Peer becomes ready during provisional commit

- **GIVEN** the initial Chat and World broadcasts are accepted or pending while the domain join remains provisional
- **WHEN** a peer becomes ready too late to receive either accepted initial broadcast and the same attempt later commits
- **THEN** the Runtime SHALL send that peer exactly one targeted current Chat session and one targeted current World presence for the missed rooms after commit, without duplicating an initial delivery or sending from a failed or stale attempt

#### Scenario: Remote session arrives during provisional reconnect

- **GIVEN** a committed domain is retained while a replacement Chat room reconnect remains provisional
- **WHEN** the replacement room receives a remote session before its initial local session send settles
- **THEN** the remote session SHALL remain attempt-owned and invisible to pages before commit, then appear exactly once in the committed replacement snapshot without entering the prior runtime or being overwritten

#### Scenario: World recovery times out before physical readiness

- **GIVEN** a World recovery join remains physically pending beyond its bounded timeout
- **WHEN** the timeout settles and the underlying provider reports readiness later
- **THEN** the timed-out completion SHALL be fenced from trusted membership, or an owned automatic retry SHALL remain provisional until the current full World presence is accepted; no settled state SHALL expose joined World membership without that publication

### Requirement: Physical sends isolate per-target readiness transitions

Artico Room readiness events SHALL be treated as advisory for recipient selection rather than as an atomic guarantee that every remembered call remains sendable. An untargeted send SHALL snapshot the currently remembered peer ids. An explicit one-or-many-target send SHALL use the supplied peer ids. The transport SHALL de-duplicate either set in deterministic order and attempt each distinct target independently.

A target-local provider rejection after that call has become non-sendable but before Room `leave` SHALL be contained to that target. It SHALL NOT prevent a later target from being attempted exactly once, reject the whole room send, or cause a provisional domain join or World recovery to roll back after any other target has already accepted the fact. The operation SHALL settle after all target attempts, including an empty or no-longer-sendable target set. A missing physical room, an untrusted/stale room selection, or a codec/validation failure before provider target attempts SHALL remain an operation-level rejection.

This per-target settlement is best-effort physical provider acceptance, not remote delivery acknowledgement. It SHALL add no retry, durable outbox, delivery status, fallback, callback channel, wire field, public ChatRoom method, or persistence behavior. A target that later becomes ready again participates only through the existing provider-ready/session/presence convergence paths.

#### Scenario: Untargeted send continues after a ready call starts closing

- **GIVEN** an untargeted Chat or World send snapshots two remembered-ready peers in order, the first call enters `closing` before Room `leave`, and the second call remains sendable
- **WHEN** the provider rejects the first target synchronously
- **THEN** the first target SHALL receive nothing from that attempt, the second target SHALL receive the fact exactly once, and the room send SHALL settle without a room-wide rejection

#### Scenario: Explicit multi-target catch-up isolates a stale target

- **GIVEN** a post-commit Chat-session or World-presence catch-up explicitly names multiple distinct peers and one named call becomes non-sendable before its delayed Room `leave`
- **WHEN** the transport attempts the explicit targets
- **THEN** that target-local miss SHALL NOT skip or duplicate any later sendable target, and every later sendable target SHALL receive its catch-up exactly once

#### Scenario: Partial provisional publication is not rolled back by a later target miss

- **GIVEN** an initial Chat session, initial World snapshot, or World recovery presence has been accepted by one provider target
- **WHEN** a later target in the same physical send rejects because its call crossed the ready-to-closing window
- **THEN** the target-local miss SHALL be contained, the physical send SHALL finish the remaining targets, and the Runtime SHALL NOT roll back the provisional attempt solely because of that miss or replay the already accepted target

#### Scenario: Room-level failure remains an operation failure

- **GIVEN** no current physical/trusted room exists, or wire validation/encoding rejects before any provider target attempt
- **WHEN** Chat or World tries to send
- **THEN** the operation SHALL reject through the existing generation-owned failure path, send to no target, and gain no retry, outbox, status, fallback, or local persistence success

### Requirement: Unified five-second lifecycle grace

When the last page of a domain disconnects, `LifecycleDomain` SHALL uniquely own one unified five-second grace phase/deadline. During it, Connection SHALL retain that domain's ChatRoom connection, Session/History SHALL retain domain State, Delivery SHALL retain the volatile inbound un-ACK buffer, and World SHALL retain domain presence. On grace expiry, the Lifecycle domain-released Event SHALL begin a fenced final release: Session SHALL persist the retired private presence record with an unsettled final-end identity before publishing SESSION_END, retain that identity until the send settles, durably replace it with settled-cleanup ownership, and then remove that marker. Session's authoritative finalization state SHALL reject text/reaction allocation and live send from pending retirement through physical release. Connection SHALL physically leave Chat or the last World room only after marker removal succeeds. A page that reconnects within the grace period SHALL cancel grace through Lifecycle and read the current Runtime snapshot without a false offline/online transition. No persistent outbound outbox or delivery-status retry survives a successfully completed grace release; only the separately specified volatile inbound un-ACK buffer participates in this lifecycle.

#### Scenario: Refresh within grace

- **WHEN** a user refreshes the only page of a domain and the new page attaches within 5 seconds
- **THEN** the domain connection and state SHALL continue without re-join flapping, presence flicker, or message loss caused by the refresh

#### Scenario: Application reconnect preserves the logical generation

- **GIVEN** the application Reconnect Effect retains the frozen `leaveRoom()` then `joinRoom(command)` composition
- **WHEN** the Runtime ChatRoom implementation executes that composition for an active domain
- **THEN** `leaveRoom()` SHALL invoke current-domain Runtime reconnect rather than final logical release, the replacement physical Chat session SHALL reuse the same `presenceId`, World SHALL remain physically joined, and local plus observer views SHALL receive snapshots without SESSION_END, logical join/leave, or another notice

#### Scenario: Durable retirement rejects

- **GIVEN** a committed active presence generation and a PresenceStore that rejects the retired record
- **WHEN** final release begins
- **THEN** the same active durable and in-memory lease, Chat/World physical membership, History state, World desired presence, and joined Runtime snapshot SHALL remain; no SESSION_END, observer leave, or physical departure SHALL occur; the pending release fence SHALL be removed so allocation and live send remain usable; and the existing Runtime error path SHALL surface a retryable request-local failure

#### Scenario: Retirement succeeds after storage recovery

- **GIVEN** a prior retirement attempt was fenced by storage rejection and the PresenceStore later recovers
- **WHEN** final release is requested again
- **THEN** the same generation SHALL persist one retired identity before exactly one SESSION_END settles, durably transition it to settled-cleanup ownership, remove that marker, and only then SHALL Connection physically leave Chat and the last World room while observers classify one leave

#### Scenario: Every non-active final-release phase fences live authority

- **GIVEN** Session has a pending release in `retiring`, `retrying`, `publishing`, `pending`, `settling`, `settlement-failed`, `cleaning`, or `cleanup-failed`, or has restored `inflightEnd`, `pendingEnd`, or `settledEnd` without an active `local` lease
- **WHEN** the current or replacement host requests text allocation, reaction allocation, or live Chat send
- **THEN** both Server preflight and the authoritative Session Command SHALL reject before HLC allocation or Wire send, no live frame SHALL be added, and successful marker cleanup SHALL retain that fence until physical domain release completes

#### Scenario: SESSION_END send rejects

- **GIVEN** durable retirement succeeded but the SESSION_END send rejects
- **WHEN** the send failure settles
- **THEN** Session SHALL durably transition that generation from in-flight to retryable pending final end, Connection SHALL retain Chat/World physical membership and publish no false local departure, and a later same-host final-release request SHALL durably transition the same marker back to in-flight before retrying the idempotent end

#### Scenario: Host replacement continues an unsettled final end

- **GIVEN** durable retirement succeeded and a first or retry SESSION_END is unsettled or explicitly rejected
- **WHEN** the Runtime host is replaced and the same user invokes join before END settlement
- **THEN** the replacement SHALL use the retained `presenceId` only to physically rebind and continue the same END transaction, SHALL expose no successful active join or live-message authority, and SHALL finish with at most one observer leave plus no persistent marker; a subsequent explicit join SHALL allocate a new generation

#### Scenario: Post-settlement cleanup rejects

- **GIVEN** SESSION_END settled and Session durably replaced the unsettled identity with private settled-cleanup ownership
- **WHEN** marker removal rejects
- **THEN** Session SHALL retain settled-cleanup ownership and Chat/World physical membership still owned by the current host, surface a request-local error, publish no second SESSION_END merely to retry cleanup in the same host, and permit physical departure only after later marker removal succeeds

#### Scenario: Host replacement assumes settled cleanup ownership

- **GIVEN** the observer ledger accepted SESSION_END and durable settled-cleanup ownership remains after a cleanup rejection
- **WHEN** the same user's replacement host invokes join
- **THEN** it SHALL only remove that marker, SHALL join neither Chat nor World, SHALL publish no SESSION or SESSION_END, SHALL expose no active session or live-message authority, and SHALL preserve the observer's exactly-once leave; only a later explicit join MAY allocate a fresh `presenceId` and one new logical join

#### Scenario: Readiness helper distinguishes mounted UI from convergence

- **WHEN** automated acceptance observes an already-mounted usable chat textarea after a refresh or restart
- **THEN** the helper SHALL accept that UI readiness immediately; a separate bounded eventual membership/presence wait MAY guard against a hang, and the five-second domain grace SHALL NOT be treated as a UI-convergence deadline

#### Scenario: Grace expiry

- **WHEN** no page of the domain reconnects within 5 seconds and durable retirement plus SESSION_END settlement succeed
- **THEN** the ChatRoom connection, Runtime domain state, volatile inbound un-ACK delivery buffer, and WorldRoom presence for that domain SHALL all be released or removed in the required causal order, with no persistent outbound status or same-id crash retry retained

#### Scenario: Event outside grace

- **WHEN** an inbound event targets a domain that is unregistered or past its grace period
- **THEN** the system SHALL discard the event because no persistence location exists for it

### Requirement: Peer wire protocol is replaced with v2, without compatibility

The peer-to-peer wire protocol SHALL be replaced with the v2 contract defined by the `peer-wire-protocol` capability. The system SHALL NOT bridge, translate, or interoperate with the released v1 protocol, and v1 and v2 clients SHALL be isolated by v2 room namespaces so neither parses the other's traffic.

#### Scenario: v1/v2 isolation

- **WHEN** a v1 client and a v2 client exchange traffic
- **THEN** they SHALL NOT share a room namespace and no compatibility fallback SHALL exist

#### Scenario: Old protocol removal

- **WHEN** the release candidate is inspected
- **THEN** the old protocol schemas, the JSONR interop adapter, page-side message routing, reaction toggle, history upsert, and HLC-only history cursor SHALL be absent

### Requirement: Application/page Domain owns local records and projections

Each domain's existing origin database SHALL remain the only message-history and local tab-synchronization mechanism. The application/page Domain/model layer SHALL own `MessageRecord`, `ChatMessageRecord`, `SystemNoticeRecord`, projected UI models, internal record helpers/codecs, and projection adapters. It SHALL directly consume protocol `ChatMessage` values and SHALL NOT define a second public/local `TextMessage` or `ReactionMessage` DTO with the same wire names. `MessageProjection` SHALL remain outside `src/protocol` and SHALL own reaction LWW winner calculation, record-to-UI message projection, and notification/danmaku projection. No headless Runtime Domain SHALL maintain a history copy or expose a writable application read-model replica. Designated Runtime/application persistence modules MAY use the injected Database through the internal concrete MessageStore; Chat/UI and the public ChatRoom extern SHALL NOT name stores, indexes, ranges, transactions, `DatabaseItem`, or adapters.

The application/page Domain SHALL define this exact clean-cut record contract:

```ts
export const MESSAGE_RECORD_TYPE = {
  CHAT_MESSAGE: 'chat-message',
  SYSTEM_NOTICE: 'system-notice'
} as const

export interface ChatMessageRecord<Message extends ChatMessage = ChatMessage> {
  readonly type: typeof MESSAGE_RECORD_TYPE.CHAT_MESSAGE
  readonly id: string
  readonly message: Message
  readonly user: ChatUser
  readonly receivedAt: number
}

export type TextMessageRecord = ChatMessageRecord<TextMessage>
export type ReactionMessageRecord = ChatMessageRecord<ReactionMessage>

export interface Notice {
  readonly id: string
  readonly hlc: HLC
  readonly type: NoticeType
  readonly body: string
}

export interface SystemNoticeRecord {
  readonly type: typeof MESSAGE_RECORD_TYPE.SYSTEM_NOTICE
  readonly id: string
  readonly notice: Notice
  readonly user: ChatUser
  readonly receivedAt: number
}

export type MessageRecord = ChatMessageRecord | SystemNoticeRecord
```

A strict decoder SHALL choose the closed variant only through outer `record.type`; it SHALL NOT infer record kind from `DatabaseItem.key`, an id/key prefix or shape, or the presence of `message`/`notice`. Every decoded record SHALL satisfy `DatabaseItem.key === record.id`. A decoded Chat record SHALL also satisfy `record.id === record.message.id` and `record.user.id === record.message.userId`; a decoded SystemNotice SHALL satisfy `record.id === record.notice.id`. Chat and notice ids SHALL occupy one globally unique record-id space so atomic first-value-wins cannot collide across variants. `Notice.type` remains the independent `join | leave | info` reason; outer `record.type` remains only the `chat-message | system-notice` storage/Domain category. SystemNotice identity SHALL be deterministic and it SHALL never enter peer wire or history. `receivedAt` is finite local first-acceptance/creation time, not an HLC, peer timestamp, or delivery state. Record ordering helpers SHALL use `(record.message.hlc, record.id)` for Chat and `(record.notice.hlc, record.id)` for SystemNotice; reaction LWW SHALL continue to use `(message.hlc, message.id)`, and UI reaction aggregation remains projection-only. There SHALL be no standalone `SYSTEM_NOTICE`, old outer notice `hlc`/`body`/`noticeType`, `LocalRecord`, `DurableEventRecord`, outer `event` alias, property-presence guard, key-based discriminator, `RecordStatus`, pending/sent/received state, mark method, outbox metadata, compatibility alias, or dual-read path.

The only host-replaceable persistence extern SHALL be `Database<Schema>`. IndexedDB and Memory SHALL implement it for one private `MessageDatabaseSchema` and private logical database name/version/store/index configuration. A future backend is compatible only after running the same public contract suite. The single internal concrete MessageStore SHALL be Database-backed and expose only `insert(record): Promise<InsertMessageResult>`, `query(query?: MessageQuery)`, `clear`, and `watch`; it SHALL NOT expose `list` or a compatibility alias and SHALL NOT be a Remesh extern, public-barrel export, host injection point, or independently replaceable backend. Its internal helpers SHALL strictly decode MessageRecord, derive message/notice keys and HLCs, validate Database item identity, distinguish same-id canonical replay from different-content conflict, and keep the first value without overwrite. `InsertMessageResult` SHALL be the readonly inserted/existing Domain union and SHALL NOT reuse Database's result type.

The canonical per-origin IndexedDB identity SHALL remain stable, including its existing v2 database name. Private `MESSAGE_STORE_VERSION = 2` colocated with the native upgrade callback SHALL name the existing schema authority. This abstraction and record cleanup SHALL NOT itself advance the version or add an upgrade. The version SHALL advance only with an implemented compatible store/index/key/value migration; ordered IndexedDB upgrade transactions SHALL preserve canonical records and bounded conflict diagnostics. App/wire versions and ordinary fixes SHALL NOT clear, rename, or delete the database. Old unstorage data remains unread, unconverted, and uncleared.

The headless Runtime SHALL own only network/history orchestration around the application-owned store: `HistoryDomain` owns requester/provider State, candidate-window and byte/message budgets, supplier selection/failover, page cancellation, and physical settlement; `WireDomain` owns protocol scheduling/queues; the page-host boundary owns internal RPC. Shared models consumed by both pages and Runtime SHALL remain defined by an application Domain/model module rather than by any Runtime owner or the public protocol.

#### Scenario: Application persistence boundary

- **WHEN** a page persists, projects, or synchronizes local records
- **THEN** the Database-backed application persistence boundary SHALL own that work, the headless Runtime Domains SHALL own no history read model, and Chat/UI SHALL receive only decoded Domain records/projections rather than storage primitives

### Requirement: Application ports are exact, minimal, and replaceable

`RuntimeServer` and `PagePort` SHALL remain internal page-host boundaries and MAY retain private Runtime contracts. Their adapter SHALL terminate trusted `sourcePeerId`, local/remote provenance, host gating, snapshots, replay, transient operation state, history supply, callback cleanup, timers, and storage detail before application Domains receive values. Runtime-to-page session delivery SHALL converge through one internal session-event path capable of carrying local self convergence, remote live changes, live leaves, and replacement snapshots with private provenance; separate `onLocalSession`/`onSession`/`onSessionLeave` public or adapter-facing paths SHALL be removed. This internal path SHALL NOT be exported from an extern.

The application `ChatRoom` extern SHALL directly type-import the exact public protocol `ChatUser`, `ChatSession`, `ChatSite`, `ChatMessage`, and `MentionedUser` structures. Its entire public contract SHALL be exactly:

```ts
interface JoinRoomCommand {
  user: ChatUser
  site: ChatSite
}
interface SendTextCommand {
  type: 'text'
  body: string
  mentions: MentionedUser[]
}
interface SendReactionCommand {
  type: 'reaction'
  targetId: string
  reaction: 'like' | 'hate'
  active: boolean
}
type SendMessageCommand = SendTextCommand | SendReactionCommand
type Unsubscribe = () => void
interface ChatRoom {
  joinRoom(command: JoinRoomCommand): Promise<void>
  leaveRoom(): Promise<void>
  sendMessage(command: SendMessageCommand): Promise<ChatMessage>
  onMessage(listener: (message: ChatMessage) => void): Unsubscribe
  onJoinRoom(listener: (session: ChatSession) => void): Unsubscribe
  onLeaveRoom(listener: (session: ChatSession) => void): Unsubscribe
  onSessions(listener: (sessions: readonly ChatSession[]) => void): Unsubscribe
  onError(listener: (error: Error) => void): Unsubscribe
}
```

No alias, compatibility field, overload, extra method, generic metadata bag, Runtime type, or peer/source/joinedAt/timer/IDB/host/page/lease/retry field SHALL extend this contract without explicit Owner intervention. `joinRoom` SHALL use the caller-supplied user/site and `impls` SHALL create `sessionId`. `leaveRoom` SHALL operate on the currently joined room instance. `sendMessage` SHALL accept only the frozen business commands; `impls` SHALL create `id`, `hlc`, and `userId`, complete transport acceptance, and call local `MessageStore.insert`. Only after that insert operation successfully settles SHALL it resolve with the exact `ChatMessage` allocated and transported by that call. It SHALL NOT return or expose an insert result, same-id existing winner, `MessageRecord`, delivery status, or Runtime provenance.

`onSessions` SHALL be the only application session-state truth. For a normal accepted live change, the implementation SHALL publish the updated immutable session snapshot before the corresponding `onJoinRoom` or `onLeaveRoom` fact. Initialization, first join, hydration, refresh, reconnect, host replacement, and replay SHALL publish snapshots only, with no synthetic live delta. `onMessage` SHALL publish only a first durably accepted remote live `ChatMessage`; it SHALL exclude `SessionMessage`, history request/response/control traffic, history messages/replay, initial IDB reads, local sends, duplicate/conflicting inserts, and store-watch replay. Chat and World session instances SHALL remain distinct; same-origin pages share one Runtime logical Chat view, while separate browsers/devices maintain local views that converge.

Only explicit composition roots SHALL select and inject concrete `impls`. Application Domains and externs SHALL NOT import concrete `impls` or Runtime contracts. Application readiness SHALL retain immediate replay of `connecting | ready | unavailable`. `WorldRoomExtern` SHALL remain separately projected and source-free as specified by `world-room-presence`.

`Unsubscribe = () => void` SHALL be a neutral Domain type. The only replaceable persistence extern SHALL have this exact complete surface:

```ts
type DatabaseKey = string | number
interface StoreSchema {
  key: DatabaseKey
  value: unknown
  indexes: Record<string, DatabaseKey>
}
type DatabaseSchema<S> = { [Store in keyof S]: StoreSchema }
type StoreName<S> = keyof S & string
type Scope<Name extends string> = readonly [Name, ...Name[]]
type LowerBound<T> = { lower?: never; lowerOpen?: never } | { lower: T; lowerOpen?: boolean }
type UpperBound<T> = { upper?: never; upperOpen?: never } | { upper: T; upperOpen?: boolean }
type DatabaseRange<T> = LowerBound<T> & UpperBound<T>
type PrimaryQuery<S extends StoreSchema> = {
  index?: never
  range?: DatabaseRange<S['key']>
}
type IndexQuery<S extends StoreSchema> = {
  [Index in keyof S['indexes'] & string]: {
    index: Index
    range?: DatabaseRange<S['indexes'][Index]>
  }
}[keyof S['indexes'] & string]
type QueryOptions<S extends StoreSchema> = PrimaryQuery<S> | IndexQuery<S>
type ScanOptions<S extends StoreSchema> = QueryOptions<S> & {
  direction?: 'asc' | 'desc'
  limit?: number
}
interface DatabaseItem<Key, Value> {
  readonly key: Key
  readonly value: Value
}
type InsertResult<Value> = { readonly inserted: true } | { readonly inserted: false; readonly existing: Value }
interface ReadTransaction<Schema extends DatabaseSchema<Schema>, Allowed extends StoreName<Schema>> {
  get<Store extends Allowed>(store: Store, key: Schema[Store]['key']): Promise<Schema[Store]['value'] | undefined>
  scan<Store extends Allowed>(
    store: Store,
    options?: ScanOptions<Schema[Store]>
  ): Promise<readonly DatabaseItem<Schema[Store]['key'], Schema[Store]['value']>[]>
  count<Store extends Allowed>(store: Store, options?: QueryOptions<Schema[Store]>): Promise<number>
}
interface WriteTransaction<
  Schema extends DatabaseSchema<Schema>,
  Allowed extends StoreName<Schema>
> extends ReadTransaction<Schema, Allowed> {
  insert<Store extends Allowed>(
    store: Store,
    key: Schema[Store]['key'],
    value: Schema[Store]['value']
  ): Promise<InsertResult<Schema[Store]['value']>>
  put<Store extends Allowed>(store: Store, key: Schema[Store]['key'], value: Schema[Store]['value']): Promise<void>
  delete<Store extends Allowed>(store: Store, key: Schema[Store]['key']): Promise<void>
  clear<Store extends Allowed>(store: Store): Promise<void>
}
interface Database<Schema extends DatabaseSchema<Schema>> {
  read<const Stores extends Scope<StoreName<Schema>>, Result>(
    stores: Stores,
    operation: (transaction: ReadTransaction<Schema, Stores[number]>) => Promise<Result>,
    signal?: AbortSignal
  ): Promise<Result>
  write<const Stores extends Scope<StoreName<Schema>>, Result>(
    stores: Stores,
    operation: (transaction: WriteTransaction<Schema, Stores[number]>) => Promise<Result>,
    signal?: AbortSignal
  ): Promise<Result>
  watch<const Stores extends Scope<StoreName<Schema>>>(stores: Stores, listener: () => void): Unsubscribe
  close(): Promise<void>
}
```

`DatabaseKey` deliberately supports only strings and finite numbers; arbitrary IndexedDB Date/array/binary keys are outside the contract. A schema SHALL statically associate each store with its primary-key, value, index names, and index-key types, and a transaction SHALL reject any store not enlisted in its non-empty, duplicate-free scope. Primary scans order by primary key. Index scans order by index key and then primary key as a deterministic tie-break; `desc` reverses both. Bounds are inclusive unless their corresponding open flag is true. An open flag without its bound, a reversed bound, an unknown store/index, a non-finite key, or a limit that is not a finite non-negative safe integer SHALL reject deterministically; an equal bound with either side open yields an empty range.

A read SHALL observe one consistent transaction snapshot. A write SHALL be atomic across its enlisted stores and SHALL never automatically retry its callback. The callback MAY await only promises created by that same transaction and SHALL NOT await network, timers, or arbitrary external promises. Callback throw/rejection or signal abort before commit SHALL abort the physical transaction, reject, persist nothing, and emit no watch notification. A successful commit linearized before a later abort SHALL remain successful. An atomic insert collision SHALL not abort the transaction; it SHALL return the exact same-key existing winner from that operation. `inserted:false` itself is not a mutation. Database failures, decode failures, and aborts SHALL reject rather than masquerade as collisions.

`get` and `scan` SHALL return by-value-isolated snapshots: reassigning readonly item fields or mutating a returned nested object SHALL NOT mutate persistence; only an explicit `put` can write a replacement. Memory SHALL clone/isolate values to match IndexedDB. Canonical Message database values are limited to null, booleans, strings, finite numbers, dense arrays, and plain string-keyed objects; undefined, non-finite numbers, bigint, functions, symbols, Date, Map, Set, binary values, sparse arrays, cycles, and implementation-specific objects SHALL reject. TypeScript schema types do not replace strict runtime decoding.

`watch` SHALL register synchronously for a non-empty store scope and act only as invalidation. Every relevant successful write commit after registration SHALL produce at most one notification per Database instance/context; rollback and failed writes SHALL produce none. Same-logical-database notifications SHALL cross supported same-origin contexts, listener exceptions SHALL be isolated, and unsubscribe SHALL be idempotent and prevent later callbacks. Conservative notification for an explicit delete/clear/put that makes no observable value change MAY occur, but no state-changing commit may be permanently missed. `close` SHALL be idempotent, stop new read/write/watch calls and this instance's callbacks immediately, allow already-started transactions to drain to their normal settlement, then release database and cross-context resources.

The one internal concrete facade SHALL have this exact shape:

```ts
type InsertMessageResult = { readonly inserted: true } | { readonly inserted: false; readonly existing: MessageRecord }
type MessageQuery = Readonly<{
  type?: MessageRecord['type']
  signal?: AbortSignal
}>
interface MessageStore {
  insert(record: MessageRecord): Promise<InsertMessageResult>
  query(query?: MessageQuery): Promise<readonly MessageRecord[]>
  clear(): Promise<void>
  watch(listener: () => void): Unsubscribe
}
```

MessageStore SHALL have one Database-backed implementation and no Remesh extern, public-barrel export, host injection, Memory-specific implementation, or fake replacement. It SHALL map Database's insert result into its own Domain result; strictly decode each physical item independently by outer `record.type`; retain every invalid raw row without publication; record bounded, per-key deduplicated diagnostics in the existing private conflicts store without notifying canonical-record watchers; enforce `DatabaseItem.key === record.id`, Chat `record.id === record.message.id`, notice `record.id === record.notice.id`, and Chat user/message identity; preserve the first canonical value; retain bounded conflict diagnostics for same-id different-content input; and classify same-content replay without overwrite. Key/id prefixes, property presence, the removed standalone `SYSTEM_NOTICE`, and compatibility aliases SHALL NOT participate in decode or dispatch. `query()` SHALL return every valid canonical record in physical primary-scan order even when other physical rows are invalid. `query({type})` SHALL return only valid records whose exact outer discriminator equals that type, after independently attempting to decode every physically read item before applying the type filter. `query({signal})` SHALL gate the physical read transaction and all subsequent decode/filter work. The optional query object SHALL contain only `type` and `signal`; an unknown field or a type outside the exact outer discriminator union SHALL reject deterministically. It SHALL expose no id, range, order, limit, cursor, or syncId criterion. The type filter SHALL add no physical index, schema migration, or version bump; private `MESSAGE_STORE_VERSION = 2` remains the schema authority. `clear` SHALL run only for an explicit user/application clear command and SHALL atomically clear canonical records plus conflicts; startup, app-version checks, and compatibility code SHALL NOT call it. `watch` SHALL observe canonical-record invalidation; a conflict-only diagnostic write need not invalidate visible query results. Neither Database nor MessageStore SHALL own history wire DTOs, `syncId`, cursor, cutoff, limit, response `messages`, or `done`; history cutoff/pagination/projection remains in its Runtime/application owner. No `list` alias or test-only conflict-count API is exposed.

Default IndexedDB and Memory implementations SHALL use the same private `MessageDatabaseSchema` plus private logical name/version/store/index definition and run one unchanged backend contract suite; this requirement SHALL NOT add a public generic adapter factory. Type-negative tests SHALL reject wrong stores, keys, values, indexes, ranges, scopes, MessageQuery fields, and MessageQuery discriminator values. Separate parity tests SHALL cover Database transactions/abort/insert/order/watch/close/value isolation, MessageStore replay/conflict/decode/query-default/query-type/query-abort/clear/watch, and static imports proving Chat/UI/public ChatRoom do not import Database items, transactions, schemas, or concrete adapters. Residue scans SHALL reject the removed MessageStore `list` member, call sites, aliases, and dual paths without treating ordinary UI list nouns as compatibility APIs. If implementation proves any frozen field, method, or semantic insufficient, work on that boundary SHALL stop and the implementer SHALL send the exact gap, earliest blocked call chain, and minimum decision only to `@PM`. PM SHALL independently verify it and, when Owner input is required, ask `@molvqingtai` the one minimum decision. No implementation may add an alias, field, method, overload, fallback, or relaxed behavior autonomously.

#### Scenario: Atomic Database commit and cancellation

- **WHEN** a scoped read/write callback completes, throws, rejects, or receives an AbortSignal before or after physical commit
- **THEN** IndexedDB and Memory SHALL agree on snapshot visibility, all-or-nothing settlement, no callback retry, pre-commit rollback/no-watch, post-commit success, and rejection of scope-external access

#### Scenario: Atomic existing-winner insert

- **WHEN** concurrent writers insert the same primary key with the same or different canonical value
- **THEN** exactly one first value SHALL persist, every loser SHALL receive an isolated exact existing snapshot without aborting its transaction, and the internal MessageStore SHALL classify replay or bounded conflict without overwrite

#### Scenario: Deterministic primary and index scan

- **WHEN** a primary or secondary-index scan applies bounds, direction, duplicate index keys, and a limit
- **THEN** both backends SHALL return readonly DatabaseItems in the same index-then-primary order, preserve the primary key in each item, and reject every invalid store/index/range/key/limit combination identically

#### Scenario: Cross-context committed-write invalidation

- **WHEN** an enlisted store is mutated, rolled back, closed, or watched from another supported same-origin context
- **THEN** each relevant successful commit SHALL cause at most one invalidation per context, rollback SHALL cause none, listener failure SHALL not affect commit, unsubscribe/close SHALL stop callbacks, and no state-changing commit SHALL be permanently missed

#### Scenario: Strict MessageRecord boundary

- **WHEN** DatabaseItems are inserted, queried with default or exact-type criteria, replayed, conflicted, cleared, or observed through MessageStore
- **THEN** MessageStore SHALL accept only the exact outer-type MessageRecord union; validate `DatabaseItem.key === record.id`, Chat `record.id === record.message.id`, notice `record.id === record.notice.id`, shared cross-variant id uniqueness, and Chat user/message identity; reject key/property-presence discrimination and every old shape; keep SystemNotice local-only; expose only its four methods; and never expose Database primitives or history protocol values

#### Scenario: Default-all typed MessageStore query

- **WHEN** a caller invokes `query()` with no object, with one exact outer `type`, with an AbortSignal, or with an invalid field/discriminator
- **THEN** the facade SHALL respectively return all valid strictly decoded canonical records while isolating invalid rows, return only that type after independently decoding the complete scan, honor cancellation through read/decode/diagnostic/filter settlement, or reject deterministically; it SHALL preserve primary-scan order, expose no `list` alias or history criteria, and introduce no physical index, migration, or version change

#### Scenario: Frozen definition proves insufficient

- **WHEN** implementation or parity testing cannot satisfy a required behavior with the exact frozen Database, MessageRecord, MessageStore, or ChatRoom definitions
- **THEN** the implementer SHALL stop that work and report only to `@PM`; PM SHALL verify the exact gap and earliest blocked call chain before asking `@molvqingtai` for any contract extension or fallback decision

Production Runtime/application adapters SHALL use `globalThis.setTimeout` and `globalThis.clearTimeout`; naked timer functions SHALL NOT be constructor dependencies or extern capabilities. Tests SHALL use Vitest fake timers. Timer callbacks SHALL still validate attempt/generation identity, and cleanup SHALL cancel owned handles without letting a stale callback mutate current state.

#### Scenario: Exact ChatRoom surface

- **WHEN** the ChatRoom extern, its imports, or a fake replacement is inspected
- **THEN** only the exact frozen commands, protocol values, eight methods, and `Unsubscribe` SHALL exist; `join`, `sendText`, `sendReaction`, `onRecord`, `onMembership`, `reconnect`, Runtime snapshots, source metadata, aliases, and compatibility members SHALL be absent

#### Scenario: One internal session path and ordered application events

- **WHEN** local convergence, a remote live join/leave, initialization, refresh, reconnect, host replacement, or replay changes session state
- **THEN** one private Runtime session-event path SHALL feed the implementation; a normal live change SHALL deliver the new `onSessions` snapshot before its one join/leave fact, while initialization/recovery/replay SHALL deliver snapshots only and no Runtime provenance SHALL escape

#### Scenario: Natural live message callback

- **WHEN** a remote live Chat message, history response, local send, duplicate, conflict, initial store read, or store replay is processed
- **THEN** `onMessage` SHALL fire exactly once only for the first durably accepted remote live `ChatMessage` and SHALL remain silent for every excluded path

#### Scenario: Exact command allocation and send-first persistence

- **WHEN** `sendMessage` accepts `SendTextCommand` or `SendReactionCommand`
- **THEN** the caller SHALL provide none of `id`, `hlc`, `userId`, or `sessionId`; `impls` SHALL allocate them, complete transport acceptance, then call `MessageStore.insert`, and only after that operation successfully settles resolve with the exact allocated-and-transported `ChatMessage`, even when same-id handling retains an existing canonical winner; it SHALL return neither that winner nor a status/result DTO and SHALL add no hidden callback or retry

#### Scenario: Causal local send projection

- **WHEN** local text sends race store-watch refresh, another tab sends the same body/mentions, or a same-id collision retains another canonical winner
- **THEN** the application SHALL derive exactly one local success projection from the `ChatMessage` returned by that call, never visible-record diff, body/mention matching, `onMessage`, or a hidden side channel; transport or MessageStore rejection SHALL return no message, preserve the draft, and emit no local success projection

#### Scenario: Database and MessageStore exclude history protocol

- **WHEN** the Database extern, internal MessageStore, and their implementation imports are inventoried
- **THEN** only Database SHALL be replaceable; MessageStore SHALL remain the one concrete four-method facade; neither SHALL expose history request/response/cursor/cutoff/limit/done projection or a test-only count API, while the outside owner retains cancellable physical history selection and projection

#### Scenario: Duplicate delivery and conflict convergence

- **WHEN** multiple pages/deliveries attempt one message id or a history value conflicts
- **THEN** one atomic insert SHALL win, the first canonical message SHALL remain, same-content replay SHALL be idempotent, different-content conflict SHALL not overwrite it, and side effects SHALL fire at most once

#### Scenario: Global timer ownership

- **WHEN** retry, timeout, grace, or cleanup behavior is constructed and tested
- **THEN** production SHALL call `globalThis` timers directly, tests SHALL control them with fake timers, no timer dependency SHALL be injected, and stale/cancelled callbacks SHALL fail their current-attempt identity check

#### Scenario: No concrete implementation bypass

- **WHEN** application imports are scanned
- **THEN** only composition roots SHALL wire concrete implementations; Domains SHALL depend on extern contracts and public protocol types, never `impls` or Runtime contracts

#### Scenario: Runtime unavailable and accepted send-first loss window

- **WHEN** a send begins before readiness, transport rejects, or transport succeeds but local insertion later fails or never starts because the browser exits
- **THEN** unavailable/rejected input SHALL preserve the draft, write no normal local record, return no `ChatMessage`, and emit no local success projection, while the post-handoff local-loss window SHALL remain accepted with no status, outbox, same-id crash retry, or hidden fallback

#### Scenario: No Runtime history copy

- **WHEN** Runtime and persistence ownership are inspected
- **THEN** the headless Runtime Domains SHALL keep no history replica, Database SHALL remain the only replaceable persistence extern, and the one internal MessageStore SHALL own no peer-history protocol orchestration

### Requirement: Runtime Chat session lifecycle

The headless Runtime SHALL bind each Chat source to a session identity and incarnation. A join SHALL send `session {sessionId, user}` before live text, reaction, or history traffic. A bound `sessionId` SHALL not change its `user.id`; live event `userId` SHALL match the transport-bound session user. A new incarnation SHALL retire the old binding and old history sync, and SHALL trigger exactly one fresh history request for the replacement without running it concurrently with unsettled old source work.

#### Scenario: Session binding and replacement

- **WHEN** a source joins Chat, sends a second session with a changed user, or reconnects with a new incarnation
- **THEN** the Runtime SHALL require the session message first, reject a user change for the same `sessionId`, reject live events whose `userId` does not match the bound user, retire the old binding/sync for a new incarnation, and issue exactly one fresh history request for the replacement

#### Scenario: Future HLC does not advance Runtime clock

- **WHEN** the Runtime receives a wire event rejected because its HLC is more than five minutes ahead of the explicit receiver `now`
- **THEN** it SHALL reject the event, leave the central HLC clock unchanged, and continue processing later valid events

### Requirement: Headless Runtime owns history orchestration

`HistoryDomain` SHALL own history synchronization policy around the application/page Domain's origin store. At each sync start, it SHALL freeze the receiver/requester's own `requester cutoff = requester wall clock - 180 days` (`HISTORY_WINDOW_DAYS = 180`). A remote response message exactly at that requester cutoff SHALL be eligible; only an earlier remote response message SHALL be rejected. At its corresponding provider supply/session admission, the selected provider SHALL separately freeze its own `provider cutoff = provider wall clock - 180 days`. A local candidate exactly at that provider cutoff SHALL be eligible, and only earlier local candidates SHALL be excluded without deletion; its local query, subsequent cursor, and local page failover SHALL retain that provider cutoff without re-reading time. A dormant successor SHALL freeze its own provider cutoff at its own admission and SHALL retain it after promotion. The cutoffs SHALL NOT be transmitted or required to match. The requester SHALL independently validate every response against its own cutoff and has final acceptance authority, so a remote provider SHALL NOT expand the requester window, although clock skew MAY omit boundary candidates that the requester would otherwise accept. The requester cutoff SHALL remain unchanged through that sync's pagination, retry, and provider failover. `HistoryDomain` SHALL enforce at most one outstanding request per source with a 10-second operational timeout, and stop a session at 8MiB or 10,000 messages while preserving the most recent accepted responses and never falsely claiming provider completion. `HistoryDomain` SHALL select one application/page supplier per request, keep requester/provider State scoped by `(sourcePeerId, domain, syncId, unique sync token)`, and SHALL not store a history copy or read-model replica. The public protocol remains responsible only for validating the typed history request/response shape, cursor, response-size limit, and user/message references.

The Runtime page contract SHALL use an explicit `{supplyId}` request/cancel event plus `resolveHistorySupply`/`rejectHistorySupply` RPC. Each page supply attempt SHALL have a 5-second boundary. A page query SHALL receive an `AbortSignal` wired to its readonly IndexedDB transaction; the signal SHALL abort that transaction and gate all subsequent projection/filter/sort work, and the page SHALL confirm physical settlement only after the entire query and gated work truly exits. Failover, old-job release, and successor promotion SHALL wait for that confirmation. Supplier work SHALL be serial per source, isolated across domains and sources, and admitted through one pipeline covering supplier selection, encode, send, and final release; the pipeline SHALL have at most four active jobs, 32 admitted requests, and 8KiB of decoded request metadata. A replacement session's one-shot request arriving before the old source job settles SHALL occupy one dormant source-local successor within the same global admission; the successor itself SHALL count toward the 32-request and 8KiB decoded-metadata limits, SHALL NOT run concurrently, and SHALL automatically promote after physical settlement without another peer request. Timeout, leave, and release MAY remove an unstarted successor; a started job SHALL remain counted until settlement. A completed response releases its source slot immediately after send settlement, and an old timer/token SHALL NOT delay or close a newer domain/request. Cleanup SHALL retain active admission until physical settlement and remove dormant successors without starting them.

#### Scenario: Frozen local history policy

- **WHEN** a history sync begins, and when requester pagination/retry/provider failover, provider local query/subsequent cursor/local page failover, or dormant-successor promotion continues
- **THEN** the Runtime SHALL freeze the receiver/requester's own `requester cutoff = requester wall clock - 180 days`, accept remote response messages exactly at that requester cutoff and reject only earlier remote response messages after independently validating them against that requester cutoff. At corresponding provider supply/session admission, the provider SHALL separately freeze its own `provider cutoff = provider wall clock - 180 days`, accept local candidates exactly at that provider cutoff, exclude only earlier local candidates without deleting them, and retain it through its local query/subsequent cursor/local page failover; a dormant successor SHALL freeze its own provider cutoff at its own admission and retain it after promotion. The cutoffs SHALL NOT be transmitted or required to match; the requester has final acceptance authority, so remote data cannot expand its window, though clock skew MAY omit otherwise acceptable boundary candidates. The requester SHALL retain its cutoff without re-reading time through pagination/retry/provider failover, stop at provider exhaustion/cutoff/8MiB/10,000 events, and SHALL distinguish local budget exhaustion from provider completion

#### Scenario: Scoped timeout ownership

- **WHEN** an old requester/provider timeout fires after a replacement domain, request, or sync has started
- **THEN** the Runtime SHALL require the `(sourcePeerId, domain, syncId, unique sync token)` match before changing state, so the replacement retains its own timeout interval

#### Scenario: Supplier isolation across domains and sources

- **WHEN** a peer leaves domain A while domain B is waiting on a local supplier, or source A's supplier is hung while source B requests history
- **THEN** only the invalidated domain/source work SHALL be removed; eligible domain B and source B work SHALL continue within the bounded cross-source concurrency pool

#### Scenario: Physical cancellation settlement

- **WHEN** a selected page supply attempt reaches its 5-second boundary and the Runtime sends its `supplyId` cancellation
- **THEN** the page SHALL use the `AbortSignal` to abort its readonly IndexedDB transaction and gate subsequent projection/filter/sort work, and SHALL confirm only after the entire physical query and gated work truly exit; failover, old-job release, and successor promotion SHALL wait for that confirmation, and ignored cancellation SHALL keep the old job admitted until settlement

#### Scenario: Bounded provider admission

- **WHEN** supplier work is queued or active and cleanup, rejoin, or replacement occurs
- **THEN** started jobs SHALL remain counted until final settlement, dormant successors SHALL be included in the same global counts and removed without starting, and admission SHALL never exceed four active jobs, 32 requests, or 8KiB of decoded request metadata; excess requests SHALL be dropped source-locally without room reconnect

#### Scenario: Replacement request continues after prior settlement

- **WHEN** a replacement session sends its one history request while the prior source job is unsettled
- **THEN** the Runtime SHALL admit it as the one dormant source-local successor within the global 32-request/8KiB decoded-metadata admission, SHALL count it against those limits, SHALL NOT run it concurrently, and SHALL automatically promote it to supplier selection after the old physical job settles without requiring another peer request

#### Scenario: One end-to-end concurrency boundary

- **WHEN** supplier selection, encoding, or response sending is still active for an admitted history job
- **THEN** all stages SHALL retain the same job admission, and no more than four jobs SHALL be active across the supplier-to-encode-to-send pipeline

#### Scenario: Completed provider releases its source slot

- **WHEN** source A completes a final response for domain A and immediately requests domain B
- **THEN** domain B SHALL enter supplier work after the domain A send settles, without waiting for the old 10-second timer; any old timer/token SHALL fail its source/domain/request identity check

#### Scenario: History application has no UI side effects

- **WHEN** a valid history response reaches an application/page Domain
- **THEN** records SHALL be inserted-if-absent through the origin store without notifications, unread increments, or system notices caused solely by history application

### Requirement: Idempotent inbound delivery without locks

The Runtime SHALL publish each inbound peer message to all pages of the domain as an event carrying the stable message ID. Each page SHALL persist the message through one atomic insert-if-absent transaction against the shared domain store. Only the page whose transaction first inserts the message SHALL trigger side effects such as notification or unread increments. The system SHALL NOT use locks for this coordination.

#### Scenario: Duplicate delivery across tabs

- **WHEN** multiple pages of one domain receive the same inbound message event
- **THEN** exactly one atomic insert SHALL succeed, other pages SHALL observe the existing record without duplicating it, and side effects SHALL fire at most once

#### Scenario: Page crash during delivery

- **WHEN** a page crashes after receiving an event but before acknowledging
- **THEN** the system SHALL rely on the event buffer and idempotent persistence, not on lock release, to complete delivery safely

### Requirement: Event sequence and un-ACK buffer

`DeliveryDomain` SHALL maintain a short-term per-domain event sequence and volatile inbound un-ACK delivery buffer bounded to 512 records and 8MiB. An event SHALL be cleared once at least one page acknowledges durable persistence. A history-response batch SHALL be admitted atomically or rejected as a whole when it would exceed either bound; rejection SHALL not partially receive records, advance the cursor, or request the next response. A page that reconnects SHALL be re-sent unacknowledged inbound events by sequence. Events still unacknowledged when the domain's grace period ends SHALL be discarded. Loss of the buffer when the browser kills the Runtime is an accepted boundary. This inbound buffer is not an outbound outbox and SHALL NOT be used to recover or retry a local send.

#### Scenario: ACK clears buffer

- **WHEN** at least one page of the domain acknowledges durable storage of an event
- **THEN** the Runtime SHALL remove that event from the un-ACK buffer

#### Scenario: Reconnect resend

- **WHEN** a page reconnects within the grace period
- **THEN** the Runtime SHALL re-deliver buffered events by sequence so the page can persist them idempotently

#### Scenario: Grace-expiry discard

- **WHEN** the domain's 5-second grace ends with unacknowledged events
- **THEN** the Runtime SHALL discard those events and accept the documented loss boundary

#### Scenario: Atomic history batch admission

- **WHEN** a history-response batch would exceed 512 records or 8MiB in the volatile un-ACK buffer
- **THEN** the Runtime SHALL reject the whole batch, preserve existing records, leave the cursor unchanged, and SHALL NOT request the next response

### Requirement: Runtime WirePipeline and internal RPC contracts stay inside Runtime boundaries

`WireDomain` SHALL own per-room send serialization, per-source decode queues bounded to at most 8 frames and 256KiB of wire data, and source-local drop/apply/flush behavior. `HistoryDomain` SHALL own history concurrency admission and resource scheduling. The page-host boundary SHALL own the internal comctx RPC contracts/namespace. Malformed frames and queue overflow SHALL be dropped only for the affected source, logged with rate limiting, and SHALL NOT reconnect the room. Those contracts SHALL not be exported from `src/protocol/index.ts`; queue/drop types SHALL live with `WireDomain`, history admission types with `HistoryDomain`, and RPC types with the page-host boundary rather than the codec or public protocol module. `compareHLC` and `compareEventPosition` implementations SHALL live in the application/page Domain/model layer, or in a shared Domain/model module when both pages and Runtime consume them, while the public protocol defines only the canonical `(hlc, id)` ordering rule. HLC validators exposed by protocol SHALL accept an explicit `now` argument and SHALL NOT call `Date.now()` internally.

#### Scenario: Internal Runtime ownership

- **WHEN** queue/drop/pipeline scheduling, ordering implementation, or page-host RPC contracts are inspected
- **THEN** queue/drop/pipeline scheduling and page-host RPC contracts SHALL be defined under headless Runtime owners, while ordering implementations SHALL be defined under application/page Domain/model owners or a shared Domain/model module; none SHALL be exported from `@/protocol` or imported by protocol code

#### Scenario: Source-local decode overflow

- **WHEN** one source exceeds 8 queued frames or 256KiB of queued wire data, or sends a malformed frame
- **THEN** the Runtime SHALL drop only that source-local frame/work, rate-limit the diagnostic, preserve other sources, and SHALL NOT reconnect the room

#### Scenario: Final send settlement releases source slot

- **WHEN** a provider's final history response send settles and an old timeout/token later fires
- **THEN** the Runtime SHALL release the source slot immediately after send settlement, and the old timer/token SHALL fail its identity check without delaying or closing a newer domain/request

### Requirement: Remesh DDD and CQRS govern every Runtime Domain

Every Runtime Domain SHALL document and implement its State, Query, Command, Event, Effect, and Extern surface. A Command SHALL express intent and SHALL NOT be treated as proof that external work already occurred. A Query SHALL be a pure read or derivation from State and SHALL perform no I/O, issue no Command/Event, and mutate no State. An Event SHALL represent an immutable fact that already occurred after a transition or external outcome and SHALL NOT be used as a disguised Command. An Effect SHALL contain asynchronous or external I/O and SHALL feed its outcome back through the owning Domain's Command/Event path rather than mutate another Domain directly. An Extern SHALL inject an external capability and SHALL NOT become a parallel State, cache, or recovery owner.

Application/UI code SHALL interact through Queries, Commands, and Events only. It MAY retain join input, draft state, and display read models, but it SHALL NOT own or write back a Runtime network fact. A shared network fact SHALL be read from the same Domain instance obtained through `domain.getDomain(...)`, never recreated by a module or copied into another writable State.

#### Scenario: Query remains pure

- **WHEN** any Runtime or application Query is evaluated
- **THEN** it SHALL derive only from current Domain State and SHALL perform no transport, persistence, comctx, timer, provider, Command, Event, or State-write operation

#### Scenario: External result re-enters its owner

- **WHEN** an Effect completes provider, clock, identity, page-port, persistence, or comctx I/O
- **THEN** the result SHALL re-enter through the owning Domain's Command/Event transition before becoming observable State, and the Effect SHALL NOT mutate another Domain's State directly

#### Scenario: UI has no Runtime write authority

- **WHEN** a page renders sessions, presence, readiness, or message projections
- **THEN** it SHALL derive them from application Queries fed by Runtime/application Events and SHALL NOT use the display model as a recoverable or writable Runtime source

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

The Domain dependency graph SHALL be acyclic. Connection MAY consume Lifecycle, Wire, Session, World, and History; Session MAY consume Wire and Delivery; World MAY consume Wire; History MAY consume Wire, Delivery, and Session; Delivery MAY consume Lifecycle; Wire SHALL consume only the immutable public protocol and Runtime-private provider Extern. The resulting chain `Connection -> History -> Session -> Delivery -> Lifecycle`, together with the allowed edges toward Wire, SHALL remain acyclic. Session SHALL use Delivery only through one admit Command after Session-owned live source/user validation. History SHALL use Session only through a Query that verifies the current trusted `(room/domain, source)` binding before History-owned requester/provider transitions. A Domain SHALL consume another Domain only through its Queries, Commands, and Events.

#### Scenario: Owner matrix has no duplicate writer

- **WHEN** each lease, grace, connection generation, committed session/HLC, World presence, history session/cursor/batch, delivery sequence/buffer, and trusted wire/provider fact is traced
- **THEN** exactly one listed Domain SHALL define its writable State and transitions, while every other consumer uses that owner's CQRS surface

#### Scenario: Runtime graph remains acyclic

- **WHEN** Runtime Domain imports and `domain.getDomain(...)` dependencies are inspected
- **THEN** they SHALL follow the documented direction, contain no cycle, and expose no direct import or mutation of another Domain's State definition

#### Scenario: Server owns no network truth

- **WHEN** the comctx Server and host composition are inspected
- **THEN** they SHALL contain only graph construction, Extern injection, and request/reply/subscription adaptation, with no authoritative session, generation, presence, history, delivery, or trusted-room map

### Requirement: ChatRoom Runtime implementation is a state-free application adapter

The public `ChatRoomExtern` SHALL remain exactly the eight frozen methods. `src/domain/impls/runtime/ChatRoom.ts` SHALL be only a Runtime client proxy, Event bridge, persistence-before-ACK boundary, and history-supply boundary. It SHALL contain no retained join command, session map, local-session or published-session State, Runtime generation, join/recovery queue, snapshot cache used for replay, or writable network fact. It MAY retain only infrastructure needed to settle one in-flight call or dispose one active subscription; those handles SHALL be bounded to that operation/subscription and SHALL NOT be read as State or used for recovery.

Inbound remote live messages SHALL still settle canonical MessageStore insertion before Runtime ACK. History supply SHALL still query the application-owned store through the private page-host contract. Outbound `sendMessage` SHALL retain `allocate -> transport acceptance -> local insert settlement -> exact causal ChatMessage result`, with `onMessage` remaining remote-live-only. Internal page-to-Runtime comctx Commands/Events MAY change in one clean cut to express the Domain graph, but the public eight methods, persistence/ACK order, product behavior, and reliability option B SHALL NOT change.

#### Scenario: Adapter has no hidden recovery State

- **WHEN** the Runtime ChatRoom implementation is inspected after construction and across host recovery
- **THEN** it SHALL have no command/session/local-session/published-session/generation/recovery map or snapshot authority, and host recovery SHALL converge from current application intent plus Runtime Domain State

#### Scenario: Adapter preserves persistence and ACK order

- **WHEN** a first remote live ChatMessage crosses the adapter
- **THEN** canonical insertion or confirmed canonical existence SHALL settle before ACK, while history and local sends SHALL remain excluded from `onMessage`

#### Scenario: Internal control contract changes cleanly

- **WHEN** the page-host comctx contract is replaced to express CQRS Commands and Events
- **THEN** no old request/event alias, fallback, dual listener, or dual read/write route SHALL remain, and the eight-method application port plus product behavior SHALL be unchanged

### Requirement: Provider capability is private behind WireDomain

The Runtime SHALL define one private `RoomTransportExtern` injected only into `WireDomain`. It SHALL express provider-neutral capabilities for stable local peer identity, room join/leave, targeted send, transport-confirmed inbound source, peer ready/leave, room close/error, and deterministic dispose. `RoomTransport` MAY remain only as the concrete implementation shape behind that Extern; it SHALL NOT be a public application port, protocol export, or capability imported by UI, application Domains, or non-Wire Runtime Domains.

Artico SHALL appear only in the provider implementation and explicit composition root. `WireDomain` SHALL be the sole anti-corruption boundary: it validates trusted room/source identity, codec/schema/size limits, ordering and queue bounds, then emits typed Runtime Events; outbound typed Domain intent is encoded and sent only through its Effect and `RoomTransportExtern`. The former imperative `WireExtern` route and every direct concrete/provider call from another Domain SHALL be removed.

#### Scenario: Provider can be replaced without application change

- **WHEN** a second provider implementation satisfies the private provider contract
- **THEN** ChatRoomExtern, application Domains, Runtime owner semantics, peer protocol, persistence, and UI SHALL require no change; only provider implementation/composition SHALL differ

#### Scenario: Artico does not leak

- **WHEN** imports, public exports, Domain Externs, protocol types, and comctx contracts are scanned
- **THEN** Artico symbols SHALL exist only in its provider implementation and explicit composition, and only `WireDomain` SHALL obtain `RoomTransportExtern`

#### Scenario: Provider contract parity

- **WHEN** the provider contract suite runs against the Artico implementation and deterministic fake
- **THEN** both SHALL satisfy stable peer identity, join/leave, trusted inbound source, targeted send, target-local isolation, room-level failure, close, error, and dispose semantics without adding delivery acknowledgement

### Requirement: Immutable peer values terminate in explicit Domain mappings

`WireDomain` SHALL terminate every protocol DTO at one typed accepted-message Event and SHALL NOT expose raw provider callbacks, decoded unknown values, or a shared mutable wire model. `SessionMessage` SHALL enter Session binding/generation commit Commands, and `SessionEndMessage` SHALL enter Session's source-bound idempotent generation-end Command. `TextMessage` and `ReactionMessage` SHALL enter Session source/user validation and then Delivery admission. `HistoryRequestMessage` and `HistoryResponseMessage` SHALL enter History Commands; History SHALL verify the current trusted source/session binding through a Session Query before its requester/provider transition, with accepted response batches entering Delivery atomically. `WorldRoomMessage` SHALL enter World source-snapshot replacement. Provider peer-ready/leave and room-close/error facts SHALL enter Connection transitions, which SHALL request Session/World/History cleanup through their Commands rather than mutate them.

Outbound `SessionMessage` SHALL originate from Session after an accepted Connection generation. Outbound `SessionEndMessage` SHALL originate from final Session release only after private lease retirement and SHALL be sent before physical Chat-room leave. Outbound Text/Reaction SHALL use Session-owned id/HLC allocation and a Wire send Command. History request/response SHALL originate from History State and page-supply outcomes. `WorldRoomMessage` SHALL originate from World's current full snapshot only after Connection acceptance. All outbound values SHALL use the strict current schemas and unchanged codec algorithm; only the Owner-authorized SESSION `presenceId` and SESSION_END shapes differ from the prior baseline.

#### Scenario: Chat message crosses one trust and delivery path

- **WHEN** Wire accepts a TextMessage or ReactionMessage from a transport-confirmed source
- **THEN** Session SHALL validate the committed source/user binding before Delivery receives one admit Command, and no other Domain or adapter SHALL store a parallel writable copy

#### Scenario: History response crosses one owner path

- **WHEN** Wire accepts a HistoryResponseMessage
- **THEN** History SHALL first verify the current trusted source/session binding through a Session Query, then validate its requester/provider/cursor/budget State and issue at most one atomic Delivery batch admission, without Wire, Server, or ChatRoom adapter owning the history session

#### Scenario: World snapshot crosses one owner path

- **WHEN** Wire accepts a WorldRoomMessage or Connection accepts a generation that must publish local presence
- **THEN** World SHALL be the only source-snapshot/presence owner and SHALL replace or publish one full current snapshot through the unchanged protocol

### Requirement: Remesh modules represent only semantic reuse

A surviving `*Module` capability SHALL be a real `Remesh.module` instance that is reusable/configurable and whose State, Queries, Commands, Events, transitions, cancellation, and failure semantics are isomorphic in at least two host Domains. Each instantiated module SHALL remain private to its host Domain. A module SHALL NOT be used to share one Runtime State instance across Domains; cross-Domain authority SHALL come only from the unique owner Domain obtained through `domain.getDomain(...)`.

Existing Status-like capabilities SHALL either become real `Remesh.module` definitions or lose the misleading `Module` name. Attempt/generation logic SHALL become a module only after at least two flows prove the same transition and failure semantics. `DeliveryDomain` SHALL remain a direct unique owner while there is no second isomorphic consumer. Codec/parser, ordering, range, size, and provider callback logic SHALL remain pure functions or Extern implementation logic rather than forced modules.

#### Scenario: Shared State is not duplicated by modules

- **WHEN** two Domains need the same Runtime fact
- **THEN** both SHALL consume the unique owner Domain, and SHALL NOT instantiate matching modules as parallel writable copies

#### Scenario: Module naming is truthful

- **WHEN** a production `*Module` symbol is inspected
- **THEN** it SHALL call `Remesh.module` and satisfy the semantic-reuse rule, or the helper SHALL have a non-Module name

### Requirement: Architecture migration is a structural clean cut

Baseline `9c90bb0...` SHALL remain the functional/fail-before reference and SHALL NOT be accepted as the final Runtime architecture. The requirements commit SHALL remain authority-only and SHALL NOT become a source ancestor. Candidate-sensitive structural tests SHALL first fail on baseline for the stateful ChatRoom adapter, catch-all Network owner, missing private RoomTransport Extern/Wire Domain, CQRS boundary violations, misleading Module names, dependency cycles, and architecture artifact mismatch.

Implementation SHALL move one writable owner at a time and immediately delete that fact's old owner. No dual read, dual write, alias, fallback, compatibility adapter, old `WireExtern` route, or transitional release SHALL remain. The final candidate SHALL have all source, tests, comments, tasks, residue cleanup, architecture JSON, and generated HTML complete before validation begins.

#### Scenario: Baseline proves structural sensitivity

- **WHEN** the architecture fail-before suite runs on exact `9c90bb0...`
- **THEN** each documented old-owner/provider/module/artifact violation SHALL fail for its intended reason while protected peer-wire behavior remains a passing control

#### Scenario: Final candidate has no old authority path

- **WHEN** source, imports, State definitions, comctx contracts, tests, comments, and artifacts are scanned
- **THEN** no catch-all Network owner, stateful ChatRoom recovery cache, old WireExtern path, provider leak, false Module name, dual owner, or compatibility route SHALL remain

#### Scenario: Architecture artifacts are synchronized

- **WHEN** the canonical architecture JSON is rendered
- **THEN** the generated HTML SHALL reproduce deterministically and show the exact application port, state-free client, seven Runtime owners, immutable protocol, private RoomTransport Extern, provider implementation, and one-way dependency flow

### Requirement: Session classifies logical presence across physical lifecycles

Session SHALL uniquely own local active-generation state, unsettled in-flight final-end identity, rejected retryable pending-final-end identity, observer-accepted settled-cleanup identity, and a bounded observer ledger. A private two-method `PresenceStoreExtern` SHALL persist those facts through `browser.storage.session` across supported Runtime host replacement; it SHALL NOT expand MessageStore, the origin database schema, `RuntimeServer`, `ChatRoomExtern`, or any UI/public model. Active lease, in-flight final end, retryable pending final end, and settled cleanup SHALL be four mutually exclusive strict records. Session SHALL allocate a generation only for initial join or true return after complete final end. Refresh, reconnect, recovery, replay, duplicate SESSION, additional physical session, page reattach, supported host replacement, and replacement recovery of any final-end marker SHALL reuse the retained generation and emit snapshot convergence without a logical join/leave.

Chrome MV3 SHALL construct the concrete session-backed PresenceStore in the background Service Worker and expose only its existing `load`/`save` methods to the Offscreen Runtime through a dedicated comctx adapter over a point-to-point Runtime Port. Port name and comctx namespace SHALL be routing values rather than authority. Before delivering a message, Background SHALL require the transport sender's runtime id, exact Offscreen document URL, and absence of a tab; content, options, and every other extension source SHALL be disconnected without reading or writing durable state. Every provider response SHALL resolve through the exact request-to-Port binding recorded when its request arrived. If that binding has detached or been replaced, the response SHALL be dropped and SHALL NOT fall back to the current active Port. Offscreen SHALL admit a response only while that request remains pending on the same binding; uncorrelated, replayed, old-binding, wrong-namespace, wrong-direction, and broadcast responses SHALL reach no comctx callback. From request-ID response registration, each one-shot call SHALL reserve exactly one ordered transport generation. Generic response subscription SHALL NOT open a Port. The local heartbeat response subscription SHALL unregister before the actual `apply`, and that `apply` SHALL consume the oldest remaining request reservation. If the reserved generation terminates before pending insertion, the call SHALL reject before connecting or posting to a replacement and the adapter SHALL remove that operation's one-shot response entry. Port disconnect, synchronous connect/send failure, and adapter disposal SHALL reject every request and pre-send reservation owned by the terminal generation exactly once and release every adapter-owned per-operation response entry, without hanging or automatically replaying `load` or `save`; stale and late traffic SHALL traverse no terminal operation callback, and only a later new application call with a new request ID may create a replacement Port and correlation. Provider-owned long-lived callback handles SHALL retain their existing refresh/re-registration lifetime and SHALL NOT be removed by this one-shot cleanup. The dedicated adapter SHALL use Port send/disconnect as its liveness authority, satisfy comctx heartbeat preflight locally, and transmit only actual one-shot PresenceStore operations. Offscreen SHALL register no broadcast Runtime-message listener for PresenceStore, so another context cannot forge a provider response or observe one through that adapter. The Offscreen document SHALL receive the dependency through host assembly and SHALL NOT dereference an unavailable `browser.storage.session`, create memory storage, or route presence records through tabs/pages. Firefox MV2 SHALL pass the same concrete session-backed store directly from its persistent Background Page into the same shared host. Storage rejection and authenticated-Port termination SHALL reach Session's existing request-local failure fences without acknowledging, discarding, or weakening the durable transition; a later call after Service Worker recreation SHALL reconnect and use the same session-backed record.

A peer discovered during preparation SHALL establish baseline membership without a historical observer join. A newly accepted post-baseline generation SHALL produce one observer-local join only when that user transitions from zero active logical generations to one. Physical `PeerLeft` SHALL not produce a logical leave. A valid SESSION_END SHALL produce one observer-local leave only when the user transitions from one active generation to zero. On graceful final local release, Session SHALL replace the active lease with an in-flight final-end identity, send SESSION_END, durably remove that identity after settlement, and only then allow Connection to leave the Chat room. The departing local client need not persist its own leave.

The local self-join notice SHALL be generation-scoped, persist immediately after successful new-generation join without waiting for history, and consume only Runtime private join provenance. Reconnect/recovery/host replacement SHALL not create a candidate; later true return SHALL use a later stable generation event time and produce a distinct notice. All SystemNotice records SHALL remain observer-local and SHALL never enter ChatMessage history.

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

#### Scenario: Six-timepoint A/B/C/D lifecycle

- **GIVEN** independent actual Runtime Server/Session/Wire stacks use deterministic in-repo transport, A is an existing observer, B is a new local user, C is an additional physical session for B's generation, and D is B's replacement Runtime host
- **WHEN** the control executes preparation baseline, B first join, duplicate/C publication, transient B loss/D recovery, D final release, and B later return
- **THEN** B and A SHALL each persist one join for the first logical transition; duplicate/C/loss/recovery SHALL add no notice; A SHALL persist one leave on final end; and later return SHALL persist one fresh self join plus one fresh observer join

#### Scenario: Physical loss remains provisional

- **WHEN** a bound peer leaves transport without a valid final generation end and later republishes the same generation from reconnect, recovery, host replacement, or rejected-final-end replacement recovery
- **THEN** Session SHALL publish snapshots only and preserve the logical observer state without a leave/join pair

#### Scenario: Duplicate and late lifecycle facts

- **WHEN** SESSION or SESSION_END is duplicated, or an ended generation's SESSION arrives late
- **THEN** Session SHALL apply the accepted generation/end at most once, reject resurrection of the ended generation, and persist no duplicate notice

### Requirement: Invalid records are isolated at send, receive, and retained-load boundaries

Every uncontrolled record boundary SHALL use the existing strict Valibot schemas and `safeParse`. Invalid inbound Runtime records SHALL be rejected before persistence, barrage, or primary-list publication; the adapter SHALL diagnose and ACK only that invalid sequence so later valid delivery continues. MessageStore queries SHALL decode retained physical rows independently: valid rows remain queryable, invalid raw rows remain physically untouched, and bounded deduplicated private diagnostics use the existing conflicts store without invalidating canonical-record watchers. A diagnostic-write failure SHALL not hide valid results. No Zod schema, database version change, MessageStore method, or public failure channel SHALL be added.

#### Scenario: Valid inbound event beside invalid retained data

- **GIVEN** one unsupported retained row remains in the physical records store
- **WHEN** a valid remote live event is accepted
- **THEN** the valid event SHALL persist, emit once to realtime consumers, and appear in the primary list; the invalid row SHALL remain physical with one bounded diagnostic and SHALL not fail the canonical query

#### Scenario: Invalid inbound does not poison the lane

- **WHEN** one Runtime inbound record fails strict MessageRecord validation and a later valid event follows
- **THEN** the invalid event SHALL produce request-local diagnostics and no persistence/barrage/list publication, its sequence SHALL be discarded through ACK, and the later valid event SHALL settle normally

### Requirement: Adjacent SystemNotice grouping is UI-only and history-responsive

After the complete latest application projection is canonically sorted by event `(hlc,id)`, the UI SHALL group each maximal adjacent run of SystemNotice messages. A singleton SHALL render unchanged. A run of two or more SHALL initially render the latest notice and an icon expand/collapse control without a numeric count; expansion and collapse SHALL reveal or hide the earlier notices in canonical order through a height/opacity transition, while reduced-motion preference SHALL remove the transition without changing content. Any non-notice message SHALL split groups. The transform SHALL not alter, delete, merge, or persist canonical records, and lifecycle terminology SHALL not appear in the UI.

Each grouped row SHALL derive one stable UI identity from its first canonical notice's persistent ID. Extending the same run SHALL preserve that identity. Before React and Virtuoso receive a row, text SHALL project as `message:<id>`, singleton notice as `single-notice:<id>`, and grouped notice as `notice-group:<first-notice-id>`. These row-kind namespaces SHALL remain structurally disjoint for every wire-valid opaque ID, including IDs that begin with another row kind's namespace. Every row SHALL pass that same projected identity to Virtuoso as the item key. Raw ID alone, array position, first/last presentation flags, and expand/collapse state SHALL NOT participate in row identity.

Streaming history MAY insert Chat messages before, after, or between existing SystemNotice messages according to canonical event time. The UI SHALL recompute grouping from the new sorted projection so late history can create, split, or reposition a group without changing observer-local notice ownership or synchronizing notices through peer history.

#### Scenario: Non-notice splits a run

- **WHEN** two adjacent notices are followed by a Chat message and then two more adjacent notices
- **THEN** the UI SHALL render two independent collapsible groups separated by the unchanged Chat message

#### Scenario: Late history reprojects grouping

- **WHEN** streaming history inserts a canonically ordered Chat message between notices that were previously adjacent
- **THEN** the next UI projection SHALL split the prior group while every canonical notice and Chat record remains unchanged

#### Scenario: Virtualized grouped-row identity remains stable

- **WHEN** a two-notice group renders, its expand/collapse state changes, another notice extends the same run, or late history splits that run
- **THEN** Virtuoso SHALL receive a defined persistent key for every rendered row; expansion and extension SHALL not remount the original group, and split rows SHALL have distinct non-index identities

#### Scenario: Count-free animated notice disclosure

- **WHEN** a grouped notice row is expanded or collapsed
- **THEN** earlier notices SHALL enter or leave in canonical order through a smooth height/opacity transition, the latest notice SHALL remain the control anchor, reduced-motion preference SHALL remove the transition, and no numeric group count SHALL render

#### Scenario: Opaque IDs cannot impersonate another row kind

- **WHEN** text or notice IDs begin with `message:`, `single-notice:`, or `notice-group:` and late history creates or splits an adjacent-notice group
- **THEN** every React and Virtuoso identity SHALL retain its actual row-kind namespace, remain unique across the projection, preserve the original group through expansion or extension, and never transfer DOM, measurement, or scroll identity to another row kind

### Requirement: Domain-scoped manual reconnect

The actions menu SHALL include "Reconnect this site", which SHALL rebuild only the current domain's ChatRoom connection and re-publish that domain's presence. Because the frozen `ChatRoom` has no `reconnect` method, the application Domain command SHALL use the exact public `leaveRoom()` and retained `JoinRoomCommand` with `joinRoom(command)` rather than extending the extern. Availability SHALL be exactly `joined && !reconnecting` in Chrome and Firefox; `panelOpen` SHALL NOT participate. One enabled activation SHALL create one authoritative request identity and pending fact, immediately invoke the leave/join composition, preserve the main panel's current open/closed state, disable the Refresh control, and spin that control's own icon. The button SHALL expose no Ready text, success region, result badge, or second terminal state: it SHALL return to its ordinary eligible icon when the matching request terminal settles. Every callback SHALL validate the request identity so stale work cannot clear a newer request's spin or feedback. Toast subscription, mount, paint, dwell, failure, unmount, or absence SHALL NOT delay, cancel, reject, or redefine reconnect dispatch or the independently captured network operation outcome. A visibly painted request-owned loading Toast SHALL contribute the accepted minimum 300ms dwell; feedback absence, unmount, or presentation failure SHALL settle boundedly and SHALL NOT strand the button or duplicate gate. This pending lifetime SHALL reject duplicates only and SHALL NOT become Runtime or network authority.

The reconnect feedback surface SHALL restore the original direct `AppMain -> <Toaster>` structure. The Toaster SHALL be a direct `AppMain` child and use the existing AppMain Motion translate containing mechanism. There SHALL be no reconnect wrapper, reconnect-specific Toaster component, always-mounted launcher feedback layer, host-page global overlay, or Refresh-specific Toast restyling. The direct Toaster SHALL retain the original `richColors`, current `themeMode`, `offset="70px"`, `visibleToasts={1}`, `position="top-center"`, and `dark:bg-slate-950 border dark:border-slate-600` Toast classes. Reconnect SHALL add no custom geometry, width, content-fit, placement, pointer, opacity-tracking, pseudo-element, or eligibility styles. While `AppMain` is mounted, the same reconnect request identity SHALL own one Toast flow that presents loading and then the matching ready/success or failure result; the Refresh button SHALL carry no terminal result feedback. While the panel is closed, `AppMain` and Toaster SHALL be absent: reconnect SHALL still start immediately, the button SHALL remain the request's pending indicator, and no Toast SHALL be queued as an operation prerequisite. Opening the panel during an active request MAY present only that current pending flow; a request that already terminated SHALL NOT replay on a later mount. Closing the panel MAY remove Toast presentation but SHALL NOT start, cancel, delay, replay, restart, or redefine reconnect. Matching cleanup SHALL address only that request's Toast ID, SHALL NOT use an unscoped/global dismissal, and SHALL preserve unrelated Toasts. Reconnect SHALL NOT rebuild the shared WorldRoom; the Runtime SHALL auto-reconnect the WorldRoom only on its own connection failure. The Options page SHALL NOT gain a global reconnect entry. Owner task #208 supersedes deprecated docs exact `3034b343...` and the later launcher-owned feedback model; their auto-open, paint-before-operation, launcher ownership, custom Toast geometry/pointer styling, and historical evidence SHALL NOT enter or certify source ancestry.

#### Scenario: Manual domain reconnect

- **WHEN** a user activates "Reconnect this site" on one domain
- **THEN** only that domain's ChatRoom connection and presence SHALL be rebuilt, and other domains and the WorldRoom SHALL be undisturbed

#### Scenario: Button and mounted Toast share one reconnect request

- **GIVEN** `AppMain` and its original Toaster are mounted
- **WHEN** an enabled user activates reconnect and the current-domain leave/join composition succeeds or fails
- **THEN** one request identity SHALL immediately invoke the composition, disable and spin the Refresh button, and own one loading-to-ready/success-or-failure Toast flow; the bounded request terminal SHALL stop only the matching spin, and the button SHALL expose no separate result state

#### Scenario: Reconnect does not wait for Toast presentation

- **GIVEN** the Toast library defers its subscriber update or fails to render loading
- **WHEN** an enabled user activates reconnect
- **THEN** the leave/join ports SHALL be invoked immediately, the Refresh icon SHALL represent the same pending request, no Toast state SHALL delay or alter that operation, and a bounded presentation-failure outcome SHALL allow the shared request terminal rather than strand the icon or duplicate gate

#### Scenario: Fast terminal reconnect respects mounted feedback

- **GIVEN** `AppMain` remains mounted and the leave/join ports settle before the request-owned loading Toast receives its first visible paint
- **WHEN** the operation outcome reaches the shared request
- **THEN** the operation outcome SHALL be captured without waiting for feedback, while the matching Refresh icon and loading Toast SHALL remain tied to that request until the visible Toast completes its 300ms minimum dwell and transitions to the matching terminal Toast result

#### Scenario: Stale terminal work cannot clear a newer request

- **GIVEN** one reconnect has settled and a later reconnect owns a newer request identity
- **WHEN** delayed Toast paint, dwell, or terminal cleanup from the older request completes
- **THEN** it SHALL NOT stop the newer Refresh spin, dismiss the newer loading Toast, emit a newer error, or alter the newer reconnect operation

#### Scenario: Original AppMain Toaster structure and visuals are preserved

- **WHEN** the main panel renders reconnect feedback
- **THEN** `AppMain` SHALL contain the direct original Toaster with `richColors`, current theme, `offset="70px"`, `visibleToasts={1}`, `position="top-center"`, and the existing dark Toast classes, without an added wrapper, launcher layer, reconnect-specific Toaster component, or custom geometry/pointer styling

#### Scenario: Closed-panel reconnect has no Toast prerequisite

- **GIVEN** the main panel is closed and `AppMain` plus Toaster are unmounted
- **WHEN** an enabled user activates reconnect
- **THEN** the panel SHALL remain closed, the leave/join composition SHALL start immediately, the matching Refresh icon SHALL remain disabled and spinning while pending, and Toast absence SHALL neither queue nor strand the operation

#### Scenario: Ready and result feedback use Toast only

- **GIVEN** `AppMain` and Toaster are mounted for the reconnect request
- **WHEN** that request captures success/readiness or failure
- **THEN** the request-owned Toast flow SHALL present the matching terminal result, while the Refresh button SHALL expose no Ready text, success region, error region, result badge, or second result state

#### Scenario: Active request may enter a newly mounted Toaster once

- **GIVEN** reconnect began while the panel was closed and the same request remains pending
- **WHEN** the user opens the panel
- **THEN** the original Toaster MAY present that current request's loading-to-terminal flow once, SHALL NOT restart reconnect, and SHALL NOT replay any request that had already terminated

#### Scenario: Reconnect unavailable state is not a silent action

- **GIVEN** the current domain cannot start the reconnect composition
- **WHEN** the actions menu renders "Reconnect this site"
- **THEN** the action SHALL be visibly disabled, SHALL NOT dispatch activation, and SHALL NOT accept a click that silently produces neither feedback nor an operation

#### Scenario: Panel state changes only Toast availability

- **WHEN** the main plugin panel opens or closes during an active reconnect
- **THEN** the same operation and matching button spin SHALL continue without cancellation, replay, restart, duplication, or panel mutation; opening MAY mount the current request's Toast flow once, while closing MAY unmount it and SHALL settle feedback absence boundedly

#### Scenario: Reconnect cleanup is request-local

- **GIVEN** unrelated Toast feedback exists before or during reconnect
- **WHEN** reconnect succeeds, fails, or the main panel changes state
- **THEN** cleanup SHALL address only the matching reconnect request identity, SHALL NOT invoke an unscoped/global dismissal, SHALL preserve all unrelated Toast feedback, and SHALL NOT affect a newer request

#### Scenario: WorldRoom self-recovery

- **WHEN** the WorldRoom connection itself fails
- **THEN** the Runtime SHALL reconnect it automatically without requiring the domain reconnect action

### Requirement: One-shot migration without dual architecture

The change SHALL be delivered as one candidate that includes the hosts, exact eight-method ChatRoom port, state-free Runtime client, clean-cut internal comctx surface, uniquely owned Lifecycle/Connection/Session/World/History/Delivery/Wire Domain graph, private RoomTransport Extern/provider composition, message delivery, reconnect entry, current v2 peer protocol with only the authorized logical-presence exception, exact typed Database extern/default adapters, internal concrete MessageStore, canonical outer-type/outer-id `MessageRecord` with `ChatMessageRecord.message` and `SystemNoticeRecord.notice`, send-first persistence, and complete removal of page-owned WebRTC, the v1 protocol, stateful ChatRoom authority, catch-all Network ownership, and old WireExtern/provider route. Persistence and Runtime authority SHALL be complete clean-cut structural replacements rather than minimal repairs; no compatibility wrapper, alias, dual path, dead facade, hidden state channel, provider leak, or test-only accommodation may retain an obsolete owner/record/Store/outbox architecture. No intermediate release SHALL ship both architectures. Existing local message history SHALL NOT be imported, migrated, or retained by the canonical database.

#### Scenario: Single-candidate completeness

- **WHEN** the release candidate is inspected
- **THEN** it SHALL contain the full Remesh DDD + CQRS Runtime architecture and SHALL NOT contain any active page-owned WebRTC path, v1 protocol path, stateful ChatRoom recovery authority, catch-all Network owner, old WireExtern route, or dual writable fact

#### Scenario: No data migration

- **WHEN** the extension upgrades with old unstorage message data present
- **THEN** the old data SHALL be left unread and unconverted, and no migration code, marker, or reaction conversion SHALL exist

### Requirement: Verification and runtime acceptance boundary

For the current task #208 replacement, candidate delivery SHALL follow exactly Coder -> Reviewer -> Owner. Coder SHALL implement, freeze one immutable exact, and report identity and scope without running or claiming automated, static, build, or browser gates. Fresh Reviewer SHALL inspect only code logic, Diff/scope, and architecture boundaries and SHALL run no automated, static, build, or browser tests. Only a Reviewer logic PASS SHALL release that exact to the Owner's local test environment. No QA task, QA gate, or QA verdict SHALL be created or required for this replacement; the Owner's local smoke SHALL be the sole current product-acceptance path. Existing candidate-sensitive structural tests SHALL remain capable of proving the owner matrix, CQRS semantics, acyclic Domain dependencies, exact eight-method ChatRoom port, state-free ChatRoom implementation, provider import boundary, private RoomTransport Extern, old-owner/old-WireExtern removal, truthful `Remesh.module` usage/naming, and synchronized architecture artifacts. The same provider contract suite SHALL remain applicable to deterministic fake and Artico, and protected-input controls SHALL retain byte-identity coverage for current peer protocol source/schemas/limits/codec goldens and canonical bytes against baseline `9c90bb0...`. Removing the QA route SHALL NOT mark any acceptance control complete. Historical QA records SHALL remain immutable facts for their own exacts and SHALL transfer no evidence to the replacement. Merge SHALL remain separately authorized.

Contract tests for peer wire behavior SHALL import only from `@/protocol` or the documented public entry. Type-negative and unchanged-backend suites SHALL cover Database typing, transactions, cancellation, ordering, insertion, watch, close, and value isolation on IndexedDB and Memory. Application/page Domain/model tests SHALL cover exact outer-type MessageRecord decoding, all three item/record/payload id equalities, shared cross-variant id uniqueness, key/property-presence rejection, Chat user/message identity, internal MessageStore replay/conflict/query-default/query-type/query-abort/invalid-query/clear/watch, removal of its `list` API, send-first success/failure/loss behavior, exact causal returned-message projection under watch-order and same-content concurrency, projections, and LWW/order implementation. Headless Runtime tests SHALL cover each unique owner, provisional connection generations, committed sessions/HLC, World presence, history sessions/cursors/batches, delivery ACK/replay, Wire queues/trust/provider translation, and clean-cut internal RPC contracts.

A dependency/export/residue scan SHALL prove that `src/protocol/**` has no reverse imports or local/UI/internal Runtime exports; Chat/UI do not import Runtime/provider/Database primitives or concrete adapters; MessageStore is not an extern/public export; Artico imports are provider/composition-only; and no removed Network owner, WireExtern route, ChatRoom cache, false Module name, status/outbox/retry, or legacy record alias remains. No agent SHALL treat `pnpm dev` or ad hoc browsing as release evidence. After Reviewer logic PASS, the same immutable exact SHALL be synchronized directly to the Owner's local test environment without an intervening QA route. The Owner determines the current product verdict. Candidate controls SHALL retain one request identity across immediate leave/join invocation, Refresh disabled/spinning pending state, mounted Toast loading-to-ready/success-or-failure flow, terminal cleanup, duplicate rejection, and stale-request fencing. They SHALL cover panel-open activation with the original direct `AppMain -> Toaster`, panel-closed activation with no Toaster and no operation delay, opening while the same request remains active, closing while feedback is present, fast success, fast rejection, presentation absence/failure, and long operation. Structural controls SHALL prove the original Toaster parameters remain, no wrapper or launcher feedback layer exists, Refresh adds no custom Toast geometry/pointer styling, and no separate Ready/result button area exists. Removing the QA route SHALL NOT mark these controls complete or transfer historical results. If rendered behavior is claimed from Owner-local smoke, it SHALL use the exact candidate and real controls; isolated Toaster mounting, direct synthetic `.click()`, or source call order alone SHALL NOT substitute for the claimed result. Commit, push, and PR update need no separate Owner authorization; PR merge and `master` release SHALL remain separate explicit Owner authorizations.

#### Scenario: Reviewer logic PASS precedes Owner testing

- **WHEN** Coder freezes a replacement exact
- **THEN** fresh Reviewer SHALL inspect code logic, Diff/scope, and architecture boundaries without running tests, and the Owner SHALL begin local product smoke only after that logic review passes

#### Scenario: Task 208 replacement has no QA gate

- **WHEN** Reviewer logic PASS releases the immutable replacement exact
- **THEN** the exact SHALL go directly to the Owner's local test environment without creating or requiring a QA task, QA gate, QA-run browser matrix, or QA verdict

#### Scenario: Owner acceptance and release authorization

- **WHEN** the Reviewer-passed exact is ready for product acceptance and release judgment
- **THEN** the Owner SHALL record the local product verdict, historical QA evidence SHALL NOT transfer to the replacement, and PR merge and `master` release SHALL remain separate explicit Owner authorizations
