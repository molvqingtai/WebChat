## ADDED Requirements

### Requirement: Independent store versions reset incompatible persistence

WebChat SHALL declare every persistence identity, key, and version together in `src/constants/storage.ts`: `STORAGE_NAME`, `MESSAGE_STORE_NAME`, `MESSAGE_STORE_VERSION`, `APP_STATUS_STORAGE_KEY`, `USER_INFO_STORAGE_KEY`, `CONFIG_STORE_VERSION`, and `CONFIG_STORE_VERSION_KEY`. Persistence owners SHALL import them from that module; `config.ts` and implementation modules SHALL declare no duplicate storage constant. `MESSAGE_STORE_NAME` SHALL equal exact `${STORAGE_NAME}:MESSAGES` (currently `WEB_CHAT_STORAGE:MESSAGES`), with no version token and no `${origin}` suffix because IndexedDB natively isolates databases by origin.

WebChat SHALL own exactly two private persistence-generation authorities named symmetrically `MESSAGE_STORE_VERSION` and `CONFIG_STORE_VERSION`. `MESSAGE_STORE_VERSION = 2` SHALL govern only the canonical per-origin IndexedDB message database `MESSAGE_STORE_NAME` through its native positive database version. `CONFIG_STORE_VERSION` SHALL govern only data behind the existing `Storage` boundary: the `${STORAGE_NAME}:` local namespace for per-origin `AppStatus` and the extension-wide `browser.storage.sync` area for `UserInfo`. Each configuration physical scope SHALL persist its own completion value under private `CONFIG_STORE_VERSION_KEY`; those scoped values SHALL record application of the one configuration authority and SHALL NOT become additional version authorities.

Before using `MESSAGE_STORE_NAME`, each origin SHALL issue a native deletion request for the old exact `${STORAGE_NAME}:EVENTS_V2_CANONICAL_RECORDS:${origin}` identity. An absent old identity SHALL settle as a no-op. If present, WebChat SHALL delete it in full without opening it, reading or decoding any store/row, inspecting its native version or data for compatibility, migrating, converting, backfilling, exporting, copying, or retaining any value. Target-name readiness SHALL not be published until old cleanup succeeds.

After old-identity deletion or its no-op settles, an absent `MESSAGE_STORE_NAME` SHALL be created directly at `MESSAGE_STORE_VERSION` without deleting any target data. An absent configuration completion value SHALL establish the current `CONFIG_STORE_VERSION` baseline without clearing any existing value, including data from an installation that predates this version mechanism. When a persisted target version strictly equals its target, WebChat SHALL preserve every value in that physical scope. When a persisted target version exists and is not strictly equal to its target, WebChat SHALL delete or clear that entire owned physical scope and rebuild it at the target. This strict inequality rule SHALL apply identically to adjacent, skipped, reverse, future, and otherwise non-equal versions; a malformed configuration completion value SHALL also be a mismatch. Versions SHALL NOT be ordered, migrated in steps, compared by magnitude, decoded by shape, or granted a downgrade-preservation exception.

Old-identity cleanup or a target native-version reset SHALL delete the whole selected database and every store, row, index, `records` value, bounded `conflicts` diagnostic, and unknown residue inside that exact identity. A target mismatch SHALL recreate `MESSAGE_STORE_NAME` at `MESSAGE_STORE_VERSION`; changing the identity alone SHALL NOT advance that version. When old and target identities coexist, old deletion SHALL complete first, after which a same-version target is preserved or a mismatched target is independently reset. A configuration reset SHALL clear every WebChat-owned value in each mismatched scope before establishing that scope's `CONFIG_STORE_VERSION` completion: the current origin's `${STORAGE_NAME}:` local namespace and the WebChat extension's `browser.storage.sync` area. It SHALL NOT clear host-page local keys outside the WebChat namespace, another origin eagerly, an unrelated IndexedDB database, a browser storage area outside current configuration ownership, or the other persistence family.

`runtime.onInstalled` SHALL be only an eager awaited trigger for the extension-wide configuration check; the extension/package version and install/update reason SHALL NOT participate in the comparison. Before constructing the application store or mounting WebChat, each content injection SHALL await the extension-wide configuration check as an interrupted-work fallback, the current origin's local configuration check, and the current origin's canonical message-database check. Origins SHALL be reset lazily when next injected rather than through tab enumeration. No application read, watch, write, history query, default-state write, or UI mount SHALL use an affected scope before it reaches target readiness.

Each check/reset/rebuild lifecycle SHALL be serialized by physical store identity and target version. One origin's message lifecycle SHALL encompass old-name cleanup and target-name evaluation. Concurrent contenders SHALL join the current lifecycle or re-read both identities after acquiring ownership; a contender that then observes old absence and target completion SHALL preserve the target and SHALL NOT issue a second delete or clear. The two persistence families SHALL remain independent: success in one SHALL not mark, clear, roll back, or repeat the other, while a page SHALL mount only after all of its required scopes are ready.

A native IndexedDB `blocked` state during old or target deletion SHALL remain non-ready and MAY produce only one bounded console diagnostic while the same owned request waits; it SHALL NOT open the old database, admit the target beside uncleared old data, start a competing delete, time out into a late unowned deletion, or produce close-tabs UI. Any terminal persisted-version read, delete, clear, target-recreation, or completion-write failure SHALL produce only a bounded `console.error`, SHALL NOT advance the failed completion state, and SHALL keep that WebChat startup closed so a later `onInstalled`, Runtime startup, or injection retries from persisted truth. Logs SHALL expose no persisted value or user content. No failure or blocked path SHALL create a Toast, `AppFeedback`, alert, DOM/status error, notification, SystemNotice, retry control, or other user-visible migration surface.

Each native message deletion success SHALL be irreversible. Interruption before old cleanup SHALL leave it retryable without opening the old identity. After old cleanup, the next injection SHALL evaluate the target independently: it SHALL preserve an already-existing same-version target and SHALL create an absent target, including one deleted for mismatch, empty without restoring any deleted value or requiring a second message marker. Message readiness requires both old identity absence and target availability at `MESSAGE_STORE_VERSION`. A configuration completion value SHALL advance only after its entire owned clear succeeds; until then no application writer may repopulate that scope, so an interrupted attempt may retry the clear safely. Successful cleanup SHALL create no migration-specific success feedback: old cleanup beside a current target preserves ordinary history, a recreated target has empty history, and configuration reset produces only the ordinary default/setup state.

Deprecated unstorage IndexedDB message data SHALL remain unread, unconverted, uncleared, and unmarked. The active unstorage-backed `LocalStorageImpl` and `BrowserSyncStorageImpl` SHALL remain configuration scopes and reset only under `CONFIG_STORE_VERSION`. The public `Database`, `MessageStore`, and `Storage` contracts, Memory database behavior, Runtime ownership, Chat/World behavior, peer wire, and dependency graph SHALL remain unchanged.

#### Scenario: Missing persistence establishes a non-destructive baseline

- **GIVEN** neither old nor target message identity exists, or a configuration scope has no completion value even though pre-version values may exist
- **WHEN** WebChat first applies the two version authorities
- **THEN** the absent-old deletion request SHALL settle as a no-op, after which WebChat SHALL create the message database empty or record the configuration target without clearing any existing pre-version configuration value

#### Scenario: Old canonical identity is discarded without compatibility

- **GIVEN** the current origin contains `${STORAGE_NAME}:EVENTS_V2_CANONICAL_RECORDS:${origin}` at any native version, with arbitrary stores and values
- **WHEN** message preparation runs
- **THEN** WebChat SHALL delete that exact database without opening, reading, decoding, migrating, converting, backfilling, exporting, copying, or retaining its data
- **AND** only after deletion succeeds SHALL it create or admit `${STORAGE_NAME}:MESSAGES` at `MESSAGE_STORE_VERSION`

#### Scenario: Same versions preserve both families

- **GIVEN** the old message identity is absent, the target message database native version equals `MESSAGE_STORE_VERSION`, and every required configuration completion value equals `CONFIG_STORE_VERSION`
- **WHEN** the extension updates normally, restarts, or injects another page
- **THEN** all canonical messages, conflicts, UserInfo, AppStatus, preferences, and owned completion values SHALL remain unchanged and no reset SHALL run

#### Scenario: Message mismatch deletes the complete canonical database

- **GIVEN** one origin's canonical database has an existing native version not strictly equal to `MESSAGE_STORE_VERSION`
- **WHEN** that origin is next injected
- **THEN** exactly `MESSAGE_STORE_NAME` in that origin partition SHALL be deleted in full and recreated at the target with zero old record, conflict, store, index, or unknown residue

#### Scenario: Coexisting old and target identities converge without target data loss

- **GIVEN** an origin contains both the old canonical identity and a target `MESSAGE_STORE_NAME` whose native version equals `MESSAGE_STORE_VERSION`
- **WHEN** preparation runs
- **THEN** WebChat SHALL delete the old identity, preserve every target-name record byte-for-byte, and SHALL not use old contents to validate, overwrite, merge, or repopulate the target

#### Scenario: Configuration mismatch clears current owned scopes

- **GIVEN** an existing extension-wide or current-origin configuration completion value is not strictly equal to `CONFIG_STORE_VERSION`
- **WHEN** its eager or injection-time check runs
- **THEN** that physical scope's WebChat-owned configuration values SHALL be cleared before its target completion is recorded, and ordinary defaults or new UserInfo MAY be created only afterward

#### Scenario: Skipped and reverse versions use the same direct reset

- **GIVEN** a persisted message or configuration version differs from its target by one generation, several skipped generations, or a reverse/future generation
- **WHEN** readiness is evaluated
- **THEN** WebChat SHALL perform one direct reset to the target without ordering the values, running intermediate migrations, preserving the newer value, or resetting a scope twice

#### Scenario: Package update is not a data trigger

- **GIVEN** the extension/package, semantic-release, wire, or protocol version changes while the old message identity is absent and both persisted store versions equal their targets
- **WHEN** `runtime.onInstalled`, Runtime startup, and content injection execute
- **THEN** both persistence families SHALL be preserved and no app-version marker, package import, startup clear, or destructive operation SHALL participate

#### Scenario: Persistence families advance independently

- **GIVEN** only `MESSAGE_STORE_VERSION` or only `CONFIG_STORE_VERSION` differs from persisted state
- **WHEN** preparation completes
- **THEN** WebChat SHALL reset only the mismatched family, preserve the other family byte-for-byte, and SHALL not treat one family's completion as the other's completion

#### Scenario: Other origins remain lazy and isolated

- **GIVEN** multiple origins have WebChat data from a non-current generation
- **WHEN** one origin receives its first new-version injection
- **THEN** only that origin partition's old/target databases and local configuration scope SHALL be evaluated while other origins remain untouched until their own later injection
- **AND** every origin SHALL use the same exact `MESSAGE_STORE_NAME` without an encoded origin suffix, while an extension-wide configuration reset still occurs at most once for its own scope

#### Scenario: Concurrent contenders cannot erase target writes

- **GIVEN** two or more tabs or extension contexts observe the same non-current physical store
- **WHEN** they request readiness concurrently and one lifecycle resets and reaches the target
- **THEN** every contender SHALL converge on that lifecycle or re-read target completion, and no later contender SHALL delete messages or configuration written after the first reset

#### Scenario: Blocked message deletion remains console-only and non-ready

- **GIVEN** deletion of the old identity or a mismatched target identity is blocked by a live connection
- **WHEN** the reset request reports `blocked`
- **THEN** WebChat SHALL keep the affected application unmounted, MAY emit one bounded console diagnostic, SHALL expose no user-visible warning or error, and SHALL neither open the old database nor start a second or late-unowned delete

#### Scenario: Terminal cleanup failure retries without user feedback

- **GIVEN** a version read, delete, clear, recreation, or completion write rejects
- **WHEN** the current preparation lifecycle terminates
- **THEN** only bounded console error logging SHALL occur, the failed completion SHALL remain unadvanced, no WebChat UI or migration feedback SHALL mount from that lifecycle, and the next owning lifecycle SHALL retry from persisted state

#### Scenario: Interruption after deleting the only usable message identity rebuilds empty

- **GIVEN** old-identity deletion succeeded while the target was absent, or mismatched-target deletion succeeded, but execution ended before target recreation completed
- **WHEN** the origin is injected again
- **THEN** WebChat SHALL create the absent target database empty, SHALL not restore or decode old values, and SHALL not require or write a second message-migration marker

#### Scenario: Successful cleanup has only ordinary product outcomes

- **WHEN** old-identity cleanup, target recreation, or configuration reset succeeds
- **THEN** WebChat SHALL emit no migration Toast, `AppFeedback`, alert, notification, SystemNotice, or success copy; old cleanup beside a current target SHALL preserve its history, a recreated target SHALL have empty history, and configuration reset SHALL expose only the ordinary default/setup state

#### Scenario: Reset scope preserves unrelated and deprecated data

- **GIVEN** sentinels exist in the other persistence family, another origin, host-page localStorage outside `${STORAGE_NAME}:`, unrelated IndexedDB, browser areas outside current ownership, and deprecated unstorage message storage
- **WHEN** either family resets
- **THEN** every out-of-scope sentinel SHALL remain unchanged, and deprecated unstorage message data SHALL remain unread, unconverted, uncleared, and unmarked

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

A strict decoder SHALL choose the closed variant only through outer `record.type`; it SHALL NOT infer record kind from `DatabaseItem.key`, an id/key prefix or shape, or the presence of `message`/`notice`. Every decoded record SHALL satisfy `DatabaseItem.key === record.id`. A decoded Chat record SHALL also satisfy `record.id === record.message.id` and `record.user.id === record.message.userId`; a decoded SystemNotice SHALL satisfy `record.id === record.notice.id`. Chat and notice ids SHALL occupy one globally unique record-id space so atomic first-value-wins cannot collide across variants. `Notice.type` remains the independent `join | leave | info` reason; outer `record.type` remains only the `chat-message | system-notice` storage/Domain category. SystemNotice identity SHALL be deterministic and it SHALL never enter peer wire or history. `receivedAt` is finite local first-acceptance/creation time, not an HLC, peer timestamp, or delivery state. Record ordering helpers SHALL use `(record.message.hlc, record.id)` for Chat and `(record.notice.hlc, record.id)` for SystemNotice; reaction LWW SHALL continue to use `(message.hlc, message.id)`, and UI reaction aggregation remains projection-only. There SHALL be no standalone `SYSTEM_NOTICE`, old outer notice `hlc`/`body`/`noticeType`, `LocalRecord`, `DurableEventRecord`, outer `event` alias, property-presence guard, key-based discriminator, `RecordStatus`, pending/sent/received state, mark method, outbox metadata, compatibility alias, or dual-read path.

The only host-replaceable persistence extern SHALL be `Database<Schema>`. IndexedDB and Memory SHALL implement it for one private `MessageDatabaseSchema` and private logical database name/version/store/index configuration. A future backend is compatible only after running the same public contract suite. The single internal concrete MessageStore SHALL be Database-backed and expose only `insert(record): Promise<InsertMessageResult>`, `query(query?: MessageQuery)`, `clear`, and `watch`; it SHALL NOT expose `list` or a compatibility alias and SHALL NOT be a Remesh extern, public-barrel export, host injection point, or independently replaceable backend. Its internal helpers SHALL strictly decode MessageRecord, derive message/notice keys and HLCs, validate Database item identity, distinguish same-id canonical replay from different-content conflict, and keep the first value without overwrite. `InsertMessageResult` SHALL be the readonly inserted/existing Domain union and SHALL NOT reuse Database's result type.

The canonical per-origin IndexedDB identity SHALL be replaced once with `MESSAGE_STORE_NAME`, whose exact value is `${STORAGE_NAME}:MESSAGES`, and thereafter remain stable. Private `MESSAGE_STORE_VERSION = 2`, imported from the same storage-specific constants module and consumed by the native persistence lifecycle, SHALL remain the sole schema-generation authority and SHALL NOT advance for this identity-only change. The old `${STORAGE_NAME}:EVENTS_V2_CANONICAL_RECORDS:${origin}` identity SHALL be deleted without compatibility before target readiness. An absent target database SHALL be created at the target, and a same-version target database SHALL preserve canonical records and bounded conflict diagnostics. Any existing target native version that is not strictly equal to `MESSAGE_STORE_VERSION` SHALL delete the whole target database and recreate it empty; it SHALL NOT run an ordered or record-preserving migration. `CONFIG_STORE_VERSION` SHALL independently govern only the active configuration stores. After this explicit replacement, app/wire versions and ordinary fixes SHALL NOT clear, rename, or delete either family. Deprecated unstorage message data remains outside this lifecycle and is never read or converted.

The headless Runtime SHALL own only network/history orchestration around the application-owned store: `HistoryDomain` owns requester/provider State, candidate-window and byte/message budgets, supplier selection/failover, page cancellation, and physical settlement; `WireDomain` owns protocol scheduling/queues; the page-host boundary owns internal RPC. Shared models consumed by both pages and Runtime SHALL remain defined by an application Domain/model module rather than by any Runtime owner or the public protocol.

#### Scenario: Application persistence boundary

- **WHEN** a page persists, projects, or synchronizes local records
- **THEN** the Database-backed application persistence boundary SHALL own that work, the headless Runtime Domains SHALL own no history read model, and Chat/UI SHALL receive only decoded Domain records/projections rather than storage primitives

### Requirement: One-shot migration without dual architecture

The change SHALL be delivered as one candidate that includes the hosts, exact eight-method ChatRoom port, state-free Runtime client, clean-cut internal comctx surface, uniquely owned Lifecycle/Connection/Session/World/History/Delivery/Wire Domain graph, private RoomTransport Extern/provider composition, message delivery, reconnect entry, current v3 peer protocol, exact typed Database extern/default adapters, internal concrete MessageStore, canonical outer-type/outer-id `MessageRecord` with `ChatMessageRecord.message` and `SystemNoticeRecord.notice`, send-first persistence, and complete removal of page-owned WebRTC, v1/v2 active protocol paths, stateful ChatRoom authority, catch-all Network ownership, and old WireExtern/provider route. Persistence and Runtime authority SHALL be complete clean-cut structural replacements rather than minimal repairs; no compatibility wrapper, alias, dual path, dead facade, hidden state channel, provider leak, or test-only accommodation may retain an obsolete owner/record/Store/outbox architecture. No intermediate release SHALL ship multiple architectures or protocol generations. Deprecated unstorage local message history SHALL NOT be imported, migrated, retained by, or used as a version marker for the canonical database; same-version canonical history SHALL remain governed by `MESSAGE_STORE_VERSION`.

#### Scenario: Single-candidate completeness

- **WHEN** the release candidate is inspected
- **THEN** it SHALL contain the full Remesh DDD + CQRS Runtime architecture and current v3 protocol, and SHALL NOT contain any active page-owned WebRTC path, v1/v2 protocol room path, stateful ChatRoom recovery authority, catch-all Network owner, old WireExtern route, or dual writable fact

#### Scenario: No data migration

- **WHEN** the extension upgrades with deprecated unstorage message data present
- **THEN** the old data SHALL be left unread, unconverted, and uncleared, and no deprecated-message import/conversion code, compatibility marker, or reaction conversion SHALL exist; private configuration-store completion values SHALL NOT be treated as old-message migration markers
