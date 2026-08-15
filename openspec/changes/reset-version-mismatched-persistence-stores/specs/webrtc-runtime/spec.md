## ADDED Requirements

### Requirement: Independent store versions reset incompatible persistence

WebChat SHALL declare every persistence identity, key, and version together in `src/constants/storage.ts`: `STORAGE_NAME`, `MESSAGE_STORE_VERSION`, `APP_OPEN_STORAGE_KEY`, `APP_POSITION_STORAGE_KEY`, `APP_UNREAD_STORAGE_KEY`, `USER_INFO_STORAGE_KEY`, `CONFIG_STORE_VERSION`, and `CONFIG_STORE_VERSION_KEY`. Persistence owners SHALL import them from that module; `config.ts` and implementation modules SHALL declare no duplicate storage constant. The AppStatus field keys SHALL have the exact values `WEB_CHAT_APP_STATUS:OPEN`, `WEB_CHAT_APP_STATUS:POSITION`, and `WEB_CHAT_APP_STATUS:UNREAD`. `STORAGE_NAME` SHALL be the exact canonical IndexedDB database identity (currently `WEB_CHAT_STORAGE`) and the root of the separate `${STORAGE_NAME}:` localStorage configuration-key namespace. IndexedDB and localStorage are separate browser-managed physical namespaces, so these uses SHALL NOT be treated as a collision. The IndexedDB name SHALL contain no message suffix, version token, or `${origin}` suffix because IndexedDB natively isolates databases by API and origin.

WebChat SHALL own exactly two private persistence-generation authorities named symmetrically `MESSAGE_STORE_VERSION` and `CONFIG_STORE_VERSION`. `MESSAGE_STORE_VERSION = 2` SHALL govern only the canonical per-origin IndexedDB message database named `STORAGE_NAME` through its native positive database version. `CONFIG_STORE_VERSION` SHALL govern version-managed values behind the existing `Storage` boundary: values in the `${STORAGE_NAME}:` local namespace other than the three AppStatus field keys, and the extension-wide `browser.storage.sync` area for `UserInfo`. Each configuration physical scope SHALL persist its own completion value under private `CONFIG_STORE_VERSION_KEY`; those scoped values SHALL record application of the one configuration authority and SHALL NOT become additional version authorities. `AppStatusDomain` SHALL own one aggregate `{ open, position, unread }` business truth; open, position, and boolean unread attention SHALL persist independently through their three field-scoped keys and SHALL remain outside configuration-version clearing.

Every non-target identity SHALL remain completely outside production persistence logic. WebChat SHALL define no non-target-name constant, construction, lookup, branch, open/read path, compatibility decoder, migration/conversion/backfill/export/copy path, clear/delete request, blocked/error handling, retry, readiness dependency, or completion marker. Its presence, absence, native version, and contents SHALL NOT affect the `STORAGE_NAME` target; non-target browser-managed bytes remain untouched.

An absent IndexedDB database named `STORAGE_NAME` SHALL be created directly at `MESSAGE_STORE_VERSION` without deleting any other database. An absent configuration completion value SHALL establish the current `CONFIG_STORE_VERSION` baseline without clearing any existing value. When a persisted active-target version strictly equals its target, WebChat SHALL preserve every value in that physical scope. When a persisted active-target version exists and is not strictly equal to its target, WebChat SHALL delete the target message database or clear the configuration scope's version-managed values and then record the target. The three AppStatus field keys SHALL remain preserved for every configuration-version result. This strict inequality rule SHALL apply identically to every non-equal version; a malformed configuration completion value SHALL also be a mismatch. Versions SHALL NOT be ordered or compared by magnitude.

A target native-version reset SHALL delete only the IndexedDB database named `STORAGE_NAME` and every store, row, index, `records` value, bounded `conflicts` diagnostic, and unknown residue inside that exact active identity before recreating it at `MESSAGE_STORE_VERSION`; changing the identity alone SHALL NOT advance that version. A configuration reset SHALL clear the current origin's version-managed `${STORAGE_NAME}:` local values or the WebChat extension's `browser.storage.sync` values before establishing that scope's `CONFIG_STORE_VERSION` completion. The local clear SHALL preserve `APP_OPEN_STORAGE_KEY`, `APP_POSITION_STORAGE_KEY`, and `APP_UNREAD_STORAGE_KEY`. It SHALL NOT clear host-page local keys outside the WebChat namespace, another origin eagerly, any non-target IndexedDB database, a browser storage area outside current configuration ownership, or the other active persistence family.

`runtime.onInstalled` SHALL be only an eager awaited trigger for the extension-wide configuration check; the extension/package version and install/update reason SHALL NOT participate in the comparison. Before constructing the application store or mounting WebChat, each content injection SHALL await the extension-wide configuration check as an interrupted-work fallback, the current origin's local configuration check, and the current origin's canonical message-database check. Origins SHALL be reset lazily when next injected rather than through tab enumeration. No application read, watch, write, history query, default-state write, or UI mount SHALL use an affected scope before it reaches target readiness.

Each check/reset/rebuild lifecycle SHALL be serialized by active physical store identity and target version. Concurrent contenders SHALL join the current lifecycle or re-read the active target after acquiring ownership; a contender that then observes target completion SHALL preserve it and SHALL NOT issue a second delete or clear. The two active persistence families SHALL remain independent: success in one SHALL not mark, clear, roll back, or repeat the other, while a page SHALL mount only after all of its required scopes are ready.

A native IndexedDB `blocked` state during target-mismatch deletion SHALL remain non-ready and MAY produce only one bounded console diagnostic while the same owned request waits; it SHALL NOT start a competing delete, time out into a late unowned deletion, or produce close-tabs UI. Any terminal active persisted-version read, delete, clear, target-recreation, or completion-write failure SHALL retain its original Error, SHALL NOT advance the failed completion state, and SHALL keep that WebChat startup closed so a later `onInstalled`, Runtime startup, or injection retries from persisted truth. A failure owned by a current page request that prevents that page's initialization or persistence readiness SHALL use the existing application error route and SHALL pass exactly the original `error.message` to `toast.error` once with no prefix, suffix, wrapper, mapping, normalization, or replacement copy. Install-time work with no current page, a failure with no current affected page/live route, and work that structurally has no current-user impact SHALL call `console.error(error)` directly at its owner. The original Error/message SHALL remain subject to the existing privacy-safe construction boundary, and routing SHALL add no persisted value, user content, origin detail, or raw data. No path SHALL create reset-specific `AppFeedback`, alert, DOM/status error, notification, SystemNotice, retry control, migration copy, or a second Toast.

Each target message deletion success SHALL be irreversible. Interruption before target-mismatch deletion SHALL leave that mismatch retryable; interruption after target deletion SHALL permit the next injection to create the `STORAGE_NAME` database empty. Message readiness requires only target availability at `MESSAGE_STORE_VERSION`; non-target identity state does not participate. A configuration completion value SHALL advance only after all version-managed values in its scope are cleared; until then no application writer may repopulate those values, so an interrupted attempt may retry the clear safely. Successful reset SHALL create no reset-specific success feedback: an absent or recreated target has empty history, configuration reset produces only the ordinary default/setup state for cleared values, and AppStatus remains preserved.

Every non-target database SHALL remain unread, unconverted, uncleared, unmarked, and outside readiness. The active unstorage-backed `LocalStorageImpl` and `BrowserSyncStorageImpl` SHALL provide the configuration scopes. Local preparation SHALL clear only version-managed local values and preserve the three AppStatus field keys; sync preparation SHALL clear values owned through `BrowserSyncStorageImpl`. The public `Database`, `MessageStore`, and `Storage` contracts, Memory database behavior, Runtime ownership, Chat/World behavior, peer wire, and dependency graph SHALL remain unchanged.

#### Scenario: Missing persistence establishes a non-destructive baseline

- **GIVEN** the active target message identity does not exist, or a configuration scope has no completion value even though pre-version values may exist
- **WHEN** WebChat first applies the two version authorities
- **THEN** WebChat SHALL create the target message database empty or record the configuration target without deleting another database or clearing any existing pre-version configuration value

#### Scenario: Same versions preserve both families

- **GIVEN** the target message database native version equals `MESSAGE_STORE_VERSION` and every required configuration completion value equals `CONFIG_STORE_VERSION`
- **WHEN** the extension updates normally, restarts, or injects another page
- **THEN** all canonical messages, conflicts, UserInfo, the aggregate AppStatus fields, preferences, and owned completion values SHALL remain unchanged and no reset SHALL run

#### Scenario: Message mismatch deletes the complete canonical database

- **GIVEN** one origin's canonical database has an existing native version not strictly equal to `MESSAGE_STORE_VERSION`
- **WHEN** that origin is next injected
- **THEN** exactly the IndexedDB database named `STORAGE_NAME` in that origin partition SHALL be deleted in full and recreated at the target with zero prior-target record, conflict, store, index, or unknown residue

#### Scenario: Configuration mismatch clears current owned scopes

- **GIVEN** an existing extension-wide or current-origin configuration completion value is not strictly equal to `CONFIG_STORE_VERSION`
- **WHEN** its eager or injection-time check runs
- **THEN** that physical scope's version-managed configuration values SHALL be cleared before its target completion is recorded, the three AppStatus field values SHALL remain unchanged, and ordinary defaults or new UserInfo MAY be created only afterward

#### Scenario: Skipped and reverse versions use the same direct reset

- **GIVEN** a persisted message or configuration version differs from its target by one generation, several skipped generations, or a reverse/future generation
- **WHEN** readiness is evaluated
- **THEN** WebChat SHALL perform one direct reset to the target without ordering the values, running intermediate migrations, preserving the newer value, or resetting a scope twice

#### Scenario: Package update is not a data trigger

- **GIVEN** the extension/package, semantic-release, wire, or protocol version changes while both active persisted store versions equal their targets
- **WHEN** `runtime.onInstalled`, Runtime startup, and content injection execute
- **THEN** both persistence families SHALL be preserved and no app-version marker, package import, startup clear, or destructive operation SHALL participate

#### Scenario: Persistence families advance independently

- **GIVEN** only `MESSAGE_STORE_VERSION` or only `CONFIG_STORE_VERSION` differs from persisted state
- **WHEN** preparation completes
- **THEN** WebChat SHALL reset only the mismatched family, preserve the other family byte-for-byte, and SHALL not treat one family's completion as the other's completion

#### Scenario: Other origins remain lazy and isolated

- **GIVEN** multiple origins have WebChat data from a non-current generation
- **WHEN** one origin receives its first new-version injection
- **THEN** only that origin partition's target database and local configuration scope SHALL be evaluated while other origins remain untouched until their own later injection
- **AND** every origin SHALL use the same exact `STORAGE_NAME` database name without a message or origin suffix, while an extension-wide configuration reset still occurs at most once for its own scope

#### Scenario: Concurrent contenders cannot erase target writes

- **GIVEN** two or more tabs or extension contexts observe the same non-current physical store
- **WHEN** they request readiness concurrently and one lifecycle resets and reaches the target
- **THEN** every contender SHALL converge on that lifecycle or re-read target completion, and no later contender SHALL delete messages or configuration written after the first reset

#### Scenario: Blocked message deletion remains console-only and non-ready

- **GIVEN** deletion of a mismatched IndexedDB target named `STORAGE_NAME` is blocked by a live connection
- **WHEN** the reset request reports `blocked`
- **THEN** WebChat SHALL keep the affected application unmounted, MAY emit one bounded console diagnostic, SHALL expose no user-visible warning or error, and SHALL start no second or late-unowned delete

#### Scenario: Terminal cleanup failure retries without user feedback

- **GIVEN** a version read, delete, clear, recreation, or completion write rejects during install-time work with no current page, or structural facts prove that it has no current-user impact or affected page/live route
- **WHEN** the current preparation lifecycle terminates
- **THEN** its owner SHALL call `console.error(error)` directly, the failed completion SHALL remain unadvanced, no WebChat UI or migration feedback SHALL mount from that lifecycle, and the next owning lifecycle SHALL retry from persisted state

#### Scenario: Current-page preparation failure uses the existing error route

- **GIVEN** a current page request owns a version read, delete, clear, recreation, or completion write that rejects and prevents that page's initialization or persistence readiness
- **WHEN** the current preparation lifecycle terminates
- **THEN** the failed completion SHALL remain unadvanced, that page's startup SHALL remain closed, the existing application error route SHALL pass exactly the original `error.message` to `toast.error` once without decoration or replacement copy, and the next owning lifecycle SHALL retry from persisted state

#### Scenario: Interruption after target deletion rebuilds empty

- **GIVEN** mismatched-target deletion succeeded but execution ended before target recreation completed
- **WHEN** the origin is injected again
- **THEN** WebChat SHALL create the absent target database empty, SHALL not restore or decode old values, and SHALL not require or write a second message-migration marker

#### Scenario: Successful reset has only ordinary product outcomes

- **WHEN** target creation/recreation or configuration reset succeeds
- **THEN** WebChat SHALL emit no reset Toast, `AppFeedback`, alert, notification, SystemNotice, or success copy; an absent or recreated target SHALL have empty history, configuration reset SHALL expose only the ordinary default/setup state for cleared values, and AppStatus SHALL remain unchanged

#### Scenario: Reset scope preserves unrelated data

- **GIVEN** sentinels exist in the other active persistence family, another origin, host-page localStorage outside `${STORAGE_NAME}:`, a generated unrelated IndexedDB database, and browser areas outside current ownership
- **WHEN** either family resets
- **THEN** every out-of-scope sentinel SHALL remain unchanged, and the unrelated database SHALL remain unread, unconverted, uncleared, and unmarked

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

A strict decoder SHALL choose the closed variant only through outer `record.type`; it SHALL NOT infer record type from `DatabaseItem.key`, an id/key prefix or shape, or the presence of `message`/`notice`. Every decoded record SHALL satisfy `DatabaseItem.key === record.id`. A decoded Chat record SHALL also satisfy `record.id === record.message.id` and `record.user.id === record.message.userId`; a decoded SystemNotice SHALL satisfy `record.id === record.notice.id`. Chat and notice ids SHALL occupy one globally unique record-id space so atomic first-value-wins cannot collide across variants. `Notice.type` remains the independent `join | leave | info` reason; outer `record.type` remains only the `chat-message | system-notice` storage/Domain category. SystemNotice identity SHALL be deterministic and it SHALL never enter peer wire or history. `receivedAt` is finite local first-acceptance/creation time, not an HLC, peer timestamp, or delivery state. Record ordering helpers SHALL use `(record.message.hlc, record.id)` for Chat and `(record.notice.hlc, record.id)` for SystemNotice; reaction LWW SHALL continue to use `(message.hlc, message.id)`, and UI reaction aggregation remains projection-only. There SHALL be no standalone `SYSTEM_NOTICE`, old outer notice `hlc`/`body`/`noticeType`, `LocalRecord`, `DurableEventRecord`, outer `event` alias, property-presence guard, key-based discriminator, `RecordStatus`, pending/sent/received state, mark method, outbox metadata, compatibility alias, or dual-read path.

The only host-replaceable persistence extern SHALL be `Database<Schema>`. IndexedDB and Memory SHALL implement it for one private `MessageDatabaseSchema` and private logical database name/version/store/index configuration. A future backend is compatible only after running the same public contract suite. The single internal concrete MessageStore SHALL be Database-backed and expose only `insert(record): Promise<InsertMessageResult>`, `query(query?: MessageQuery)`, `clear`, and `watch`; it SHALL NOT expose `list` or a compatibility alias and SHALL NOT be a Remesh extern, public-barrel export, host injection point, or independently replaceable backend. Its internal helpers SHALL strictly decode MessageRecord, derive message/notice keys and HLCs, validate Database item identity, distinguish same-id canonical replay from different-content conflict, and keep the first value without overwrite. `InsertMessageResult` SHALL be the readonly inserted/existing Domain union and SHALL NOT reuse Database's result type.

The canonical per-origin IndexedDB identity SHALL be direct `STORAGE_NAME`, whose exact current value is `WEB_CHAT_STORAGE`, and remain stable. Private `MESSAGE_STORE_VERSION = 2`, imported from the same storage-specific constants module and consumed by the native persistence lifecycle, SHALL remain the sole schema-generation authority. Every non-target identity SHALL remain untouched and entirely outside production lookup, access, cleanup, readiness, failure, and retry logic. An absent target database SHALL be created empty, and a same-version target database SHALL preserve canonical records and bounded conflict diagnostics. Any existing target native version that is not strictly equal to `MESSAGE_STORE_VERSION` SHALL delete the whole target database and recreate it empty. `CONFIG_STORE_VERSION` SHALL independently govern only version-managed values in the active configuration scopes and SHALL preserve `APP_OPEN_STORAGE_KEY`, `APP_POSITION_STORAGE_KEY`, and `APP_UNREAD_STORAGE_KEY`. App/wire versions and ordinary fixes SHALL NOT clear, rename, or delete either active family.

The headless Runtime SHALL own only network/history orchestration around the application-owned store: `HistoryDomain` owns requester/provider State, candidate-window and byte/message budgets, supplier selection/failover, page cancellation, and physical settlement; `WireDomain` owns protocol scheduling/queues; the page-host boundary owns internal RPC. Shared models consumed by both pages and Runtime SHALL remain defined by an application Domain/model module rather than by any Runtime owner or the public protocol.

#### Scenario: Application persistence boundary

- **WHEN** a page persists, projects, or synchronizes local records
- **THEN** the Database-backed application persistence boundary SHALL own that work, the headless Runtime Domains SHALL own no history read model, and Chat/UI SHALL receive only decoded Domain records/projections rather than storage primitives

### Requirement: One-shot migration without dual architecture

The change SHALL be delivered as one candidate that includes the hosts, exact eight-method ChatRoom port, state-free Runtime client, clean-cut internal comctx surface, uniquely owned Lifecycle/Connection/Session/World/History/Delivery/Wire Domain graph, private RoomTransport Extern/provider composition, message delivery, reconnect entry, current v3 peer protocol, exact typed Database extern/default adapters, internal concrete MessageStore, canonical outer-type/outer-id `MessageRecord` with `ChatMessageRecord.message` and `SystemNoticeRecord.notice`, send-first persistence, and complete removal of page-owned WebRTC, v1/v2 active protocol paths, stateful ChatRoom authority, catch-all Network ownership, and old WireExtern/provider route. Persistence and Runtime authority SHALL be complete clean-cut structural replacements rather than minimal repairs; no compatibility wrapper, alias, dual path, dead facade, hidden state channel, provider leak, or test-only accommodation may retain an obsolete owner/record/Store/outbox architecture. No intermediate release SHALL ship multiple architectures or protocol generations. Same-version canonical history SHALL remain governed by `MESSAGE_STORE_VERSION`.

#### Scenario: Single-candidate completeness

- **WHEN** the release candidate is inspected
- **THEN** it SHALL contain the full Remesh DDD + CQRS Runtime architecture and current v3 protocol, and SHALL NOT contain any active page-owned WebRTC path, v1/v2 protocol room path, stateful ChatRoom recovery authority, catch-all Network owner, old WireExtern route, or dual writable fact
