# peer-wire-protocol Specification

## Purpose

TBD - created by archiving change refactor-to-shared-webrtc-runtime. Update Purpose after archive.

## Requirements

### Requirement: Public protocol module is pure and explicitly bounded

The code-level public module `src/protocol/index.ts` SHALL be the third-party-facing peer contract without introducing a package, publishing flow, or SDK. Its wire structures SHALL be exactly the Owner-frozen `ChatUser`, `ChatSession`, `HLC`, `MentionedUser`, `SessionMessage`, `SessionEndMessage`, `TextMessage`, `ReactionMessage`, `ChatMessage`, `HistoryCursor`, `HistoryRequestMessage`, `HistoryResponseMessage`, `ChatRoomMessage`, `ChatSite`, and `WorldRoomMessage` contracts. It SHALL additionally export only their strict schemas, pure parse/check/validation, public limits/constants, and the public codec surface (`WireCodec`, `NativeWireCodec` reference implementation, `WireCodecError`). It SHALL NOT add or rename any field/type, export a structural alias or compatibility DTO, or expose an optional/open metadata bag without explicit Owner intervention. Pure validation SHALL cover closed-union and unknown-key rejection, field/resource limits, mention `ranges`, user/message size, origin-only and uniqueness rules, history-response reference completeness, and explicit-`now` HLC rules. The `NativeWireCodec` SHALL own only the fixed codec/security algorithm; the public protocol SHALL NOT export local persistence/UI models, projections, ordering implementations, Runtime lifecycle or page-host RPC contracts, WirePipeline queue/drop/apply/flush types, or application orchestration.

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
}
interface SessionEndMessage {
  type: 'session-end'
  presenceId: string
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
interface HistoryCursor {
  hlc: HLC
  id: string
}
interface HistoryRequestMessage {
  type: 'history-request'
  syncId: string
  before?: HistoryCursor
}
interface HistoryResponseMessage {
  type: 'history-response'
  syncId: string
  users: ChatUser[]
  messages: ChatMessage[]
  done: boolean
}
type ChatRoomMessage = SessionMessage | SessionEndMessage | ChatMessage | HistoryRequestMessage | HistoryResponseMessage
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
- **THEN** it SHALL see only the documented peer wire types, schemas, validators, `WireCodec` interface, `NativeWireCodec` reference implementation, `WireCodecError`, and protocol constants; `LocalRecord`, UI models, projections, Runtime RPC, queue/drop types, and internal Runtime symbols SHALL not be reachable

#### Scenario: Public protocol dependency direction

- **WHEN** the protocol dependency graph is inspected
- **THEN** every protocol dependency SHALL remain cross-target compatible, and no reverse import from protocol into Runtime, Domain, storage, service, app, UI, comctx, browser-extension APIs/globals, DOM/window/document, host lifecycle APIs, or app configuration SHALL exist; standard Web codec APIs used by `NativeWireCodec` are allowed

### Requirement: Current v2 peer wire remains immutable during the Runtime architecture replacement

Except for the Owner-authorized logical-presence exception below, the Remesh DDD + CQRS Runtime replacement SHALL NOT change the current v2 peer message types, field names, strict schemas, parser behavior, room namespaces, limits, codec algorithm, reference codec exports, canonical JSON, or encoded golden bytes from baseline `9c90bb0...`. The exception adds required opaque `presenceId` to `SessionMessage` and the strict `SessionEndMessage`; it changes no `ChatMessage`, history, World, room namespace, limit, or codec algorithm. The internal page-to-Runtime comctx control contract and Runtime Domain CQRS surface MAY change cleanly because neither is peer wire, but those changes SHALL NOT add a peer field, alias, envelope, fallback, compatibility path, or different canonical encoding. Protected-input and golden-byte checks SHALL bind this immutability to the exact baseline files and fixtures.

#### Scenario: Internal CQRS refactor preserves peer bytes

- **WHEN** the same canonical Chat and World values are encoded before and after the Runtime architecture replacement
- **THEN** their schemas, validation result, canonical JSON, room selection, and final encoded bytes SHALL be identical to baseline `9c90bb0...`

#### Scenario: comctx is not peer protocol

- **WHEN** internal page-host Commands, Events, snapshots, or subscription contracts change to express the new Domain graph
- **THEN** no corresponding peer-wire field, message type, schema branch, codec change, alias, or version bridge SHALL be introduced

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

The public protocol SHALL define the closed schemas, pure limits, and malformed-input validation. `WireDomain` SHALL call those validators and may apply source-local operational policies, but queue/drop/apply/flush scheduling, rate-limited logging, reconnect behavior, and delivery admission are not public protocol semantics.

Chat wire messages SHALL form a strict, closed discriminated union keyed by `type`; World wire payloads SHALL use one strict schema selected by trusted v2 `roomId` and SHALL NOT carry a payload `type`. The public protocol SHALL export and enforce these fixed limits: `MAX_WIRE_BYTES = 64KiB` for final encoded frames, `MAX_DECODED_JSON_BYTES = 256KiB` for streaming decompressed JSON before parse, `MAX_CHAT_EVENT_BYTES = 48KiB` for one canonical message, `MAX_USER_BYTES = 8KiB` for one `ChatUser` JSON value, and at most 100 messages in one history response. Every string, array, nesting depth, and final encoded byte size SHALL have an explicit public limit. Unknown types, unknown keys, forbidden envelope/context fields, non-canonical or malformed Base64, limit violations, and malformed payloads SHALL produce a public validation failure for the complete frame; the Runtime decides how to drop or log that failure.

#### Scenario: Unknown or oversized message

- **WHEN** the public validator receives an unknown type or a message exceeding `MAX_WIRE_BYTES = 64KiB`
- **THEN** it SHALL reject the complete message before any Runtime application, without specifying queue, retry, reconnect, or logging behavior

#### Scenario: Decompression and field resource limits

- **WHEN** decompression would produce more than `MAX_DECODED_JSON_BYTES = 256KiB`, one `ChatUser` JSON value exceeds `MAX_USER_BYTES = 8KiB`, or one canonical `ChatMessage` exceeds `MAX_CHAT_EVENT_BYTES = 48KiB`
- **THEN** the public codec/validator SHALL reject the complete frame before application, without prescribing Runtime queue, retry, reconnect, or logging behavior

#### Scenario: Redundant envelope fields

- **WHEN** any wire type is defined
- **THEN** its strict schema SHALL reject a frame carrying room, sender peerId, version, sentAt, receivedAt, or any other forbidden envelope/context field; `receivedAt` exists only as receiver-local metadata and no field SHALL be stripped or tolerated

### Requirement: HLC is strictly validated

Hybrid Logical Clock values on wire `ChatMessage` values SHALL be finite non-negative safe integers for both timestamp and counter. The public validator SHALL receive the receiver's current time as an explicit `now` argument; it SHALL NOT call `Date.now()` or any hidden clock. An event whose HLC timestamp exceeds `now` by more than 5 minutes SHALL produce a validation failure. The protocol SHALL define the canonical total-ordering, cursor, and last-writer-wins rule as composite `(hlc, id)`; the comparison implementation belongs to the application/page Domain/model layer, or a shared Domain/model module when both pages and Runtime consume it.

#### Scenario: Future-poisoned event

- **WHEN** the public validator receives an event with an HLC timestamp more than 5 minutes in the future and an explicit `now`
- **THEN** it SHALL return a validation failure without calling a hidden clock or mutating the caller's clock state

#### Scenario: Same-clock different messages

- **WHEN** two messages share an HLC timestamp and counter but have different ids
- **THEN** they SHALL be ordered and deduplicated by `(hlc, id)`, never by HLC alone

### Requirement: World presence is a full peer snapshot

World presence wire data SHALL be exactly `WorldRoomMessage extends ChatSession {sites: ChatSite[]}`, where `ChatSession = {sessionId, user: ChatUser}` and `ChatSite = {origin, title?, icon?, description?}`. It SHALL have no payload `type`. The trusted World `roomId` SHALL select this strict parser. World and Chat SHALL use the same structures while maintaining separate session instances and room protocols. The public schema SHALL require a complete `sites` array and SHALL reject unknown or forbidden fields. Runtime registry aggregation, snapshot publication, source replacement, peer leave handling, and per-domain counting are specified by the `world-room-presence` capability. `host`, `hostname`, and `href` SHALL NOT appear on the wire.

#### Scenario: World snapshot wire shape

- **WHEN** a peer publishes World presence
- **THEN** the payload SHALL contain exactly `sessionId`, `user`, and `sites`, with each site limited to `origin` and optional `title`, `icon`, and `description`; the payload SHALL not contain a discriminator or page URL fields

### Requirement: Chat wire uses immutable typed messages

Chat wire SHALL be exactly `ChatRoomMessage = SessionMessage | SessionEndMessage | ChatMessage | HistoryRequestMessage | HistoryResponseMessage`, where `ChatMessage = TextMessage | ReactionMessage`, `SessionMessage extends ChatSession {type:'session', presenceId:string}`, `SessionEndMessage = {type:'session-end', presenceId:string}`, and `ChatSession = {sessionId, user:ChatUser}`. `ChatUser` SHALL be exactly `{id,name,avatar}`. `MentionedUser extends ChatUser` and SHALL add exactly `ranges: [number, number][]`. Each pair SHALL be an inclusive `[start,end]` range in JavaScript string/UTF-16 code-unit indices with non-negative integers and `start <= end < body.length`. Text and reaction messages SHALL be immutable once created, and live fields SHALL use `userId`; Runtime session binding and application are specified by `webrtc-runtime`.

#### Scenario: Chat union and text shape

- **WHEN** a peer sends a Chat message
- **THEN** the strict wire union SHALL accept only the exact frozen fields; each mention SHALL contain exactly `id`, `name`, `avatar`, and `ranges`, each range SHALL be one inclusive valid `[start,end]` pair, and the canonical text message SHALL remain within `MAX_CHAT_EVENT_BYTES = 48KiB`

#### Scenario: Reaction is explicit state

- **WHEN** a peer sends a reaction message
- **THEN** it SHALL carry `userId` and `active: boolean` plus the documented target/reaction/HLC/id fields

### Requirement: Chat presence uses causal generation and final-end facts

Every `SessionMessage` SHALL carry a required opaque `presenceId` identifying one logical online generation independently of physical `sessionId` and transport `sourcePeerId`. A reconnect, refresh, recovery, reattach, duplicate publication, additional physical session, or supported Runtime host replacement SHALL reuse the active generation. Only an initial join or a return after the prior generation ended SHALL allocate a new generation. `SessionEndMessage` SHALL carry exactly `type:'session-end'` and that generation's `presenceId`; its strict schema SHALL reject missing or unknown fields. No old SESSION decoder, optional-field fallback, alias, dual schema, or compatibility bridge SHALL exist.

A graceful final release SHALL first durably replace the private active lease with the same generation's unsettled final-end identity, then publish the end fact on the source-ordered Wire lane. Retirement persistence rejection SHALL send no end and preserve the active generation plus physical membership. The durable identity SHALL remain present throughout every unsettled first or retry send. Explicit end-send rejection SHALL durably mark that generation retryable; a same-host retry SHALL durably mark the same identity in flight again before resending the idempotent end. A same-user replacement that loads either unsettled marker SHALL continue that exact END transaction with the same `presenceId`; it SHALL NOT expose the generation as a successful active join or let it carry live messages. Successful send settlement SHALL durably replace the unsettled marker with private settled-cleanup ownership before removing the marker. A replacement that loads settled-cleanup ownership SHALL only retry marker removal and SHALL publish neither SESSION nor SESSION_END. Only successful marker removal may physically leave the Chat room. A failed transition or cleanup SHALL retain a safe durable identity and physical membership still owned by that host. Complete cleanup SHALL leave no persistent retry marker. Receivers SHALL apply duplicate SESSION and SESSION_END facts idempotently, reject SESSION after its accepted end, and classify logical joins/leaves from generation/end facts rather than wall clocks, debounce, transport loss, `sourcePeerId`, or physical `sessionId` conventions. `ChatMessage`, history, and World shapes remain unchanged.

#### Scenario: Transport recovery reuses a generation

- **WHEN** one logical user loses and restores a physical transport, refreshes, reattaches, or replaces a supported Runtime host without a final generation end
- **THEN** every replacement SESSION SHALL carry the same `presenceId`, and receivers SHALL not classify a new logical join or leave

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
- **THEN** its SESSION SHALL use a different `presenceId` and receivers SHALL classify one fresh logical join

### Requirement: History wire shapes are bounded and reference-complete

The public peer protocol SHALL define only this exact history wire contract: `HistoryRequestMessage = {type:'history-request', syncId, before?: {hlc,id}}` and `HistoryResponseMessage = {type:'history-response', syncId, users:ChatUser[], messages:ChatMessage[], done}`. One `syncId` SHALL identify one complete paginated synchronization and remain stable while `before` advances. `before/messages/done` SHALL express cursor and completion semantics; the public protocol SHALL not prescribe local candidate windows, provider selection, timeout ownership, page cancellation, store effects, or Runtime queue scheduling. Each response SHALL carry at most 100 messages and remain strictly below `MAX_WIRE_BYTES = 64KiB` final encoded bytes. Every `message.userId` in a response SHALL resolve to exactly one matching `users[].id`; duplicate user ids SHALL be rejected, while additional users MAY be present.

The current serialized `requestId` and history-response `events` keys SHALL be replaced by `syncId` and `messages` in one intentional breaking clean cutover. The existing mention `positions` key SHALL likewise be replaced by `ranges`. New schemas SHALL accept only `syncId`, `messages`, and `ranges`; any old key, old/new pair, alias, or unknown key SHALL reject the entire frame before projection or store writes. No dual-read, fallback, migration, or compatibility alias SHALL exist. Mixed-development-version peers therefore cannot exchange history request/response frames; Chat session/text/reaction and World parsing remain independently determined by their own strict schemas. The fixed `NativeWireCodec` envelope algorithm does not change, but canonical history JSON and encoded bytes do.

#### Scenario: Pull pagination

- **WHEN** two current peers exchange history
- **THEN** a peer MAY issue `history-request {syncId, before?}`, receive a flat byte-bounded `history-response`, and issue the next request using the same `syncId` plus the previous response's oldest `(hlc, id)` cursor; `done` SHALL state whether the provider has no more candidates for that sync

#### Scenario: Complete history references

- **WHEN** a `history-response` contains messages and users
- **THEN** every message `userId` SHALL have exactly one matching user entry, duplicate user ids SHALL cause the response to be rejected as a whole, and additional users SHALL remain accepted

#### Scenario: History response wire limits

- **WHEN** a `history-response` exceeds 100 messages or is greater than or equal to `MAX_WIRE_BYTES = 64KiB` after canonical encoding
- **THEN** the public codec/validator SHALL reject the response before Runtime application, without prescribing any retry, supplier, timeout, or queue behavior

#### Scenario: Old and ambiguous history keys reject

- **WHEN** a history frame contains `requestId`, contains both `requestId` and `syncId`, uses `events`, contains both `events` and `messages`, omits a required new key, or contains any compatibility alias; or a text mention uses `positions` or both mention keys
- **THEN** the strict schema SHALL reject the complete frame, the Runtime SHALL project and persist nothing from it, and no fallback SHALL run

### Requirement: No old-protocol compatibility

The peer protocol SHALL NOT bridge, translate, or interoperate with the released v1 wire protocol. v1 and v2 SHALL use isolated room namespaces so neither parses the other's wire traffic. Local-data migration and old-record handling are application/page Domain concerns defined by the `webrtc-runtime` capability. Unmerged development residues MAY be cleaned up directly.

#### Scenario: v1/v2 cross-traffic

- **WHEN** a v1 client and a v2 client meet in a shared physical environment
- **THEN** they SHALL use isolated room namespaces such that neither parses the other's protocol, and no compatibility fallback SHALL exist
