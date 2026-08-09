## ADDED Requirements

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Current v3 peer wire is a clean generation cut

**Reason**: The current exact-ID History and physical-leave presence contract are an intentional clean peer generation and v3 must not share current rooms.

**Migration**: Current clients join only v5 Chat and World namespaces, use only Pull/Push History variants, and carry no Chat end variant; no runtime compatibility or data migration path exists.
