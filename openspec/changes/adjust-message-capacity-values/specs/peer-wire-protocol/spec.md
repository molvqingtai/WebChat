## MODIFIED Requirements

### Requirement: Wire messages are strict closed unions with limits

The public protocol SHALL define the closed schemas, pure limits, and malformed-input validation. `WireDomain` SHALL call those validators and may apply source-local operational policies, but queue/drop/apply/flush scheduling, rate-limited logging, reconnect behavior, and delivery admission are not public protocol semantics.

Chat wire messages SHALL form a strict, closed discriminated union keyed by `type`; World wire payloads SHALL use one strict schema selected by trusted v3 `roomId` and SHALL NOT carry a payload `type`. The public protocol SHALL export and enforce these fixed limits: `MAX_WIRE_BYTES = 256KiB` for final encoded frames, `MAX_DECODED_JSON_BYTES = 1MiB` for streaming decompressed JSON before parse, `MAX_CHAT_EVENT_BYTES = 192KiB` at its owning consumers and enforcement points, `MAX_USER_BYTES = 8KiB` for one `ChatUser` JSON value, and at most 100 messages in one history response. The authored-message UTF-8 JSON preflight and declarative Text body ceiling SHALL consume `MAX_CHAT_EVENT_BYTES` without moving or duplicating either check. The separate 500-JavaScript-unit text input limit, `30KiB` per-image compression target, and `5KiB` avatar compression target SHALL remain unchanged. Every string, array, nesting depth, and final encoded byte size SHALL retain its explicit limit. SESSION `joinedAt`, HLC timestamp, and HLC counter SHALL be finite safe non-negative integers. Unknown types, unknown keys, forbidden envelope/context fields, missing or invalid `joinedAt`, non-canonical or malformed Base64, limit violations, and malformed payloads SHALL produce a public validation failure for the complete frame; the Runtime decides how to drop or log that failure. The protocol SHALL NOT add another validation boundary, helper, fallback, resource guard, or image-count rule.

#### Scenario: Unknown or oversized message

- **WHEN** the public validator receives an unknown type or a message exceeding `MAX_WIRE_BYTES = 256KiB`
- **THEN** it SHALL reject the complete message before any Runtime application, without specifying queue, retry, reconnect, or logging behavior

#### Scenario: Decompression and field resource limits

- **WHEN** decompression would produce more than `MAX_DECODED_JSON_BYTES = 1MiB`, one `ChatUser` JSON value exceeds `MAX_USER_BYTES = 8KiB`, or a `MAX_CHAT_EVENT_BYTES = 192KiB` consumer rejects its input
- **THEN** the public codec/validator or authored-message preflight SHALL reject through its owning boundary before application, without prescribing Runtime queue, retry, reconnect, logging, or another validation stage

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
- **THEN** the strict wire union SHALL accept only the exact frozen fields; SESSION SHALL require `presenceId` and `joinedAt`; each mention SHALL contain exactly `id`, `name`, `avatar`, and `ranges`; each range SHALL be one inclusive valid `[start,end]` pair; and the canonical text message SHALL remain within `MAX_CHAT_EVENT_BYTES = 192KiB`

#### Scenario: Reaction is explicit state

- **WHEN** a peer sends a reaction message
- **THEN** it SHALL carry `userId` and `active: boolean` plus the documented target/reaction/HLC/id fields

### Requirement: History wire shapes are bounded and reference-complete

The public peer protocol SHALL define only this exact history wire contract: `HistoryRequestMessage = {type:'history-request', syncId, before?: {hlc,id}}` and `HistoryResponseMessage = {type:'history-response', syncId, users:ChatUser[], messages:ChatMessage[], done}`. One `syncId` SHALL identify one complete paginated synchronization and remain stable while `before` advances. `before/messages/done` SHALL express cursor and completion semantics; the public protocol SHALL not prescribe local candidate windows, provider selection, timeout ownership, page cancellation, store effects, or Runtime queue scheduling. Each response SHALL carry at most 100 messages and remain strictly below `MAX_WIRE_BYTES = 256KiB` final encoded bytes. Every `message.userId` in a response SHALL resolve to exactly one matching `users[].id`; duplicate user ids SHALL be rejected, while additional users MAY be present.

Schemas SHALL accept only `syncId`, `messages`, and `ranges` for the corresponding fields. `requestId`, response `events`, mention `positions`, aliases, conflicting key pairs, and unknown keys SHALL reject the entire frame before projection or store writes. No dual-read, fallback, migration, or compatibility alias SHALL exist. Chat session/text/reaction and World parsing remain independently determined by their own strict schemas. The fixed `NativeWireCodec` envelope algorithm remains authoritative.

#### Scenario: Pull pagination

- **WHEN** two current peers exchange history
- **THEN** a peer MAY issue `history-request {syncId, before?}`, receive a flat byte-bounded `history-response`, and issue the next request using the same `syncId` plus the previous response's oldest `(hlc, id)` cursor; `done` SHALL state whether the provider has no more candidates for that sync

#### Scenario: Complete history references

- **WHEN** a `history-response` contains messages and users
- **THEN** every message `userId` SHALL have exactly one matching user entry, duplicate user ids SHALL cause the response to be rejected as a whole, and additional users SHALL remain accepted

#### Scenario: History response wire limits

- **WHEN** a `history-response` exceeds 100 messages or is greater than or equal to `MAX_WIRE_BYTES = 256KiB` after canonical encoding
- **THEN** the public codec/validator SHALL reject the response before Runtime application, without prescribing any retry, supplier, timeout, or queue behavior

#### Scenario: Old and ambiguous history keys reject

- **WHEN** a history frame contains `requestId`, contains both `requestId` and `syncId`, uses `events`, contains both `events` and `messages`, omits a required key, or contains any compatibility alias; or a text mention uses `positions` or both mention keys
- **THEN** the strict schema SHALL reject the complete frame, the Runtime SHALL project and persist nothing from it, and no fallback SHALL run
