## MODIFIED Requirements

### Requirement: Wire messages are strict closed unions with limits

The public protocol SHALL define authoritative closed declarative schemas and pure limits. At peer receive, `WireDomain` SHALL select and parse exactly one static complete schema using trusted transport context and MAY apply source-local operational policies after rejection, but it SHALL NOT compose a separate validator. Queue/drop/apply/flush scheduling, rate-limited diagnostics, reconnect behavior, page sequencing, attempt budgets, and delivery admission are not public protocol semantics.

Chat wire messages SHALL form a strict, closed discriminated union keyed by `type`; World wire payloads SHALL use one strict schema selected by trusted v5 `roomId` and SHALL NOT carry a payload `type`. The codec SHALL enforce `MAX_WIRE_BYTES = 256KiB` for final encoded frames and `MAX_DECODED_JSON_BYTES = 1MiB` for streaming decompressed JSON before parse. `MAX_CHAT_EVENT_BYTES = 192KiB` SHALL remain the authored-message limit consumed by its existing preflight and declarative Text body ceiling. Declarative schemas SHALL enforce explicit built-in field and array ceilings, including at most 100 messages in one History Push page. Each `messageIds[]` element SHALL remain an opaque string with no standalone length or format rule and SHALL be bounded only by the containing codec frame. SESSION `joinedAt`, HLC timestamp, HLC counter, and History `page` SHALL be finite safe non-negative integers. Unknown types including `session-end`, unknown keys, forbidden envelope/context fields, missing or invalid required values, and declaratively expressible limit violations SHALL fail the complete schema parse. Whole-value `ChatUser`, `ChatMessage`, and History page canonical byte sizes SHALL not be computed or validated. Malformed/non-canonical Base64, invalid UTF-8/JSON/deflate, and encoded/decompressed frame bounds SHALL remain codec representation failures before message schema parsing.

#### Scenario: Unknown or oversized message

- **WHEN** a decoded value has an unknown type or violates a declarative field or array limit at peer receive or local persistence load
- **THEN** the complete schema parse SHALL fail before any Runtime application, without a second validator or partial output

#### Scenario: Session end has no compatibility path

- **WHEN** a decoded Chat value carries `type:'session-end'` in a current v5 room
- **THEN** the complete Chat schema SHALL reject it as an unknown type, and no end handler, projection, notice, fallback, or compatibility branch SHALL run

#### Scenario: Decompression and field resource limits

- **WHEN** a frame exceeds an encoded/decompressed codec bound or a decoded value exceeds a declarative field or array ceiling
- **THEN** the codec SHALL stop unsafe frame materialization or the static schema SHALL reject the declarative field/array violation; neither layer SHALL compute or validate canonical whole-value `ChatUser` or `ChatMessage` byte size

#### Scenario: Opaque message IDs remain frame-bounded

- **WHEN** a History Pull carries message IDs with any string content or individual length
- **THEN** the schema SHALL apply no per-ID regex, NanoID-length rule, or independent string ceiling, while every complete request frame SHALL still satisfy the encoded/decompressed frame limits

#### Scenario: Redundant envelope fields

- **WHEN** any wire type is defined
- **THEN** its strict schema SHALL reject a frame carrying room, sender peerId, version, sentAt, receivedAt, or any other forbidden envelope/context field; `receivedAt` exists only as receiver-local metadata and no field SHALL be stripped or tolerated

#### Scenario: Invalid logical join time

- **WHEN** a SESSION omits `joinedAt`, adds an unknown key, or supplies a negative, fractional, non-finite, or unsafe integer value
- **THEN** the strict schema SHALL reject the complete frame before Session binding, membership mutation, or notice classification

#### Scenario: Invalid History page number

- **WHEN** a History page omits `page`, adds an unknown key, or supplies a negative, fractional, non-finite, or unsafe page value
- **THEN** the strict schema SHALL reject the complete frame before History attempt mutation, persistence, or feedback

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

Every Pull and Push page SHALL remain strictly below `MAX_WIRE_BYTES = 256KiB` after canonical encoding. Each Push SHALL carry at most 100 messages. The provider SHALL create its `users` array with exactly one `ChatUser` for every distinct `messages[].userId`, no duplicate or unrelated users, and no users when `messages` is empty. This remains a producer contract; the static schema and receiver SHALL NOT validate uniqueness or user/message reference completeness.

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

- **WHEN** a History Push exceeds its declarative 100-message count rule or a History page is greater than or equal to `MAX_WIRE_BYTES = 256KiB` after canonical encoding
- **THEN** the static schema or codec SHALL reject the page before Runtime application, without prescribing retry, supplier, timeout, queue, or peer-state behavior

#### Scenario: Old and ambiguous history keys reject

- **WHEN** a History frame uses either old type, carries `before`, `requestId`, `events`, `snapshotId`, `nextBefore`, an acknowledgement type, both old and new keys, or any compatibility alias
- **THEN** the strict schema SHALL reject the complete frame, the Runtime SHALL project and persist nothing from it, no Toast SHALL publish, and no fallback SHALL run
