## ADDED Requirements

### Requirement: Current v3 peer wire is a clean generation cut

The current peer protocol SHALL use exact v3 Chat and World physical namespaces. It SHALL add required `joinedAt` only to `SessionMessage`; `SessionEndMessage`, `ChatMessage`, history, reaction, World payload, limits, and the codec algorithm SHALL remain otherwise unchanged from v2. Current clients SHALL join only v3 rooms and SHALL provide no v2 decoder, optional field, alias, dual publication, room bridge, translator, or fallback.

#### Scenario: Current peers use v3 only

- **WHEN** a current client joins Chat and World
- **THEN** it SHALL select the exact v3 namespace inputs, SHALL exchange only strict v3 messages, and SHALL not join or publish to v1 or v2 rooms

#### Scenario: World bytes remain stable inside the new room

- **WHEN** the same canonical World value is encoded by v2 and v3 implementations
- **THEN** its strict payload, canonical JSON, limits, and encoded bytes SHALL be identical, while only the selected physical namespace differs

#### Scenario: Session bytes include logical join time

- **WHEN** the same canonical SESSION is compared across v2 and v3
- **THEN** v3 SHALL require exactly one additional `joinedAt` key and its canonical bytes SHALL reflect that intentional change, while every non-SESSION Chat value remains otherwise unchanged

## MODIFIED Requirements

### Requirement: Public protocol module is pure and explicitly bounded

The code-level public module `src/protocol/index.ts` SHALL be the third-party-facing peer contract without introducing a package, publishing flow, or SDK. Its wire structures SHALL be exactly the Owner-frozen `ChatUser`, `ChatSession`, `HLC`, `MentionedUser`, `SessionMessage`, `SessionEndMessage`, `TextMessage`, `ReactionMessage`, `ChatMessage`, `HistoryCursor`, `HistoryRequestMessage`, `HistoryResponseMessage`, `ChatRoomMessage`, `ChatSite`, and `WorldRoomMessage` contracts. It SHALL additionally export only their strict schemas, pure parse/check/validation, public limits/constants, and the public codec surface (`WireCodec`, `NativeWireCodec` reference implementation, `WireCodecError`). It SHALL NOT add or rename any field/type, export a structural alias or compatibility DTO, or expose an optional/open metadata bag without explicit Owner intervention. Pure validation SHALL cover closed-union and unknown-key rejection, field/resource limits, mention `ranges`, user/message size, origin-only and uniqueness rules, history-response reference completeness, required SESSION `joinedAt`, and explicit-`now` HLC rules. The `NativeWireCodec` SHALL own only the fixed codec/security algorithm; the public protocol SHALL NOT export local persistence/UI models, projections, ordering implementations, Runtime lifecycle or page-host RPC contracts, WirePipeline queue/drop/apply/flush types, or application orchestration.

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

### Requirement: Wire messages are strict closed unions with limits

The public protocol SHALL define the closed schemas, pure limits, and malformed-input validation. `WireDomain` SHALL call those validators and may apply source-local operational policies, but queue/drop/apply/flush scheduling, rate-limited logging, reconnect behavior, and delivery admission are not public protocol semantics.

Chat wire messages SHALL form a strict, closed discriminated union keyed by `type`; World wire payloads SHALL use one strict schema selected by trusted v3 `roomId` and SHALL NOT carry a payload `type`. The public protocol SHALL export and enforce these fixed limits: `MAX_WIRE_BYTES = 64KiB` for final encoded frames, `MAX_DECODED_JSON_BYTES = 256KiB` for streaming decompressed JSON before parse, `MAX_CHAT_EVENT_BYTES = 48KiB` for one canonical message, `MAX_USER_BYTES = 8KiB` for one `ChatUser` JSON value, and at most 100 messages in one history response. Every string, array, nesting depth, and final encoded byte size SHALL have an explicit public limit. SESSION `joinedAt`, HLC timestamp, and HLC counter SHALL be finite safe non-negative integers. Unknown types, unknown keys, forbidden envelope/context fields, missing or invalid `joinedAt`, non-canonical or malformed Base64, limit violations, and malformed payloads SHALL produce a public validation failure for the complete frame; the Runtime decides how to drop or log that failure.

#### Scenario: Unknown or oversized message

- **WHEN** the public validator receives an unknown type or a message exceeding `MAX_WIRE_BYTES = 64KiB`
- **THEN** it SHALL reject the complete message before any Runtime application, without specifying queue, retry, reconnect, or logging behavior

#### Scenario: Decompression and field resource limits

- **WHEN** decompression would produce more than `MAX_DECODED_JSON_BYTES = 256KiB`, one `ChatUser` JSON value exceeds `MAX_USER_BYTES = 8KiB`, or one canonical `ChatMessage` exceeds `MAX_CHAT_EVENT_BYTES = 48KiB`
- **THEN** the public codec/validator SHALL reject the complete frame before application, without prescribing Runtime queue, retry, reconnect, or logging behavior

#### Scenario: Redundant envelope fields

- **WHEN** any wire type is defined
- **THEN** its strict schema SHALL reject a frame carrying room, sender peerId, version, sentAt, receivedAt, or any other forbidden envelope/context field; `receivedAt` exists only as receiver-local metadata and no field SHALL be stripped or tolerated

#### Scenario: Invalid logical join time

- **WHEN** a SESSION omits `joinedAt`, adds an unknown key, or supplies a negative, fractional, non-finite, or unsafe integer value
- **THEN** the strict schema SHALL reject the complete frame before Session binding, membership mutation, or notice classification

### Requirement: Chat wire uses immutable typed messages

Chat wire SHALL be exactly `ChatRoomMessage = SessionMessage | SessionEndMessage | ChatMessage | HistoryRequestMessage | HistoryResponseMessage`, where `ChatMessage = TextMessage | ReactionMessage`, `SessionMessage extends ChatSession {type:'session', presenceId:string, joinedAt:number}`, `SessionEndMessage = {type:'session-end', presenceId:string}`, and `ChatSession = {sessionId, user:ChatUser}`. `joinedAt` SHALL be a required finite safe non-negative integer. `ChatUser` SHALL be exactly `{id,name,avatar}`. `MentionedUser extends ChatUser` and SHALL add exactly `ranges: [number, number][]`. Each pair SHALL be an inclusive `[start,end]` range in JavaScript string/UTF-16 code-unit indices with non-negative integers and `start <= end < body.length`. Text and reaction messages SHALL be immutable once created, and live fields SHALL use `userId`; Runtime session binding, logical-time use, and application are specified by `webrtc-runtime`.

#### Scenario: Chat union and text shape

- **WHEN** a peer sends a Chat message
- **THEN** the strict wire union SHALL accept only the exact frozen fields; SESSION SHALL require `presenceId` and `joinedAt`; each mention SHALL contain exactly `id`, `name`, `avatar`, and `ranges`; each range SHALL be one inclusive valid `[start,end]` pair; and the canonical text message SHALL remain within `MAX_CHAT_EVENT_BYTES = 48KiB`

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

### Requirement: No old-protocol compatibility

The peer protocol SHALL NOT bridge, translate, or interoperate with released v1 or v2 wire protocols. v1, v2, and v3 SHALL use isolated Chat and World room namespaces so none parses another generation's wire traffic or advertises an incompatible peer as currently reachable. Local-data migration and old-record handling are application/page Domain concerns defined by the `webrtc-runtime` capability. Unmerged development residues MAY be cleaned up directly.

#### Scenario: v1/v2 cross-traffic

- **WHEN** v1, v2, and v3 clients meet in a shared physical environment
- **THEN** each generation SHALL use isolated Chat and World namespaces, none SHALL parse or advertise another generation's traffic, and no compatibility fallback SHALL exist

## REMOVED Requirements

### Requirement: Current v2 peer wire remains immutable during the Runtime architecture replacement

**Reason**: The Owner authorized required SESSION `joinedAt` and a clean Chat+World v3 namespace generation, so v2 immutability is no longer the current contract.

**Migration**: Current clients join only v3 Chat and World namespaces. No v2 decoder, dual room, translator, or compatibility path is retained.
