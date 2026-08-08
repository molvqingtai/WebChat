## ADDED Requirements

### Requirement: Current v4 peer wire is a clean generation cut

The current peer protocol SHALL use exact v4 Chat and World physical namespaces. Its `SessionMessage`, `SessionEndMessage`, `ChatMessage`, reaction, World payload, general limits, and codec algorithm SHALL remain unchanged from v3; only the History variants and History-specific limits SHALL change. Current clients SHALL join only v4 rooms and SHALL provide no v3 History decoder, optional alias, dual publication, room bridge, translator, or fallback.

#### Scenario: Current peers use v4 only

- **WHEN** a current client joins Chat and World
- **THEN** it SHALL select the exact v4 namespace inputs, exchange only strict v4 values, and SHALL not join or publish to v1, v2, or v3 rooms

#### Scenario: Non-History bytes remain stable

- **WHEN** the same canonical SESSION, SESSION_END, live Chat, or World value is encoded by v3 and v4 implementations
- **THEN** its strict payload, canonical JSON, limits, and encoded bytes SHALL be identical, while only the selected physical namespace differs

#### Scenario: History bytes use only the replacement shapes

- **WHEN** the same peer begins History synchronization under v4
- **THEN** it SHALL exchange only `history-messages-pull` and `history-messages-push` pages and SHALL emit no v3 `history-request`, `history-response`, `before`, or `HistoryCursor` value

## MODIFIED Requirements

### Requirement: Public protocol module is pure and explicitly bounded

The code-level public module `src/protocol/index.ts` SHALL be the third-party-facing peer contract without introducing a package, publishing flow, or SDK. Its wire structures SHALL be exactly the Owner-frozen `ChatUser`, `ChatSession`, `HLC`, `MentionedUser`, `SessionMessage`, `SessionEndMessage`, `TextMessage`, `ReactionMessage`, `ChatMessage`, `HistoryMessagesRequest`, `HistoryMessagesResponse`, `ChatRoomMessage`, `ChatSite`, and `WorldRoomMessage` contracts. It SHALL additionally export only their strict schemas, pure parse/check/validation, public limits/constants, and the public codec surface (`WireCodec`, `NativeWireCodec` reference implementation, `WireCodecError`). It SHALL NOT add or rename any field/type, export a structural alias or compatibility DTO, or expose an optional/open metadata bag without explicit Owner intervention. Pure validation SHALL cover closed-union and unknown-key rejection, field/resource limits, mention `ranges`, user/message size, origin-only and uniqueness rules, History response reference completeness, required SESSION `joinedAt`, and explicit-`now` HLC rules. The `NativeWireCodec` SHALL own only the fixed codec/security algorithm; the public protocol SHALL NOT export local persistence/UI models, projections, ordering implementations, Runtime lifecycle or page-host RPC contracts, WirePipeline queue/drop/apply/flush types, or application orchestration.

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
interface HistoryMessagesRequest {
  type: 'history-messages-pull'
  syncId: string
  page: number
  messageIds: string[]
  done: boolean
}
interface HistoryMessagesResponse {
  type: 'history-messages-push'
  syncId: string
  page: number
  users: ChatUser[]
  messages: ChatMessage[]
  done: boolean
}
type ChatRoomMessage =
  | SessionMessage
  | SessionEndMessage
  | ChatMessage
  | HistoryMessagesRequest
  | HistoryMessagesResponse
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

The public protocol SHALL define the closed schemas, pure limits, and malformed-input validation. `WireDomain` SHALL call those validators and MAY apply source-local operational policies, but queue/drop/apply/flush scheduling, rate-limited logging, reconnect behavior, page sequencing, attempt budgets, and delivery admission are not public protocol semantics.

Chat wire messages SHALL form a strict, closed discriminated union keyed by `type`; World wire payloads SHALL use one strict schema selected by trusted v4 `roomId` and SHALL NOT carry a payload `type`. The public protocol SHALL export and enforce these fixed limits: `MAX_WIRE_BYTES = 64KiB` for final encoded frames, `MAX_DECODED_JSON_BYTES = 256KiB` for streaming decompressed JSON before parse, `MAX_CHAT_EVENT_BYTES = 48KiB` for one canonical message, `MAX_USER_BYTES = 8KiB` for one `ChatUser` JSON value, and at most 100 messages in one History response page. Every string, array, nesting depth, and final encoded byte size SHALL have an explicit public limit except that each `messageIds[]` element remains an opaque string with no standalone length or format rule and is bounded only by the containing frame and Runtime attempt budgets. SESSION `joinedAt`, HLC timestamp, HLC counter, and History `page` SHALL be finite safe non-negative integers. Unknown types, unknown keys, forbidden envelope/context fields, missing or invalid required values, non-canonical or malformed Base64, limit violations, and malformed payloads SHALL produce a public validation failure for the complete frame; the Runtime decides how to drop or log that failure.

#### Scenario: Unknown or oversized message

- **WHEN** the public validator receives an unknown type or a message exceeding `MAX_WIRE_BYTES = 64KiB`
- **THEN** it SHALL reject the complete message before any Runtime application, without specifying queue, retry, reconnect, or logging behavior

#### Scenario: Decompression and field resource limits

- **WHEN** decompression would produce more than `MAX_DECODED_JSON_BYTES = 256KiB`, one `ChatUser` JSON value exceeds `MAX_USER_BYTES = 8KiB`, or one canonical `ChatMessage` exceeds `MAX_CHAT_EVENT_BYTES = 48KiB`
- **THEN** the public codec/validator SHALL reject the complete frame before application, without prescribing Runtime queue, retry, reconnect, or logging behavior

#### Scenario: Opaque message IDs remain aggregate-bounded

- **WHEN** a History request carries message IDs with any string content or individual length
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

Hybrid Logical Clock values on wire `ChatMessage` values SHALL be finite non-negative safe integers for both timestamp and counter. The public validator SHALL receive the receiver's current time as an explicit `now` argument; it SHALL NOT call `Date.now()` or any hidden clock. An event whose HLC timestamp exceeds `now` by more than 5 minutes SHALL produce a validation failure. The protocol SHALL define the canonical total-ordering and last-writer-wins rule as composite `(hlc, id)`; the comparison implementation belongs to the application/page Domain/model layer, or a shared Domain/model module when both pages and Runtime consume it.

#### Scenario: Future-poisoned event

- **WHEN** the public validator receives an event with an HLC timestamp more than 5 minutes in the future and an explicit `now`
- **THEN** it SHALL return a validation failure without calling a hidden clock or mutating the caller's clock state

#### Scenario: Same-clock different messages

- **WHEN** two messages share an HLC timestamp and counter but have different ids
- **THEN** they SHALL be ordered and deduplicated by `(hlc, id)`, never by HLC alone

### Requirement: Chat wire uses immutable typed messages

Chat wire SHALL be exactly `ChatRoomMessage = SessionMessage | SessionEndMessage | ChatMessage | HistoryMessagesRequest | HistoryMessagesResponse`, where `ChatMessage = TextMessage | ReactionMessage`, `SessionMessage extends ChatSession {type:'session', presenceId:string, joinedAt:number}`, `SessionEndMessage = {type:'session-end', presenceId:string}`, and `ChatSession = {sessionId, user:ChatUser}`. `joinedAt` SHALL be a required finite safe non-negative integer. `ChatUser` SHALL be exactly `{id,name,avatar}`. `MentionedUser extends ChatUser` and SHALL add exactly `ranges: [number, number][]`. Each pair SHALL be an inclusive `[start,end]` range in JavaScript string/UTF-16 code-unit indices with non-negative integers and `start <= end < body.length`. Text and reaction messages SHALL be immutable once created, and live fields SHALL use `userId`; Runtime session binding, logical-time use, and application are specified by `webrtc-runtime`.

#### Scenario: Chat union and text shape

- **WHEN** a peer sends a Chat message
- **THEN** the strict wire union SHALL accept only the exact frozen fields; SESSION SHALL require `presenceId` and `joinedAt`; each mention SHALL contain exactly `id`, `name`, `avatar`, and `ranges`; each range SHALL be one inclusive valid `[start,end]` pair; and the canonical text message SHALL remain within `MAX_CHAT_EVENT_BYTES = 48KiB`

#### Scenario: Reaction is explicit state

- **WHEN** a peer sends a reaction message
- **THEN** it SHALL carry `userId` and `active: boolean` plus the documented target/reaction/HLC/id fields

### Requirement: History wire shapes are bounded and reference-complete

The public peer protocol SHALL define only this exact History wire contract: `HistoryMessagesRequest = {type:'history-messages-pull', syncId, page, messageIds, done}` and `HistoryMessagesResponse = {type:'history-messages-push', syncId, page, users, messages, done}`. One `syncId` SHALL identify the sole synchronization for one current room connection and one direction; the opposite direction SHALL use another `syncId`. Establishing that connection and joining the room SHALL be the only synchronization trigger. The first valid request page zero SHALL bind the sole incoming `syncId` for that source incarnation. While active, pages using that ID MAY progress or replay only as specified below. After either direction succeeds, is canceled, or fails, neither the same nor a different `syncId` SHALL start another synchronization on that connection. Source replacement or domain release SHALL end the binding; a later connection SHALL use a fresh ID for a new independent synchronization and SHALL NOT retry, resume, or carry progress from the prior one. Request and response `page` values SHALL each start at zero and advance continuously within their own phase. Request `done` SHALL identify the final inventory page. Response `done` SHALL identify the final missing-record page.

Every request and response page SHALL remain strictly below `MAX_WIRE_BYTES = 64KiB` after canonical encoding. Each response SHALL carry at most 100 messages. Its `users` array SHALL contain exactly one `ChatUser` for every distinct `messages[].userId`, no duplicate or unrelated users, and no users when `messages` is empty. Every message `userId` SHALL therefore resolve to exactly one matching `users[].id`.

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

- **WHEN** a `history-messages-push` contains messages and users
- **THEN** every distinct message `userId` SHALL have exactly one matching user entry, duplicate or unrelated user ids SHALL reject the response as a whole, and an empty message page SHALL require an empty user array

#### Scenario: History response wire limits

- **WHEN** a History page exceeds its count rule or is greater than or equal to `MAX_WIRE_BYTES = 64KiB` after canonical encoding
- **THEN** the public codec/validator SHALL reject the page before Runtime application, without prescribing retry, supplier, timeout, queue, or peer-state behavior

#### Scenario: Old and ambiguous history keys reject

- **WHEN** a History frame uses either old type, carries `before`, `requestId`, `events`, `snapshotId`, `nextBefore`, an acknowledgement type, both old and new keys, or any compatibility alias
- **THEN** the strict schema SHALL reject the complete frame, the Runtime SHALL project and persist nothing from it, no Toast SHALL publish, and no fallback SHALL run

### Requirement: No old-protocol compatibility

The peer protocol SHALL NOT bridge, translate, or interoperate with released v1, v2, or v3 wire protocols. v1, v2, v3, and v4 SHALL use isolated Chat and World room namespaces so none parses another generation's wire traffic or advertises an incompatible peer as currently reachable. The unchanged local record format requires no data migration or old-record compatibility path. Unmerged development residues MAY be cleaned up directly.

#### Scenario: v1/v2 cross-traffic

- **WHEN** v1, v2, v3, and v4 clients meet in a shared physical environment
- **THEN** each generation SHALL use isolated Chat and World namespaces, none SHALL parse or advertise another generation's traffic, and no compatibility fallback SHALL exist

## REMOVED Requirements

### Requirement: Current v3 peer wire is a clean generation cut

**Reason**: The exact-ID History replacement is an intentional breaking peer-wire change and v3 must not share rooms with v4.

**Migration**: Current clients join only v4 Chat and World namespaces and use only the new History variants; no runtime compatibility or data migration path exists.
