## ADDED Requirements

### Requirement: Protocol validation occurs at exactly three boundaries

The Runtime SHALL validate protocol data at exactly three boundaries. Peer receive SHALL parse a decoded payload once through the complete static Chat or World schema selected from trusted room context. Locally authored `ChatMessage` delivery SHALL parse the complete message once through `ChatMessageSchema` before both local persistence and peer codec encoding/send. Local persistence load SHALL parse each stored message once through a declarative local record schema that composes `ChatMessageSchema` with local-only structural fields. A peer-receive or local-load parse failure SHALL discard the value before it changes Runtime state, persistence projection, unread state, notifications, system notices, History progress, or page output and SHALL produce no Toast or other user-visible feedback. A local-`ChatMessage` parse failure SHALL persist nothing, encode or send nothing, preserve the sending draft, and show only `Invalid message.`; raw Schema issues SHALL NOT be user-visible.

Before the locally authored Text message exists, Footer SHALL own one separate local user capacity gate. It SHALL compute `getTextByteSize(JSON.stringify({ body, mentions }))` after draft transformation and before command dispatch. A value greater than `MAX_CHAT_EVENT_BYTES = 192KiB` SHALL show exactly `Message size cannot exceed 192KiB.`, preserve the draft, and dispatch no command, so allocation, Schema parsing, wire, and persistence SHALL not run. This gate SHALL NOT parse or inspect a typed protocol value and SHALL NOT count as a fourth protocol validation boundary.

The local record schema SHALL use no callback, custom schema, transform, contextual schema factory, or post-parse predicate. It SHALL validate only declaratively expressible structure. Relationships among a database key, nested message ID, nested user ID, or other local/protocol identities SHALL not be validated and SHALL have no handwritten fallback.

SESSION, History Pull/Push, World publication, `ChatMessage` allocation and production before its delivery boundary, persistence write and codec encoding after the boundary, clock adoption, Session/History consumers, and intermediate Runtime paths SHALL NOT parse or manually revalidate an already typed protocol value. Footer SHALL perform only the exact capacity gate above and no protocol parse or revalidation. Non-protocol authorization, ownership, lifecycle, resource scheduling, and codec representation decisions remain outside this rule, but SHALL NOT inspect message properties to recreate protocol validation.

#### Scenario: Invalid inbound peer value is discarded once

- **WHEN** the codec decodes a peer payload but the room-selected complete schema rejects it at Wire acceptance
- **THEN** no typed message event SHALL be emitted, no downstream Domain SHALL inspect or revalidate the rejected value, and no Toast or other user-visible feedback SHALL appear

#### Scenario: Corrupted local value is discarded on load

- **WHEN** a locally stored message was manually modified and the static local-record schema composed with the protocol schema declaratively rejects it during a read
- **THEN** that record SHALL be omitted from the loaded result and all projections, with no Toast or other user-visible feedback

#### Scenario: Unsupported local identity relationships are absent

- **WHEN** a stored row is structurally valid but a database key or local identity differs from a nested message or user identity
- **THEN** schema parsing SHALL NOT reject it through a callback, post-parse predicate, or other fallback relationship check

#### Scenario: Local user Text capacity gate rejects before protocol validation

- **WHEN** the user submits a transformed Text draft whose `getTextByteSize(JSON.stringify({ body, mentions }))` is greater than `192KiB`
- **THEN** Footer SHALL show exactly `Message size cannot exceed 192KiB.`, preserve the draft, and dispatch no command, Schema parse, wire send, or persistence write

#### Scenario: Locally authored ChatMessage uses ChatMessageSchema once

- **WHEN** local code submits a complete locally authored `ChatMessage` for local persistence and peer transport after any applicable user Text capacity gate has accepted
- **THEN** the Chat delivery owner SHALL parse it once through `ChatMessageSchema` before both persistence and peer codec encoding/send; on failure it SHALL show only `Invalid message.`, expose no raw issues to the user, preserve the draft, and reject without either side effect; allocation, producers, Footer, later persistence code, and codec code SHALL add no other parse or manual field/resource validation

#### Scenario: Accepted values are not revalidated

- **WHEN** Wire emits a typed schema-accepted peer message, the local `ChatMessage` delivery boundary accepts a message, or `MessageStore` returns a typed schema-accepted record
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
- **THEN** `leaveRoom()` SHALL invoke current-domain Runtime reconnect rather than local final release, the replacement physical Chat session SHALL reuse the same `presenceId`, World SHALL remain physically joined, and a remote PeerLeave followed by the same presence within five seconds SHALL produce neither a confirmed leave nor another join

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

### Requirement: Peer wire protocol is replaced with v5 without compatibility

The peer-to-peer wire protocol SHALL use the v5 contract defined by the `peer-wire-protocol` capability. The system SHALL NOT bridge, translate, or interoperate with v1, v2, v3, or v4 protocols. All five generations SHALL be isolated by both Chat and World room namespaces so no generation parses another's traffic or advertises an incompatible peer.

#### Scenario: v1 through v5 isolation

- **WHEN** clients from v1, v2, v3, v4, and v5 operate in a shared physical environment
- **THEN** only matching v5 clients SHALL share the current Chat or World room namespaces, and no compatibility fallback SHALL exist

#### Scenario: Old protocol removal remains complete

- **WHEN** the release candidate is inspected
- **THEN** old protocol schemas, the JSONR interop adapter, page-side message routing, reaction toggle, history upsert, HLC-only history cursor, and v1-v4 active namespace inputs SHALL be absent

## MODIFIED Requirements

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

A static strict local-record schema SHALL choose the closed variant only through outer `record.type`; it SHALL NOT infer record type from `DatabaseItem.key`, an id/key prefix or shape, or the presence of `message`/`notice`. It SHALL validate only the declarative structure of the record value. A database key differing from `record.id`, a Chat `record.id` differing from `record.message.id`, a Chat `record.user.id` differing from `record.message.userId`, or a notice `record.id` differing from `record.notice.id` SHALL NOT cause schema rejection through a callback, post-parse predicate, or handwritten fallback. Chat and notice ids SHALL occupy one globally unique record-id space so atomic first-value-wins cannot collide across variants. `Notice.type` remains the independent `join | leave | info` reason; outer `record.type` remains only the `chat-message | system-notice` storage/Domain category. SystemNotice identity SHALL be deterministic and it SHALL never enter peer wire or History. `receivedAt` is finite local first-acceptance/creation time, not an HLC, peer timestamp, or delivery state. Record ordering helpers SHALL use `(record.message.hlc, record.id)` for Chat and `(record.notice.hlc, record.id)` for SystemNotice; reaction LWW SHALL continue to use `(message.hlc, message.id)`, and UI reaction aggregation remains projection-only. There SHALL be no standalone `SYSTEM_NOTICE`, old outer notice `hlc`/`body`/`noticeType`, `LocalRecord`, `DurableEventRecord`, outer `event` alias, property-presence guard, key-based discriminator, `RecordStatus`, pending/sent/received state, mark method, outbox metadata, compatibility alias, or dual-read path.

The only host-replaceable persistence extern SHALL be `Database<Schema>`. IndexedDB and Memory SHALL implement it for one private `MessageDatabaseSchema` and private logical database name/version/store/index configuration. A future backend is compatible only after running the same public contract suite. The single internal concrete MessageStore SHALL be Database-backed and expose only `insert(record): Promise<InsertMessageResult>`, `query(query?: MessageQuery)`, `clear`, and `watch`; it SHALL NOT expose `list` or a compatibility alias and SHALL NOT be a Remesh extern, public-barrel export, host injection point, or independently replaceable backend. Its internal helpers SHALL strictly decode each MessageRecord value with the static local-record schema, derive message/notice keys and HLCs, distinguish same-id canonical replay from different-content conflict, and keep the first value without overwrite. They SHALL NOT validate relationships between the physical database key and nested record/message/user identities. `InsertMessageResult` SHALL be the readonly inserted/existing Domain union and SHALL NOT reuse Database's result type.

The canonical per-origin IndexedDB identity SHALL remain stable, including its existing v2 database name. Private `MESSAGE_STORE_VERSION = 2` colocated with the native upgrade callback SHALL name the existing schema authority. This abstraction and record cleanup SHALL NOT itself advance the version or add an upgrade. The version SHALL advance only with an implemented compatible store/index/key/value migration; ordered IndexedDB upgrade transactions SHALL preserve canonical records and bounded conflict diagnostics. App/wire versions and ordinary fixes SHALL NOT clear, rename, or delete the database. Old unstorage data remains unread, unconverted, and uncleared.

The headless Runtime SHALL own only network/History orchestration around the application-owned store: `HistoryDomain` owns requester/provider State, candidate-window and page scheduling, supplier selection/failover, page cancellation, and physical settlement; `WireDomain` owns protocol scheduling/queues; the page-host boundary owns internal RPC. Shared models consumed by both pages and Runtime SHALL remain defined by an application Domain/model module rather than by any Runtime owner or the public protocol.

#### Scenario: Application persistence boundary

- **WHEN** a page persists, projects, or synchronizes local records
- **THEN** the Database-backed application persistence boundary SHALL own that work, the headless Runtime Domains SHALL own no History read model, and Chat/UI SHALL receive only schema-decoded Domain records/projections rather than storage primitives

#### Scenario: Unsupported local record identities remain accepted

- **WHEN** a structurally valid stored row has a database key, record id, nested message or notice id, or nested user id that differs from another identity in that row
- **THEN** the static local-record schema SHALL NOT reject it through a callback, post-parse predicate, or handwritten fallback, and later non-validation ownership/conflict behavior SHALL remain outside the schema boundary

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

MessageStore SHALL have one Database-backed implementation and no Remesh extern, public-barrel export, host injection, Memory-specific implementation, or fake replacement. It SHALL map Database's insert result into its own Domain result; parse each physical record value independently with the static declarative local-record schema; retain every invalid raw row without publication; record bounded, per-key deduplicated diagnostics in the existing private conflicts store without notifying canonical-record watchers; perform no equality validation between `DatabaseItem.key`, `record.id`, nested message/notice ids, or nested user ids; preserve the first canonical value; retain bounded conflict diagnostics for same-id different-content input; and classify same-content replay without overwrite. Key/id prefixes, property presence, the removed standalone `SYSTEM_NOTICE`, and compatibility aliases SHALL NOT participate in decode or dispatch. `query()` SHALL return every schema-valid record in physical primary-scan order even when other physical rows are invalid. `query({type})` SHALL return only schema-valid records whose exact outer discriminator equals that type, after independently attempting to parse every physically read value before applying the type filter. `query({signal})` SHALL gate the physical read transaction and all subsequent parse/filter work. The optional query object SHALL contain only `type` and `signal`; an unknown field or a type outside the exact outer discriminator union SHALL reject deterministically. It SHALL expose no id, range, order, limit, cursor, or syncId criterion. The type filter SHALL add no physical index, schema migration, or version bump; private `MESSAGE_STORE_VERSION = 2` remains the schema authority. `clear` SHALL run only for an explicit user/application clear command and SHALL atomically clear canonical records plus conflicts; startup, app-version checks, and compatibility code SHALL NOT call it. `watch` SHALL observe canonical-record invalidation; a conflict-only diagnostic write need not invalidate visible query results. Neither Database nor MessageStore SHALL own History wire DTOs, `syncId`, cursor, cutoff, limit, response `messages`, or `done`; History cutoff/pagination/projection remains in its Runtime/application owner. No `list` alias or test-only conflict-count API is exposed.

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
- **THEN** MessageStore SHALL accept only values matching the exact static outer-type MessageRecord union; perform no equality validation among the database key, outer record id, nested message/notice id, or nested user id; reject key/property-presence discrimination and every old shape; keep SystemNotice local-only; expose only its four methods; and never expose Database primitives or History protocol values

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

The headless Runtime SHALL bind each Chat source to a session identity and logical generation. A join SHALL send strict `session {sessionId, user, presenceId, joinedAt}` before live text, reaction, or history traffic. `joinedAt` SHALL be allocated and persisted by Session with a new local logical generation, projected unchanged to wire, and remain unchanged with its `presenceId` across physical session replacement. It SHALL NOT be synthesized from receiver observation, discovery order, `baselinePeerIds`, or `clock.now()`. A bound `sessionId` SHALL not change its `user.id`; an accepted `presenceId` SHALL not change its bound `user.id` or `joinedAt`; live event `userId` SHALL match the transport-bound session user. `name` and `avatar` SHALL remain mutable projection fields: a SESSION for the same accepted identity binding SHALL update that current projection across attached pages without changing logical membership or notices. A new physical incarnation SHALL retire the old source binding and old history sync, and SHALL trigger exactly one fresh history request for the replacement without running it concurrently with unsettled old source work. Reconnect of the same logical generation SHALL not become a new observer join.

#### Scenario: Session binding and replacement

- **WHEN** a source joins Chat, republishes a bound logical generation, sends changed `user.id` or logical time for an accepted generation, or reconnects with a new physical incarnation
- **THEN** the Runtime SHALL require the session message first, reject a `user.id` change for the same `sessionId`, reject a `user.id` or `joinedAt` change for the same accepted `presenceId`, reject live events whose `userId` does not match the bound user, retire the old source binding/sync for a new incarnation, and issue exactly one fresh history request for the replacement

#### Scenario: Same logical presence refreshes its user projection

- **GIVEN** a source and `presenceId` retain the same `user.id` and `joinedAt`
- **WHEN** a later accepted SESSION changes `name` or `avatar`, or repeats the current values
- **THEN** every attached same-domain page SHALL converge to the current projection idempotently without changing membership count, allocating a generation, emitting a chat/history event, or emitting a join/leave notice

#### Scenario: Future HLC does not advance Runtime clock

- **WHEN** the static protocol schema parses a finite safe non-negative HLC without receiver clock input, including a value more than five minutes ahead of the receiver clock
- **THEN** schema validation itself SHALL neither advance the Runtime clock nor reject through a receiver-time predicate, and subsequent Domain clock adoption SHALL consume the accepted value through the same path as every other schema-accepted HLC

### Requirement: Runtime WirePipeline and internal RPC contracts stay inside Runtime boundaries

`WireDomain` SHALL own per-room send serialization, per-source decode queues bounded to at most 8 frames and 256KiB of wire data, and source-local drop/apply/flush behavior. `HistoryDomain` SHALL own history concurrency admission and resource scheduling. The page-host boundary SHALL own the internal comctx RPC contracts/namespace. Malformed frames and queue overflow SHALL be dropped only for the affected source, logged with rate limiting, and SHALL NOT reconnect the room. Those contracts SHALL not be exported from `src/protocol/index.ts`; queue/drop types SHALL live with `WireDomain`, history admission types with `HistoryDomain`, and RPC types with the page-host boundary rather than the codec or public protocol module. `compareHLC` and `compareEventPosition` implementations SHALL live in the application/page Domain/model layer, or in a shared Domain/model module when both pages and Runtime consume them, while the public protocol defines only the canonical `(hlc, id)` ordering rule. The static protocol HLC Schema SHALL receive no clock input; application or shared Domain/model clock adoption SHALL consume only schema-accepted HLC values without revalidation.

#### Scenario: Internal Runtime ownership

- **WHEN** queue/drop/pipeline scheduling, ordering implementation, or page-host RPC contracts are inspected
- **THEN** queue/drop/pipeline scheduling and page-host RPC contracts SHALL be defined under headless Runtime owners, while ordering implementations SHALL be defined under application/page Domain/model owners or a shared Domain/model module; none SHALL be exported from `@/protocol` or imported by protocol code

#### Scenario: Source-local decode overflow

- **WHEN** one source exceeds 8 queued frames or 256KiB of queued wire data, or sends a malformed frame
- **THEN** the Runtime SHALL drop only that source-local frame/work, rate-limit the diagnostic, preserve other sources, and SHALL NOT reconnect the room

#### Scenario: Final send settlement releases source slot

- **WHEN** a provider's final history response send settles and an old timeout/token later fires
- **THEN** the Runtime SHALL release the source slot immediately after send settlement, and the old timer/token SHALL fail its identity check without delaying or closing a newer domain/request

### Requirement: One-shot migration without dual architecture

The change SHALL be delivered as one candidate that includes the hosts, exact eight-method ChatRoom port, state-free Runtime client, clean-cut internal comctx surface, uniquely owned Lifecycle/Connection/Session/World/History/Delivery/Wire Domain graph, private RoomTransport Extern/provider composition, message delivery, reconnect entry, current v5 peer protocol, exact typed Database extern/default adapters, internal concrete MessageStore, canonical outer-type/outer-id `MessageRecord` with `ChatMessageRecord.message` and `SystemNoticeRecord.notice`, send-first persistence, and complete removal of page-owned WebRTC, v1-v4 active protocol paths, stateful ChatRoom authority, catch-all Network ownership, and old WireExtern/provider route. Persistence and Runtime authority SHALL be complete clean-cut structural replacements rather than minimal repairs; no compatibility wrapper, alias, dual path, dead facade, hidden state channel, provider leak, or test-only accommodation may retain an obsolete owner/record/Store/outbox architecture. No intermediate release SHALL ship multiple architectures or protocol generations. Existing local message history SHALL NOT be imported, migrated, or retained by the canonical database.

#### Scenario: Single-candidate completeness

- **WHEN** the release candidate is inspected
- **THEN** it SHALL contain the full Remesh DDD + CQRS Runtime architecture and current v5 protocol, and SHALL NOT contain any active page-owned WebRTC path, v1-v4 protocol room path, stateful ChatRoom recovery authority, catch-all Network owner, old WireExtern route, or dual writable fact

#### Scenario: No data migration

- **WHEN** the extension upgrades with old unstorage message data present
- **THEN** the old data SHALL be left unread and unconverted, and no migration code, marker, or reaction conversion SHALL exist

### Requirement: Verification coverage protects runtime boundaries

Contract tests for peer wire behavior SHALL import only from `@/protocol` or the documented public entry. Type-negative and unchanged-backend suites SHALL cover Database typing, transactions, cancellation, ordering, insertion, watch, close, and value isolation on IndexedDB and Memory. Application and page Domain tests SHALL cover strict declarative `MessageRecord` structure, schema/load acceptance when a physical database key, outer record id, nested message or notice id, or nested user id differs from another identity in the row, cross-variant first-value-wins conflict behavior outside validation, MessageStore replay/conflict/query/abort/clear/watch behavior, send-first success/failure/loss behavior, causal local projection, and ordering. Headless Runtime tests SHALL cover each unique owner, provisional connection generations, sessions, World presence, history, delivery replay, Wire queues, trusted provider translation, and internal RPC contracts.

Dependency, export, and residue checks SHALL prove that public protocol code has no reverse application or Runtime dependencies; Chat and UI do not import concrete Runtime, provider, Database, or adapter primitives; MessageStore remains internal; provider imports remain composition-only; and removed owners, aliases, fallback paths, status/outbox/retry state, cross-identity schema/load rejection, and old Wire routes do not return. Reconnect controls SHALL continue covering immediate request-owned dispatch, pending button state, mounted and absent Toast behavior, stale fencing, request-local cleanup, original Toaster parameters, and the absence of a second readiness/result surface.

#### Scenario: Product boundaries remain testable

- **WHEN** the runtime, persistence, protocol, or reconnect implementation changes
- **THEN** the affected contract suites and structural checks SHALL detect owner leakage, public-boundary widening, obsolete architecture residue, hidden cross-identity validation, or feedback-state duplication

#### Scenario: Runtime verification uses production boundaries

- **WHEN** browser Runtime behavior is accepted for release
- **THEN** verification SHALL use the built extension and real controls rather than treating `pnpm dev`, isolated Toaster mounting, synthetic clicks, or source call order alone as product evidence

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

### Requirement: Peer wire protocol is replaced with v3 without compatibility

**Reason**: The current peer protocol is v5. Retaining v3 as a current Runtime requirement contradicts the peer-wire protocol and active source authority.

**Migration**: `Peer wire protocol is replaced with v5 without compatibility` is the sole current protocol requirement. v1 through v4 remain isolated and no compatibility path exists.

### Requirement: Unified five-second lifecycle grace

**Reason**: The former requirement coupled local page-domain grace to a peer end transaction. Current local release and remote PeerLeave grace are independent owners and no peer end transaction exists.

**Migration**: `Local domain release uses one five-second lifecycle grace` retains current page-domain behavior and local cleanup. `Session classifies logical presence across physical lifecycles` owns the separate five-second remote online grace after Artico PeerLeave.
