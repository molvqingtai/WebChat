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

- **WHEN** QA directly closes the Firefox persistent Background Page through `backgroundView.close()`
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

When the last page of a domain disconnects, `LifecycleDomain` SHALL uniquely own one unified five-second grace phase/deadline. During it, Connection SHALL retain that domain's ChatRoom connection, Session/History SHALL retain domain State, Delivery SHALL retain the volatile inbound un-ACK buffer, and World SHALL retain domain presence. On grace expiry, the Lifecycle domain-released Event SHALL cause those owners to release their own State together. A page that reconnects within the grace period SHALL cancel grace through Lifecycle and read the current Runtime snapshot without a false offline/online transition. No persistent outbound outbox or delivery-status retry survives grace expiry; only the separately specified volatile inbound un-ACK buffer participates in this lifecycle.

#### Scenario: Refresh within grace

- **WHEN** a user refreshes the only page of a domain and the new page attaches within 5 seconds
- **THEN** the domain connection and state SHALL continue without re-join flapping, presence flicker, or message loss caused by the refresh

#### Scenario: Readiness helper distinguishes mounted UI from convergence

- **WHEN** automated acceptance observes an already-mounted usable chat textarea after a refresh or restart
- **THEN** the helper SHALL accept that UI readiness immediately; a separate bounded eventual membership/presence wait MAY guard against a hang, and the five-second domain grace SHALL NOT be treated as a UI-convergence deadline

#### Scenario: Grace expiry

- **WHEN** no page of the domain reconnects within 5 seconds
- **THEN** the ChatRoom connection, Runtime domain state, volatile inbound un-ACK delivery buffer, and WorldRoom presence for that domain SHALL all be released or removed together, with no persistent outbound status or same-id crash retry retained

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

MessageStore SHALL have one Database-backed implementation and no Remesh extern, public-barrel export, host injection, Memory-specific implementation, or fake replacement. It SHALL map Database's insert result into its own Domain result; strictly decode every item by outer `record.type`; enforce `DatabaseItem.key === record.id`, Chat `record.id === record.message.id`, notice `record.id === record.notice.id`, and Chat user/message identity; preserve the first canonical value; retain bounded conflict diagnostics for same-id different-content input; and classify same-content replay without overwrite. Key/id prefixes, property presence, the removed standalone `SYSTEM_NOTICE`, and compatibility aliases SHALL NOT participate in decode or dispatch. `query()` SHALL return every canonical record in physical primary-scan order. `query({type})` SHALL return only records whose exact outer discriminator equals that type, but the implementation SHALL still strictly decode every physically read item before applying the type filter. `query({signal})` SHALL gate the physical read transaction and all subsequent decode/filter work. The optional query object SHALL contain only `type` and `signal`; an unknown field or a type outside the exact outer discriminator union SHALL reject deterministically. It SHALL expose no id, range, order, limit, cursor, or syncId criterion. The type filter SHALL add no physical index, schema migration, or version bump; private `MESSAGE_STORE_VERSION = 2` remains the schema authority. `clear` SHALL run only for an explicit user/application clear command and SHALL atomically clear canonical records plus conflicts; startup, app-version checks, and compatibility code SHALL NOT call it. `watch` SHALL observe canonical-record invalidation; a conflict-only diagnostic write need not invalidate visible query results. Neither Database nor MessageStore SHALL own history wire DTOs, `syncId`, cursor, cutoff, limit, response `messages`, or `done`; history cutoff/pagination/projection remains in its Runtime/application owner. No `list` alias or test-only conflict-count API is exposed.

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
- **THEN** the facade SHALL respectively return all strictly decoded canonical records, return only that type after decoding the complete scan, honor cancellation through read/decode/filter settlement, or reject deterministically; it SHALL preserve primary-scan order, expose no `list` alias or history criteria, and introduce no physical index, migration, or version change

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

`WireDomain` SHALL terminate every protocol DTO at one typed accepted-message Event and SHALL NOT expose raw provider callbacks, decoded unknown values, or a shared mutable wire model. `SessionMessage` SHALL enter Session binding/commit Commands. `TextMessage` and `ReactionMessage` SHALL enter Session source/user validation and then Delivery admission. `HistoryRequestMessage` and `HistoryResponseMessage` SHALL enter History Commands; History SHALL verify the current trusted source/session binding through a Session Query before its requester/provider transition, with accepted response batches entering Delivery atomically. `WorldRoomMessage` SHALL enter World source-snapshot replacement. Provider peer-ready/leave and room-close/error facts SHALL enter Connection transitions, which SHALL request Session/World/History cleanup through their Commands rather than mutate them.

Outbound `SessionMessage` SHALL originate from Session after an accepted Connection generation. Outbound Text/Reaction SHALL use Session-owned id/HLC allocation and a Wire send Command. History request/response SHALL originate from History State and page-supply outcomes. `WorldRoomMessage` SHALL originate from World's current full snapshot only after Connection acceptance. All outbound values SHALL use the unchanged existing peer schemas and codec bytes.

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

### Requirement: Domain-scoped manual reconnect

The actions menu SHALL include "Reconnect this site", which SHALL rebuild only the current domain's ChatRoom connection and re-publish that domain's presence. Because the frozen `ChatRoom` has no `reconnect` method, the application Domain command SHALL use the exact public `leaveRoom()` and retained `JoinRoomCommand` with `joinRoom(command)` rather than extending the extern. It SHALL NOT rebuild the shared WorldRoom; the Runtime SHALL auto-reconnect the WorldRoom only on its own connection failure. The Options page SHALL NOT gain a global reconnect entry.

#### Scenario: Manual domain reconnect

- **WHEN** a user activates "Reconnect this site" on one domain
- **THEN** only that domain's ChatRoom connection and presence SHALL be rebuilt, and other domains and the WorldRoom SHALL be undisturbed

#### Scenario: WorldRoom self-recovery

- **WHEN** the WorldRoom connection itself fails
- **THEN** the Runtime SHALL reconnect it automatically without requiring the domain reconnect action

### Requirement: One-shot migration without dual architecture

The change SHALL be delivered as one candidate that includes the hosts, exact eight-method ChatRoom port, state-free Runtime client, clean-cut internal comctx surface, uniquely owned Lifecycle/Connection/Session/World/History/Delivery/Wire Domain graph, private RoomTransport Extern/provider composition, message delivery, reconnect entry, immutable current v2 peer protocol, exact typed Database extern/default adapters, internal concrete MessageStore, canonical outer-type/outer-id `MessageRecord` with `ChatMessageRecord.message` and `SystemNoticeRecord.notice`, send-first persistence, and complete removal of page-owned WebRTC, the v1 protocol, stateful ChatRoom authority, catch-all Network ownership, and old WireExtern/provider route. Persistence and Runtime authority SHALL be complete clean-cut structural replacements rather than minimal repairs; no compatibility wrapper, alias, dual path, dead facade, hidden state channel, provider leak, or test-only accommodation may retain an obsolete owner/record/Store/outbox architecture. No intermediate release SHALL ship both architectures. Existing local message history SHALL NOT be imported, migrated, or retained by the canonical database.

#### Scenario: Single-candidate completeness

- **WHEN** the release candidate is inspected
- **THEN** it SHALL contain the full Remesh DDD + CQRS Runtime architecture and SHALL NOT contain any active page-owned WebRTC path, v1 protocol path, stateful ChatRoom recovery authority, catch-all Network owner, old WireExtern route, or dual writable fact

#### Scenario: No data migration

- **WHEN** the extension upgrades with old unstorage message data present
- **THEN** the old data SHALL be left unread and unconverted, and no migration code, marker, or reaction conversion SHALL exist

### Requirement: Verification and runtime acceptance boundary

Implementation and review deliveries for this change SHALL pass the static delivery gates — `lint`, `check`, Chrome and Firefox `build`, and OpenSpec strict validation — and those gates SHALL NOT substitute for QA runtime acceptance. Candidate-sensitive structural tests SHALL prove the owner matrix, CQRS semantics, acyclic Domain dependencies, exact eight-method ChatRoom port, state-free ChatRoom implementation, provider import boundary, private RoomTransport Extern, old-owner/old-WireExtern removal, truthful `Remesh.module` usage/naming, and synchronized architecture artifacts. The same provider contract suite SHALL run against deterministic fake and Artico. Protected-input checks SHALL prove the current peer protocol source/schemas/limits/codec goldens and canonical encoded bytes are byte-identical to baseline `9c90bb0...`.

Contract tests for peer wire behavior SHALL import only from `@/protocol` or the documented public entry. Type-negative and unchanged-backend suites SHALL cover Database typing, transactions, cancellation, ordering, insertion, watch, close, and value isolation on IndexedDB and Memory. Application/page Domain/model tests SHALL cover exact outer-type MessageRecord decoding, all three item/record/payload id equalities, shared cross-variant id uniqueness, key/property-presence rejection, Chat user/message identity, internal MessageStore replay/conflict/query-default/query-type/query-abort/invalid-query/clear/watch, removal of its `list` API, send-first success/failure/loss behavior, exact causal returned-message projection under watch-order and same-content concurrency, projections, and LWW/order implementation. Headless Runtime tests SHALL cover each unique owner, provisional connection generations, committed sessions/HLC, World presence, history sessions/cursors/batches, delivery ACK/replay, Wire queues/trust/provider translation, and clean-cut internal RPC contracts.

A dependency/export/residue scan SHALL prove that `src/protocol/**` has no reverse imports or local/UI/internal Runtime exports; Chat/UI do not import Runtime/provider/Database primitives or concrete adapters; MessageStore is not an extern/public export; Artico imports are provider/composition-only; and no removed Network owner, WireExtern route, ChatRoom cache, false Module name, status/outbox/retry, or legacy record alias remains. No agent SHALL start, restart, or manage `pnpm dev`, and no agent SHALL perform manual browser runtime acceptance. Browser runtime verification SHALL follow an independent Reviewer FINAL PASS and be delegated to the automated real-extension acceptance gates — Chrome MV3 via Playwright bundled Chromium and Firefox MV2 via Selenium/geckodriver — executed by QA with preserved evidence and cleanup checks. The Owner SHALL perform only one minimal branded Chrome/Edge smoke at release-candidate stage. Commit, push, and PR update need no separate Owner authorization; PR merge and `master` release SHALL remain separate explicit Owner authorizations.

#### Scenario: Static delivery gates

- **WHEN** an implementation or review delivery for this change is completed
- **THEN** its evidence SHALL include the passing static, type, build, and OpenSpec gates, and that evidence SHALL NOT substitute for the QA-executed runtime acceptance gates

#### Scenario: Runtime acceptance and release authorization

- **WHEN** the exact candidate is ready for runtime acceptance and release judgment
- **THEN** QA SHALL execute the automated real-extension acceptance gates on the production builds — Chrome MV3 via Playwright bundled Chromium and Firefox MV2 via Selenium/geckodriver — with preserved evidence and cleanup checks; the Owner SHALL perform only one minimal branded Chrome/Edge install-and-start smoke at release-candidate stage, and PR merge and `master` release SHALL remain separate explicit Owner authorizations
