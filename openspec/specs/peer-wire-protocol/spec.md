# peer-wire-protocol Specification

## Purpose

TBD - created by archiving change refactor-to-shared-webrtc-runtime. Update Purpose after archive.

## Requirements

### Requirement: Public protocol module is pure and explicitly bounded

The code-level public module `src/protocol/index.ts` SHALL be the third-party-facing peer contract without introducing a package, publishing flow, or SDK. Its wire structures SHALL be exactly the Owner-frozen `ChatUser`, `ChatSession`, `HLC`, `MentionedUser`, `SessionMessage`, `TextMessage`, `ReactionMessage`, `ChatMessage`, `HistoryMessagesPull`, `HistoryMessagesPush`, `ChatRoomMessage`, `ChatSite`, and `WorldRoomMessage` contracts. It SHALL additionally export only their static declarative schemas, schema-inferred TypeScript types, public limits/constants, and the public codec surface (`WireCodec`, `NativeWireCodec` reference implementation, `WireCodecError`). It SHALL NOT add or rename any retained encoded field or literal, export a structural alias or compatibility DTO, expose a session-end surface, or expose an optional/open metadata bag without explicit Owner intervention. Declarative validation SHALL cover closed-union and unknown-key rejection, primitive/literal shape, field and array ceilings, tuples, required SESSION `joinedAt`, and safe non-negative integer fields. It SHALL NOT validate whole-value canonical byte size, mention/body relationships, future HLC relative to receiver time, origin-only URL semantics, uniqueness, or History user/message references. The `NativeWireCodec` SHALL own only the fixed codec/security algorithm; the public protocol SHALL NOT export local persistence/UI models, projections, ordering implementations, Runtime lifecycle or page-host RPC contracts, WirePipeline queue/drop/apply/flush types, or application orchestration.

`src/protocol/**` SHALL NOT depend on `domain/runtime`, `service`, `app`, UI, storage, comctx, browser-extension APIs/globals (`chrome.*`/`browser.*`), DOM/window/document, host lifecycle APIs, or app configuration. The public `NativeWireCodec` MAY use the standard Web codec APIs it implements (`CompressionStream`, `DecompressionStream`, `Blob`, `ReadableStream`, `TextEncoder`, and `TextDecoder`) and exactly the two scoped `core-js` imports; no whole-package polyfill is permitted. Protocol-owned limits and pure byte utilities SHALL be defined within the protocol boundary. Runtime and Domain code SHALL depend on the public protocol one way; the protocol SHALL NOT import Runtime or Domain code.

The normative public structures SHALL be byte-for-byte equivalent to these declarations:

```ts
interface ChatUser {
  id: string
  name: string
  avatar: string
}
interface ChatSession {
  sessionId: string
  user: ChatUser
}
interface HLC {
  timestamp: number
  counter: number
}
interface MentionedUser extends ChatUser {
  ranges: [number, number][]
}
interface SessionMessage extends ChatSession {
  type: 'session'
  presenceId: string
  joinedAt: number
}
interface TextMessage {
  type: 'text'
  id: string
  hlc: HLC
  userId: string
  body: string
  mentions: MentionedUser[]
}
interface ReactionMessage {
  type: 'reaction'
  id: string
  hlc: HLC
  targetId: string
  userId: string
  reaction: 'like' | 'hate'
  active: boolean
}
type ChatMessage = TextMessage | ReactionMessage
interface HistoryMessagesPull {
  type: 'history-messages-pull'
  syncId: string
  page: number
  messageIds: string[]
  done: boolean
}
interface HistoryMessagesPush {
  type: 'history-messages-push'
  syncId: string
  page: number
  users: ChatUser[]
  messages: ChatMessage[]
  done: boolean
}
type ChatRoomMessage = SessionMessage | ChatMessage | HistoryMessagesPull | HistoryMessagesPush
interface ChatSite {
  origin: string
  title?: string
  icon?: string
  description?: string
}
interface WorldRoomMessage extends ChatSession {
  sites: ChatSite[]
}
```

#### Scenario: Public entry has no local or internal exports

- **WHEN** a consumer imports from `@/protocol`
- **THEN** it SHALL see only the documented schema-inferred peer wire types, static declarative schemas, `WireCodec` interface, `NativeWireCodec` reference implementation, `WireCodecError`, and protocol constants; validator helpers, `LocalRecord`, UI models, projections, Runtime RPC, queue/drop types, and internal Runtime symbols SHALL not be reachable

#### Scenario: Public protocol dependency direction

- **WHEN** the protocol dependency graph is inspected
- **THEN** every protocol dependency SHALL remain cross-target compatible, and no reverse import from protocol into Runtime, Domain, storage, service, app, UI, comctx, browser-extension APIs/globals, DOM/window/document, host lifecycle APIs, or app configuration SHALL exist; standard Web codec APIs used by `NativeWireCodec` are allowed

### Requirement: Transport delivers trusted context

`WireDomain` SHALL receive inbound data only from the Runtime-private `RoomTransportExtern`, which delivers `(roomId, sourcePeerId, rawPayload)`. It SHALL compose the public `WireCodec` contract and validators; production/default wiring MAY use the `NativeWireCodec` reference implementation. Fatal UTF-8 decoding and bounded `readLimited` belong to that public codec implementation. `WireDomain` SHALL bind routing and session decisions to the provider-supplied `roomId` and `sourcePeerId`, and SHALL NOT trust any peer identity, room, or sender field self-reported inside a payload. It SHALL emit only strict, typed Events to the Runtime; raw frames and unvalidated decoded values SHALL not cross the Domain boundary. The public protocol module itself SHALL contain no transport routing, queue orchestration, provider type, or Runtime Extern.

#### Scenario: Payload self-reports identity

- **WHEN** a payload contains a peerId, room, or sender field, whether conflicting with or matching the transport context
- **THEN** the adapter SHALL reject the entire source-local frame as a forbidden envelope instead of stripping or ignoring the claim; accepted messages use the transport-provided `roomId` and `sourcePeerId`

#### Scenario: Fixed codec representation

- **WHEN** wire payloads are encoded or decoded
- **THEN** the public `NativeWireCodec` reference implementation SHALL provide `base64(deflate(UTF8(JSON)))`, native `CompressionStream`/`DecompressionStream`, fatal UTF-8 decoding, bounded `readLimited`, and a direct runtime dependency on exactly these scoped `core-js` global-patch imports: `core-js/actual/typed-array/from-base64` and `core-js/actual/typed-array/to-base64`. Business code SHALL call standard `Uint8Array.fromBase64(value, {alphabet:'base64', lastChunkHandling:'strict'})`, re-encode with `bytes.toBase64()`, and accept only exact equality with the input; no whole-package entry, pure export, JSONR special-value layer, or interop adapter SHALL exist

### Requirement: WireDomain composes the public codec and typed message boundary

The public protocol SHALL export `WireCodec` as the codec interface, `NativeWireCodec` as the reference implementation, and `WireCodecError` for codec failures. `WireDomain` SHALL expose a typed send Command whose value is logically `{roomId, targetPeerIds?, message}` and typed accepted-message Events whose value is logically `{roomId, sourcePeerId, message}`; exact local symbol names MAY follow the concise Runtime directory context. It SHALL compose the public `WireCodec` contract and validators; production/default wiring MAY use the public `NativeWireCodec` reference implementation. It SHALL enforce operational queue/drop/apply/flush policies, select parsers by trusted `roomId`, perform strict schema parsing, and bind source context. Queue/drop types SHALL remain private Wire State; concurrency/resource scheduling belongs to its named Runtime owner and SHALL NOT become a public protocol export. Other Runtime Domains SHALL receive typed Wire Events only and SHALL NOT receive `decoded: unknown`, encoded strings, provider callbacks, or Artico values. `targetPeerIds` SHALL remain optional in the logical send value; omission SHALL mean room broadcast. `sourcePeerId` SHALL always be the single transport-confirmed inbound source.

#### Scenario: Typed inbound boundary

- **WHEN** an inbound frame is accepted
- **THEN** `WireDomain` SHALL emit a typed message fact together with `{roomId, sourcePeerId}` and SHALL not expose an unvalidated decoded value or encoded frame to another Domain

#### Scenario: Symmetric CQRS boundary

- **WHEN** Runtime code sends or receives a wire message
- **THEN** it SHALL use the paired typed send Command and accepted-message Event values with `targetPeerIds`/`sourcePeerId` semantics; provider lifecycle callbacks SHALL enter as independent Wire Commands/Events rather than a public imperative adapter

### Requirement: Wire messages are strict closed unions with limits

The public protocol SHALL define closed static declarative schemas and pure limits. `WireDomain` SHALL parse the room-selected schema once at peer acceptance and MAY apply source-local operational policies after rejection, but queue/drop/apply/flush scheduling, rate-limited logging, reconnect behavior, page sequencing, attempt budgets, and delivery admission are not public protocol semantics.

Chat wire messages SHALL form a strict, closed discriminated union keyed by `type`; World wire payloads SHALL use one strict schema selected by trusted v5 `roomId` and SHALL NOT carry a payload `type`. The codec SHALL enforce `MAX_WIRE_BYTES = 64KiB` for final encoded frames and `MAX_DECODED_JSON_BYTES = 256KiB` for streaming decompressed JSON before parse. Declarative schemas SHALL enforce explicit built-in field and array ceilings, including at most 100 messages in one History Push page. Each `messageIds[]` element SHALL remain an opaque string with no standalone length or format rule and SHALL be bounded only by the containing codec frame and Runtime attempt budgets. SESSION `joinedAt`, HLC timestamp, HLC counter, and History `page` SHALL be finite safe non-negative integers. Unknown types including `session-end`, unknown keys, forbidden envelope/context fields, missing or invalid required values, and declaratively expressible limit violations SHALL fail schema parsing. Whole-value `ChatUser`, `ChatMessage`, and History page canonical byte sizes SHALL not be computed or validated. Non-canonical or malformed Base64, invalid UTF-8/JSON/deflate, and encoded/decompressed bounds SHALL remain codec representation failures before schema parsing.

#### Scenario: Unknown or oversized message

- **WHEN** peer input has an unknown type, violates a declarative field/array ceiling, or exceeds the encoded codec frame bound
- **THEN** the room-selected schema or codec SHALL reject the complete input before any Runtime application, without specifying queue, retry, reconnect, or logging behavior

#### Scenario: Decompression and field resource limits

- **WHEN** decompression would produce more than `MAX_DECODED_JSON_BYTES = 256KiB` or a decoded value violates a declarative field or array ceiling
- **THEN** the codec SHALL stop unsafe materialization or the static schema SHALL reject the declarative field/array violation before application; neither layer SHALL compute or validate canonical whole-value `ChatUser` or `ChatMessage` byte size

#### Scenario: Opaque message IDs remain aggregate-bounded

- **WHEN** a History Pull carries message IDs with any string content or individual length
- **THEN** the schema SHALL apply no per-ID regex, NanoID-length rule, or independent string ceiling, while the complete request frame SHALL still satisfy the encoded/decompressed frame limits and Runtime SHALL still enforce its total inventory budgets

#### Scenario: Redundant envelope fields

- **WHEN** any wire type is defined
- **THEN** its strict schema SHALL reject a frame carrying room, sender peerId, version, sentAt, receivedAt, or any other forbidden envelope/context field; `receivedAt` exists only as receiver-local metadata and no field SHALL be stripped or tolerated

#### Scenario: Invalid logical join time

- **WHEN** a SESSION omits `joinedAt`, adds an unknown key, or supplies a negative, fractional, non-finite, or unsafe integer value
- **THEN** the strict schema SHALL reject the complete frame before Session binding, membership mutation, or notice classification

#### Scenario: Invalid History page number

- **WHEN** a History page omits `page`, adds an unknown key, or supplies a negative, fractional, non-finite, or unsafe page value
- **THEN** the strict schema SHALL reject the complete frame before History attempt mutation, persistence, or feedback

### Requirement: HLC is strictly validated

Hybrid Logical Clock values on wire `ChatMessage` values SHALL be finite non-negative safe integers for both timestamp and counter. The public schema SHALL be static and SHALL receive no receiver time or clock input. A structurally valid event SHALL NOT be rejected solely because its HLC timestamp is in the future. The protocol SHALL define the canonical total-ordering and last-writer-wins rule as composite `(hlc, id)`; the comparison implementation belongs to the application/page Domain/model layer, or a shared Domain/model module when both pages and Runtime consume it.

#### Scenario: Future-poisoned event

- **WHEN** the public schema receives an event with a finite safe non-negative HLC timestamp more than 5 minutes ahead of the receiver's clock
- **THEN** it SHALL NOT reject the event solely for being future-dated and SHALL NOT receive or call a clock or later time predicate

#### Scenario: Same-clock different messages

- **WHEN** two messages share an HLC timestamp and counter but have different ids
- **THEN** they SHALL be ordered and deduplicated by `(hlc, id)`, never by HLC alone

### Requirement: World presence is a full peer snapshot

World presence wire data SHALL be exactly `WorldRoomMessage extends ChatSession {sites: ChatSite[]}`, where `ChatSession = {sessionId, user: ChatUser}` and `ChatSite = {origin, title?, icon?, description?}`. It SHALL have no payload `type`. The trusted World `roomId` SHALL select this strict parser. World and Chat SHALL use the same structures while maintaining separate session instances and room protocols. The public schema SHALL require a complete `sites` array and SHALL reject unknown or forbidden fields. Runtime registry aggregation, snapshot publication, source replacement, peer leave handling, and per-domain counting are specified by the `world-room-presence` capability. `host`, `hostname`, and `href` SHALL NOT appear on the wire.

#### Scenario: World snapshot wire shape

- **WHEN** a peer publishes World presence
- **THEN** the payload SHALL contain exactly `sessionId`, `user`, and `sites`, with each site limited to `origin` and optional `title`, `icon`, and `description`; the payload SHALL not contain a discriminator or page URL fields

### Requirement: Chat wire uses immutable typed messages

Chat wire SHALL be exactly `ChatRoomMessage = SessionMessage | ChatMessage | HistoryMessagesPull | HistoryMessagesPush`, where `ChatMessage = TextMessage | ReactionMessage`, `SessionMessage extends ChatSession {type:'session', presenceId:string, joinedAt:number}`, and `ChatSession = {sessionId, user:ChatUser}`. `joinedAt` SHALL be a required finite safe non-negative integer. `ChatUser` SHALL be exactly `{id,name,avatar}`. `MentionedUser extends ChatUser` and SHALL add exactly `ranges: [number, number][]`. Each pair denotes an inclusive `[start,end]` range in JavaScript string/UTF-16 code-unit indices. The schema SHALL validate only a two-item tuple of safe non-negative integers; it SHALL NOT compare `start` with `end` or either value with `body.length`. Text and reaction messages SHALL be immutable once created, and live fields SHALL use `userId`; Runtime session binding, logical-time use, physical-leave grace, and application are specified by `webrtc-runtime`.

#### Scenario: Chat union and text shape

- **WHEN** a peer sends a Chat message
- **THEN** the strict wire union SHALL accept only the exact frozen fields; SESSION SHALL require `presenceId` and `joinedAt`; each mention SHALL contain exactly `id`, `name`, `avatar`, and `ranges`; and each range SHALL be exactly two safe non-negative integers without a callback-backed order/body-length or whole-message byte check

#### Scenario: Session end is outside the Chat union

- **WHEN** a decoded Chat value uses `type:'session-end'`
- **THEN** the strict current union SHALL reject it before Runtime application and no compatibility decoder SHALL run

#### Scenario: Reaction is explicit state

- **WHEN** a peer sends a reaction message
- **THEN** it SHALL carry `userId` and `active: boolean` plus the documented target/reaction/HLC/id fields

### Requirement: Chat presence uses causal generation and final-end facts

Every `SessionMessage` SHALL carry a required opaque `presenceId` identifying one logical online generation independently of physical `sessionId` and transport `sourcePeerId`, plus required `joinedAt` identifying when that logical generation began. Session SHALL allocate and persist this finite safe non-negative integer with a new local generation and project that exact value to every SESSION. A reconnect, refresh, recovery, reattach, duplicate publication, additional physical session, or supported Runtime host replacement SHALL reuse the active generation's exact `{presenceId, joinedAt}`. Only an initial join or a return after the prior generation ended SHALL allocate a new generation and a later local logical time. `SessionEndMessage` SHALL carry exactly `type:'session-end'` and that generation's `presenceId`; its strict schema SHALL reject missing or unknown fields. No receiver observation/discovery time, `clock.now()` substitution, old SESSION decoder, optional-field fallback, alias, dual schema, or compatibility bridge SHALL exist.

The first accepted remote SESSION SHALL bind exact `user.id` and `joinedAt` to that source and `presenceId` and record the current `{name, avatar}` projection. A duplicate or replacement SESSION for the same accepted generation with the same `user.id` and `joinedAt` SHALL replace a changed `name` or `avatar` projection, while an equal projection SHALL be idempotent; neither case creates a logical lifecycle or chat/history event. A different `user.id` or `joinedAt` SHALL be rejected source-locally and SHALL not mutate the accepted binding, membership, history, or observer notices. Receiver observation time SHALL remain local metadata and SHALL not substitute for the remote logical time. For one committed local generation, a remote generation SHALL be eligible for an observer-local join only when its accepted `joinedAt` is strictly greater than the local generation's `joinedAt` and the remote user transitions from zero active logical generations to one. Equal or earlier remote time SHALL converge as historical snapshot state without a join notice even if discovery and SESSION both occur only after local commit. The sender-asserted time SHALL be used only for observer-local notice eligibility; it SHALL NOT authorize identity, routing, admission, persistence, or a globally trusted order under arbitrary clock skew.

A graceful final release SHALL first durably replace the private active lease with the same generation's unsettled final-end identity, then publish the end fact on the source-ordered Wire lane. Retirement persistence rejection SHALL send no end and preserve the active generation plus physical membership. The durable identity SHALL remain present throughout every unsettled first or retry send. Explicit end-send rejection SHALL durably mark that generation retryable; a same-host retry SHALL durably mark the same identity in flight again before resending the idempotent end. A same-user replacement that loads either unsettled marker SHALL continue that exact END transaction with the same `presenceId`; it SHALL NOT expose the generation as a successful active join or let it carry live messages. Successful send settlement SHALL durably replace the unsettled marker with private settled-cleanup ownership before removing the marker. A replacement that loads settled-cleanup ownership SHALL only retry marker removal and SHALL publish neither SESSION nor SESSION_END. Only successful marker removal may physically leave the Chat room. A failed transition or cleanup SHALL retain a safe durable identity and physical membership still owned by that host. Complete cleanup SHALL leave no persistent retry marker. Receivers SHALL apply duplicate SESSION and SESSION_END facts idempotently, reject SESSION after its accepted end, and classify logical joins/leaves from generation, logical join time, and end facts rather than debounce, transport loss, `sourcePeerId`, physical `sessionId`, discovery order, or receiver observation time. `ChatMessage`, history, and World shapes remain unchanged.

#### Scenario: Transport recovery reuses a generation

- **WHEN** one logical user loses and restores a physical transport, refreshes, reattaches, or replaces a supported Runtime host without a final generation end
- **THEN** every replacement SESSION SHALL carry the same `presenceId` and `joinedAt`, and receivers SHALL not classify a new logical join or leave

#### Scenario: Delayed historical session creates no join notice

- **GIVEN** local B committed after remote A logically joined, but both discovery and A's SESSION were delayed until after B commit
- **WHEN** B accepts A's SESSION whose `joinedAt` is less than or equal to B's local `joinedAt`
- **THEN** B SHALL converge A into membership without an A join notice, regardless of baseline peer discovery order

#### Scenario: Invalid session cannot acquire a receiver timestamp

- **WHEN** a v3 SESSION is missing valid `joinedAt` or changes the accepted `joinedAt` for its `presenceId`
- **THEN** the receiver SHALL reject the complete source-local frame, SHALL preserve prior accepted binding and membership, and SHALL not substitute observation time, discovery order, `baselinePeerIds`, or `clock.now()` for notice classification

#### Scenario: Later logical generation creates one join notice

- **GIVEN** a committed local generation and no active logical generation for a remote user
- **WHEN** a valid remote SESSION first binds a `presenceId` whose `joinedAt` is strictly later than the local generation
- **THEN** the receiver SHALL classify one observer-local join when that user transitions zero-to-one and SHALL classify no duplicate for repeated publication

#### Scenario: Same generation refreshes its user projection

- **WHEN** a source republishes an accepted `presenceId` with the same `user.id` and `joinedAt` but a changed `name` or `avatar`
- **THEN** the receiver SHALL accept the current projection idempotently without changing membership count or logical generation and without emitting a chat/history event or observer notice

#### Scenario: Same generation cannot change its identity binding

- **WHEN** a source republishes an accepted `presenceId` with a different `user.id` or `joinedAt`
- **THEN** the receiver SHALL reject that source-local SESSION without changing membership, notice state, or the original generation binding

#### Scenario: Final end is ordered and idempotent

- **WHEN** the last local owner gracefully releases a generation and each external stage succeeds
- **THEN** it SHALL durably retire the private active lease while retaining the generation identity, settle exactly the strict `SessionEndMessage`, durably record settled-cleanup ownership, remove that marker, then physically leave the room, and receivers SHALL classify at most one final logical leave even if the end fact is duplicated

#### Scenario: Final end is fenced by an external rejection

- **WHEN** private retirement persistence, an END-state transition, SESSION_END send, or post-settlement cleanup rejects
- **THEN** the peer SHALL NOT physically leave or publish a false local lifecycle end; retirement rejection SHALL retain the same active lease, while every later rejection SHALL retain a recoverable final-end identity for the already-retired generation

#### Scenario: Unsettled end survives host replacement

- **GIVEN** durable retirement succeeded and the first or retry SESSION_END is unsettled or explicitly rejected
- **WHEN** the Runtime host is replaced before END settlement
- **THEN** the replacement SHALL physically rebind the retained `presenceId` only to continue the same idempotent END transaction, SHALL expose no successful active join or live-message authority, and SHALL produce at most one observer leave while clearing every private final-end marker

#### Scenario: Settled cleanup survives host replacement

- **GIVEN** receivers accepted SESSION_END and the durable record contains settled-cleanup ownership because marker removal is incomplete
- **WHEN** the Runtime host is replaced
- **THEN** the replacement SHALL remove that marker without joining Chat or World, publishing SESSION or SESSION_END, reviving the ended generation, or changing the observer's exactly-once leave

#### Scenario: Later return uses a fresh generation

- **WHEN** the same user returns after its accepted final generation end
- **THEN** its SESSION SHALL use a different `presenceId` and a later local `joinedAt`, and receivers SHALL classify one fresh logical join when the strict later-than rule holds

### Requirement: History wire shapes are bounded and reference-complete

The public peer protocol SHALL define only this exact History wire contract: `HistoryMessagesPull = {type:'history-messages-pull', syncId, page, messageIds, done}` and `HistoryMessagesPush = {type:'history-messages-push', syncId, page, users, messages, done}`. One `syncId` SHALL identify the sole synchronization for one current room connection and one direction; the opposite direction SHALL use another `syncId`. Establishing that connection and joining the room SHALL be the only synchronization trigger. The first valid Pull page zero SHALL bind the sole incoming `syncId` for that source incarnation. While active, pages using that ID MAY progress or replay only as specified below. After either direction succeeds, is canceled, or fails, neither the same nor a different `syncId` SHALL start another synchronization on that connection. Source replacement or domain release SHALL end the binding; a later connection SHALL use a fresh ID for a new independent synchronization and SHALL NOT retry, resume, or carry progress from the prior one. Pull and Push `page` values SHALL each start at zero and advance continuously within their own phase. Pull `done` SHALL identify the final inventory page. Push `done` SHALL identify the final missing-record page.

Every Pull and Push page SHALL remain strictly below `MAX_WIRE_BYTES = 64KiB` after canonical encoding. Each Push SHALL carry at most 100 messages. The provider SHALL create its `users` array with exactly one `ChatUser` for every distinct `messages[].userId`, no duplicate or unrelated users, and no users when `messages` is empty. This remains a producer contract; the static schema and receiver SHALL NOT validate uniqueness or user/message reference completeness.

The schemas SHALL accept only the two replacement type strings and exact replacement keys. `HistoryCursor`, `HistoryRequestMessage`, `HistoryResponseMessage`, `history-request`, `history-response`, `before`, `requestId`, response `events`, `snapshotId`, `nextBefore`, acknowledgement variants, compatibility aliases, and old/new key pairs SHALL be absent. No dual-read, fallback, translator, capability negotiation, or compatibility path SHALL exist.

#### Scenario: Pull pagination

- **WHEN** two current peers synchronize one direction
- **THEN** the requester SHALL send continuous `history-messages-pull` inventory pages through one final `done: true` page, after which the provider SHALL send continuous `history-messages-push` missing-record pages through one final `done: true` page using the same `syncId`; no third peer message type or body request SHALL participate

#### Scenario: A current connection cannot synchronize twice in one direction

- **GIVEN** one source incarnation and direction has bound its sole `syncId`
- **WHEN** that synchronization completes, is canceled, or fails and any later page uses either the same or a different `syncId`
- **THEN** no new History synchronization SHALL start until source replacement or domain release ends that connection binding

#### Scenario: A later connection starts independently

- **WHEN** a source is replaced or released and a later connection joins the room
- **THEN** that connection SHALL use a fresh `syncId`, page zero, and current snapshots without any resumed page, cursor, retry count, or progress from the prior connection

#### Scenario: Empty inventory and empty difference are explicit

- **WHEN** the requester inventory is empty or the provider computes no missing records
- **THEN** the corresponding phase SHALL still send exactly one `page: 0, done: true` page with an empty `messageIds` array or empty `users` and `messages` arrays

#### Scenario: Complete history references

- **WHEN** the provider constructs a `history-messages-push` containing messages and users
- **THEN** it SHALL include exactly one matching user for each distinct message `userId`, no unrelated or duplicate users, and no users for an empty message page, while the receiver schema SHALL NOT enforce those cross-array relationships

#### Scenario: Unsupported History reference validation is absent

- **WHEN** an otherwise declaratively valid History Push contains a missing, duplicate, or unrelated user reference
- **THEN** schema parsing SHALL NOT reject it through a callback, Set, reference map, post-parse predicate, or caller-side fallback

#### Scenario: History response wire limits

- **WHEN** a History Push exceeds its declarative 100-message count rule or a History page is greater than or equal to `MAX_WIRE_BYTES = 64KiB` after canonical encoding
- **THEN** the static schema or codec SHALL reject the page before Runtime application, without prescribing retry, supplier, timeout, queue, or peer-state behavior

#### Scenario: Old and ambiguous history keys reject

- **WHEN** a History frame uses either old type, carries `before`, `requestId`, `events`, `snapshotId`, `nextBefore`, an acknowledgement type, both old and new keys, or any compatibility alias
- **THEN** the strict schema SHALL reject the complete frame, the Runtime SHALL project and persist nothing from it, no Toast SHALL publish, and no fallback SHALL run

### Requirement: No old-protocol compatibility

The peer protocol SHALL NOT bridge, translate, or interoperate with released v1, v2, v3, or v4 wire protocols. v1, v2, v3, v4, and v5 SHALL use isolated Chat and World room namespaces so none parses another generation's wire traffic or advertises an incompatible peer as currently reachable. The unchanged local record format requires no data migration or old-record compatibility path. Unmerged development residues MAY be cleaned up directly.

#### Scenario: v1/v2 cross-traffic

- **WHEN** v1, v2, v3, v4, and v5 clients meet in a shared physical environment
- **THEN** each generation SHALL use isolated Chat and World namespaces, none SHALL parse or advertise another generation's traffic, and no compatibility fallback SHALL exist

### Requirement: Current v5 peer wire is a clean generation cut

The current peer protocol SHALL use exact v5 Chat and World physical namespaces. Chat wire SHALL contain only `SessionMessage`, live `ChatMessage`, `HistoryMessagesPull`, and `HistoryMessagesPush`; `session-end` and obsolete History variants SHALL be unknown. World SHALL retain its strict current snapshot shape. Current clients SHALL join only v5 rooms and SHALL provide no v1-v4 decoder, optional alias, dual publication, room bridge, translator, or fallback.

#### Scenario: Current peers use v5 only

- **WHEN** a current client joins Chat and World
- **THEN** it SHALL select the exact v5 namespace inputs, exchange only strict v5 values, and SHALL not join or publish to v1, v2, v3, or v4 rooms

#### Scenario: Removed Chat lifecycle type stays outside v5

- **WHEN** a peer presents `type:'session-end'` or another removed Chat lifecycle value
- **THEN** the strict v5 Chat schema SHALL reject it as unknown, and no current client SHALL join an older room to interpret it

#### Scenario: History bytes use only the replacement shapes

- **WHEN** the same peer begins History synchronization under v5
- **THEN** it SHALL exchange only `history-messages-pull` and `history-messages-push` pages and SHALL emit no v3 `history-request`, `history-response`, `before`, or `HistoryCursor` value
