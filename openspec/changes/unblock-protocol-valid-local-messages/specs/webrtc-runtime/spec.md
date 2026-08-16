## MODIFIED Requirements

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

No alias, compatibility field, overload, extra method, generic metadata bag, Runtime type, or peer/source/joinedAt/timer/IDB/host/page/lease/retry field SHALL extend this contract without explicit Owner intervention. `joinRoom` SHALL use the caller-supplied user/site and `impls` SHALL create `sessionId`. `leaveRoom` SHALL operate on the currently joined room instance. `sendMessage` SHALL accept only the frozen business commands, and `impls` SHALL create `id`, `hlc`, and `userId`.

For `SendTextCommand`, the complete allocated message SHALL pass the existing single full `ChatMessageSchema` boundary before any local projection, transport, or persistence side effect. A successful parse SHALL resolve the call with the exact allocated `TextMessage` for immediate current-page projection without awaiting transport or `MessageStore.insert`. Transport and insertion SHALL then be attempted as independent owned work; neither result SHALL gate, undo, delay, or re-reject that local acceptance, and failure of one SHALL NOT prevent the other attempt. Their genuine failures SHALL remain observable through the existing scoped error route. A schema failure SHALL preserve the draft, return no message, expose only `Invalid message.`, and perform neither side effect. A later text-send failure SHALL NOT restore the already cleared accepted draft or hold a later protocol-valid text behind its settlement. Display eligibility SHALL depend only on full protocol acceptance and SHALL NOT inspect or branch on any later error's message, name, type, code, constructor, subsystem, or operation.

For `SendReactionCommand`, `impls` SHALL retain the existing transport-acceptance and local-insert settlement before returning the exact allocated-and-transported `ReactionMessage`. Neither path SHALL return or expose an insert result, same-id existing winner, `MessageRecord`, delivery status, or Runtime provenance.

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

- **WHEN** `sendMessage` accepts `SendReactionCommand`
- **THEN** the caller SHALL provide none of `id`, `hlc`, `userId`, or `sessionId`; `impls` SHALL allocate them, complete transport acceptance, then call `MessageStore.insert`, and only after that operation successfully settles resolve with the exact allocated-and-transported `ReactionMessage`, even when same-id handling retains an existing canonical winner; it SHALL return neither that winner nor a status/result DTO and SHALL add no hidden callback or retry

#### Scenario: Protocol-valid text accepts before fallible side effects

- **WHEN** `sendMessage` allocates a `SendTextCommand` and the complete `TextMessage` passes the single full protocol-schema boundary
- **THEN** it SHALL return that exact allocated message for immediate current-page projection without waiting for transport or local insertion; both side effects SHALL be attempted independently afterward, and neither settlement SHALL alter or reject the accepted local result

#### Scenario: Every post-validation error is display-irrelevant

- **GIVEN** a local text passed the complete protocol boundary
- **WHEN** any later Runtime, RTC, peer, transport, persistence, History, or other operation fails with any Error identity or content
- **THEN** the accepted local projection SHALL remain allowed without matching the Error's message, name, type, code, constructor, subsystem, or operation

#### Scenario: Causal local send projection

- **WHEN** local text sends race store-watch refresh, another tab sends the same body/mentions, a same-id collision retains another canonical winner, or accepted-message transport or persistence remains pending or fails
- **THEN** the application SHALL derive the local projection from the exact `TextMessage` returned at protocol acceptance, clear that accepted draft, and never use visible-record diff, body/mention matching, `onMessage`, or a hidden side channel; later failure SHALL preserve the projection and cleared draft while following its existing error route

#### Scenario: Later text does not wait for prior side effects

- **GIVEN** one protocol-valid local text has unresolved or failed transport or persistence work
- **WHEN** a later local text passes the same complete protocol boundary
- **THEN** the later text SHALL project and clear its own draft without waiting for the earlier work, and recovery SHALL NOT flush an accumulated local-display queue

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

- **WHEN** text preparation fails before a complete protocol-valid message exists, the complete schema rejects, or post-acceptance transport or insertion later fails or never settles because the browser exits
- **THEN** preparation/schema failure SHALL preserve the draft, return no `TextMessage`, and produce no projection or side effect; post-acceptance failure SHALL preserve the current-page projection and cleared draft, retain its existing error owner, and add no status, outbox, same-id crash retry, or hidden fallback

#### Scenario: No Runtime history copy

- **WHEN** Runtime and persistence ownership are inspected
- **THEN** the headless Runtime Domains SHALL keep no history replica, Database SHALL remain the only replaceable persistence extern, and the one internal MessageStore SHALL own no peer-history protocol orchestration

### Requirement: ChatRoom Runtime implementation is a state-free application adapter

The public `ChatRoomExtern` SHALL remain exactly the eight frozen methods. `src/domain/impls/runtime/ChatRoom.ts` SHALL be only a Runtime client proxy, Event bridge, persistence-before-ACK boundary, and history-supply boundary. It SHALL contain no retained join command, session map, local-session or published-session State, Runtime generation, join/recovery queue, snapshot cache used for replay, or writable network fact. It MAY retain only infrastructure needed to settle one in-flight call or dispose one active subscription; those handles SHALL be bounded to that operation/subscription and SHALL NOT be read as State or used for recovery.

Inbound remote live messages SHALL still settle canonical MessageStore insertion before Runtime ACK. History supply SHALL still query the application-owned store through the private page-host contract. Outbound text `sendMessage` SHALL retain Runtime allocation and the single full protocol boundary, then return the exact causal `TextMessage` for current-page projection while independently observed transport and local insertion continue without gating later local sends. Outbound reactions SHALL retain `allocate -> transport acceptance -> local insert settlement -> exact causal ReactionMessage result`. `onMessage` SHALL remain remote-live-only. Internal page-to-Runtime comctx Commands/Events MAY change in one clean cut to express the Domain graph, but the public eight methods, inbound persistence/ACK order, provider delegation, and reliability option B SHALL NOT change.

#### Scenario: Adapter has no hidden recovery State

- **WHEN** the Runtime ChatRoom implementation is inspected after construction and across host recovery
- **THEN** it SHALL have no command/session/local-session/published-session/generation/recovery map or snapshot authority, and host recovery SHALL converge from current application intent plus Runtime Domain State

#### Scenario: Adapter preserves persistence and ACK order

- **WHEN** a first remote live ChatMessage crosses the adapter
- **THEN** canonical insertion or confirmed canonical existence SHALL settle before ACK, while history and local sends SHALL remain excluded from `onMessage`

#### Scenario: Adapter isolates accepted text from later settlement

- **WHEN** a protocol-valid local text has pending, failed, or never-settling transport or insertion work
- **THEN** the adapter SHALL preserve the accepted causal result and explicitly observe later failures without retaining recovery State, blocking a later accepted text, or producing an unhandled rejection

#### Scenario: Internal control contract changes cleanly

- **WHEN** the page-host comctx contract is replaced to express CQRS Commands and Events
- **THEN** no old request/event alias, fallback, dual listener, or dual read/write route SHALL remain, and the eight-method application port plus product behavior SHALL be unchanged

### Requirement: One-shot migration without dual architecture

The change SHALL be delivered as one candidate that includes the hosts, exact eight-method ChatRoom port, state-free Runtime client, clean-cut internal comctx surface, uniquely owned Lifecycle/Connection/Session/World/History/Delivery/Wire Domain graph, private RoomTransport Extern/provider composition, message delivery, reconnect entry, current v3 peer protocol, exact typed Database extern/default adapters, internal concrete MessageStore, canonical outer-type/outer-id `MessageRecord` with `ChatMessageRecord.message` and `SystemNoticeRecord.notice`, protocol-accepted local text projection with independently owned transport and persistence work, and complete removal of page-owned WebRTC, v1/v2 active protocol paths, stateful ChatRoom authority, catch-all Network ownership, and old WireExtern route. Persistence and Runtime authority SHALL be complete clean-cut structural replacements rather than minimal repairs; no compatibility wrapper, alias, dual path, dead facade, hidden state channel, provider leak, or test-only accommodation may retain an obsolete owner/record/Store/outbox architecture. No intermediate release SHALL ship multiple architectures or protocol generations. Existing local message history SHALL NOT be imported, migrated, or retained by the canonical database.

#### Scenario: Single-candidate completeness

- **WHEN** the release candidate is inspected
- **THEN** it SHALL contain the full Remesh DDD + CQRS Runtime architecture and current v3 protocol, and SHALL NOT contain any active page-owned WebRTC path, v1/v2 protocol room path, stateful ChatRoom recovery authority, catch-all Network owner, old WireExtern route, or dual writable fact

#### Scenario: No data migration

- **WHEN** the extension upgrades with old unstorage message data present
- **THEN** the old data SHALL be left unread and unconverted, and no migration code, marker, or reaction conversion SHALL exist

### Requirement: Verification coverage protects runtime boundaries

Contract tests for peer wire behavior SHALL import only from `@/protocol` or the documented public entry. Type-negative and unchanged-backend suites SHALL cover Database typing, transactions, cancellation, ordering, insertion, watch, close, and value isolation on IndexedDB and Memory. Application and page Domain tests SHALL cover strict `MessageRecord` decoding, item/record/payload identity, cross-variant uniqueness, Chat identity, MessageStore replay/conflict/query/abort/clear/watch behavior, protocol-invalid local text with zero side effects, protocol-accepted text projection before pending/rejected transport and persistence, independent post-acceptance attempts, later-send non-blocking behavior, unchanged reaction settlement, causal local projection, and ordering. Headless Runtime tests SHALL cover each unique owner, provisional connection generations, sessions, World presence, history, delivery replay, Wire queues, trusted provider translation, and internal RPC contracts.

Dependency, export, and residue checks SHALL prove that public protocol code has no reverse application or Runtime dependencies; Chat and UI do not import concrete Runtime, provider, Database, or adapter primitives; MessageStore remains internal; provider imports remain composition-only; and removed owners, aliases, fallback paths, status/outbox/retry state, and old Wire routes do not return. Reconnect controls SHALL continue covering immediate request-owned dispatch, pending button state, mounted and absent Toast behavior, stale fencing, request-local cleanup, original Toaster parameters, and the absence of a second readiness/result surface.

#### Scenario: Product boundaries remain testable

- **WHEN** the runtime, persistence, protocol, or reconnect implementation changes
- **THEN** the affected contract suites and structural checks SHALL detect owner leakage, public-boundary widening, obsolete architecture residue, feedback-state duplication, local-display gating by later settlement or Error classification, or a post-acceptance failure that suppresses the other side-effect attempt

#### Scenario: Runtime verification uses production boundaries

- **WHEN** browser Runtime behavior is accepted for release
- **THEN** verification SHALL use the built extension and real controls, record send-to-first-DOM timing through post-validation error windows with more than one failure source, and SHALL NOT treat `pnpm dev`, isolated Toaster mounting, synthetic clicks, source call order, or a terminal screenshot alone as product evidence
