## ADDED Requirements

### Requirement: Protocol schemas are the sole data and validation authority

Every public peer-protocol data structure in `src/protocol` SHALL be defined schema-first. `ChatUser`, `ChatSession`, `HLC`, `MentionedUser`, `SessionMessage`, `SessionEndMessage`, `TextMessage`, `ReactionType`, `ReactionMessage`, `ChatMessage`, `HistoryMessagesRequest`, `HistoryMessagesResponse`, `ChatRoomMessage`, `ChatSite`, and `WorldRoomMessage` SHALL each be inferred from the output of its exported owning schema; no handwritten interface, structural type, duplicate union, compatibility DTO, or post-parse cast SHALL independently describe the same value.

A complete Chat or World schema SHALL compose the exported child schemas and SHALL itself own every supported protocol constraint, including strict keys, discriminants, field limits, whole-value byte limits, mention ranges, HLC time, origin-only World sites, uniqueness, and History user references. Protocol validation SHALL use only schema parsing and schema-native composition/actions. No standalone boolean validator, post-parse predicate, caller-side property inspection, or partially validated protocol value SHALL add another validation stage. If the installed schema system cannot express a proposed protocol constraint, that constraint SHALL not be validated and SHALL not be reintroduced through a handwritten fallback.

The codec SHALL continue to perform only the fixed representation work required to turn a bounded Base64/deflate/UTF-8/JSON frame into `unknown` or encode a typed value. Codec representation and bounded-I/O failures SHALL NOT inspect decoded message properties and SHALL NOT become an alternative protocol-data validator.

#### Scenario: Schema and type cannot drift

- **WHEN** any exported protocol field, union member, or output shape changes
- **THEN** the owning schema SHALL be the edited source and the exported TypeScript type SHALL change through schema inference, with no second handwritten declaration to update

#### Scenario: Complete schema owns cross-field rules

- **WHEN** a Text message contains mention ranges, a World snapshot contains sites, or a History response contains users and messages
- **THEN** the corresponding complete schema SHALL either accept or reject all structural, resource, uniqueness, range, and reference relationships in one parse result, without a later predicate

#### Scenario: Unsupported validation is absent

- **WHEN** the installed schema system cannot represent a proposed protocol constraint
- **THEN** the implementation SHALL omit that validation and its tests rather than inspect the parsed value through a helper, caller branch, cast, or custom fallback outside the schema

#### Scenario: Codec output remains unknown until schema parse

- **WHEN** the codec successfully decodes a bounded canonical frame
- **THEN** it SHALL return `unknown`, and only the room-selected complete schema at an authorized validation boundary may turn that value into a protocol type

## MODIFIED Requirements

### Requirement: Public protocol module is pure and explicitly bounded

The code-level public module `src/protocol/index.ts` SHALL be the third-party-facing peer contract without introducing a package, publishing flow, or SDK. Its wire structures SHALL be exactly the Owner-frozen `ChatUser`, `ChatSession`, `HLC`, `MentionedUser`, `SessionMessage`, `SessionEndMessage`, `TextMessage`, `ReactionType`, `ReactionMessage`, `ChatMessage`, `HistoryMessagesRequest`, `HistoryMessagesResponse`, `ChatRoomMessage`, `ChatSite`, and `WorldRoomMessage` contracts. It SHALL export only their authoritative strict schemas, schema-inferred TypeScript types, public limits/constants, and the public codec surface (`WireCodec`, `NativeWireCodec` reference implementation, `WireCodecError`). It SHALL NOT export a standalone parse/check/boolean validator, handwritten duplicate message declaration, structural alias, compatibility DTO, or optional/open metadata bag. Supported schema validation SHALL cover closed-union and unknown-key rejection, field/resource limits, mention `ranges`, user/message size, origin-only and uniqueness rules, History response reference completeness, required SESSION `joinedAt`, and explicit-`now` HLC rules. The `NativeWireCodec` SHALL own only the fixed codec/security algorithm; the public protocol SHALL NOT export local persistence/UI models, projections, ordering implementations, Runtime lifecycle or page-host RPC contracts, WirePipeline queue/drop/apply/flush types, or application orchestration.

`src/protocol/**` SHALL NOT depend on `domain/runtime`, `service`, `app`, UI, storage, comctx, browser-extension APIs/globals (`chrome.*`/`browser.*`), DOM/window/document, host lifecycle APIs, or app configuration. The public `NativeWireCodec` MAY use the standard Web codec APIs it implements (`CompressionStream`, `DecompressionStream`, `Blob`, `ReadableStream`, `TextEncoder`, and `TextDecoder`) and exactly the two scoped `core-js` imports; no whole-package polyfill is permitted. Protocol-owned limits and pure byte utilities SHALL be defined within the protocol boundary. Runtime and Domain code SHALL depend on the public protocol one way; the protocol SHALL NOT import Runtime or Domain code.

The inferred schema outputs SHALL remain byte-for-byte equivalent to these structural declarations; the declarations below document wire shape and SHALL NOT be duplicated as handwritten source types:

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
type ReactionType = 'like' | 'hate'
interface ReactionMessage {
  type: 'reaction'
  id: string
  hlc: HLC
  targetId: string
  userId: string
  reaction: ReactionType
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
- **THEN** it SHALL see only the documented schema-inferred peer wire types, authoritative schemas, `WireCodec` interface, `NativeWireCodec` reference implementation, `WireCodecError`, and protocol constants; validator helpers, `LocalRecord`, UI models, projections, Runtime RPC, queue/drop types, and internal Runtime symbols SHALL not be reachable

#### Scenario: Public protocol dependency direction

- **WHEN** the protocol dependency graph is inspected
- **THEN** every protocol dependency SHALL remain cross-target compatible, and no reverse import from protocol into Runtime, Domain, storage, service, app, UI, comctx, browser-extension APIs/globals, DOM/window/document, host lifecycle APIs, or app configuration SHALL exist; standard Web codec APIs used by `NativeWireCodec` are allowed

### Requirement: Wire messages are strict closed unions with limits

The public protocol SHALL define authoritative closed schemas and pure limits. At peer receive, `WireDomain` SHALL select and parse exactly one complete schema using trusted transport context and MAY apply source-local operational policies after rejection, but it SHALL NOT compose a separate validator. Queue/drop/apply/flush scheduling, rate-limited diagnostics, reconnect behavior, page sequencing, attempt budgets, and delivery admission are not public protocol semantics.

Chat wire messages SHALL form a strict, closed discriminated union keyed by `type`; World wire payloads SHALL use one strict schema selected by trusted v4 `roomId` and SHALL NOT carry a payload `type`. The public protocol SHALL export and enforce these fixed limits: `MAX_WIRE_BYTES = 64KiB` for final encoded frames, `MAX_DECODED_JSON_BYTES = 256KiB` for streaming decompressed JSON before parse, `MAX_CHAT_EVENT_BYTES = 48KiB` for one canonical message, `MAX_USER_BYTES = 8KiB` for one `ChatUser` JSON value, and at most 100 messages in one History response page. Every string, array, nesting depth, and final encoded byte size SHALL have an explicit public limit except that each `messageIds[]` element remains an opaque string with no standalone length or format rule and is bounded only by the containing frame and Runtime attempt budgets. SESSION `joinedAt`, HLC timestamp, HLC counter, and History `page` SHALL be finite safe non-negative integers. Unknown types, unknown keys, forbidden envelope/context fields, missing or invalid required values, and schema-supported message limit violations SHALL fail the complete schema parse. Malformed/non-canonical Base64, invalid UTF-8/JSON/deflate, and encoded/decompressed frame bounds SHALL remain codec representation failures before message schema parsing.

#### Scenario: Unknown or oversized message

- **WHEN** a decoded value has an unknown type or violates a schema-owned message limit at peer receive or local persistence load
- **THEN** the complete schema parse SHALL fail before any Runtime application, without a second validator or partial output

#### Scenario: Decompression and field resource limits

- **WHEN** a frame exceeds the encoded/decompressed codec bounds, one `ChatUser` exceeds `MAX_USER_BYTES = 8KiB`, or one canonical `ChatMessage` exceeds `MAX_CHAT_EVENT_BYTES = 48KiB`
- **THEN** the codec SHALL stop unsafe frame materialization while the complete message schema SHALL own the user/message limits; neither layer SHALL duplicate the other's checks

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

Hybrid Logical Clock values on wire `ChatMessage` values SHALL be finite non-negative safe integers for both timestamp and counter. Construction of the complete Chat schema SHALL receive the receiver's current time as an explicit `now` input; protocol code SHALL NOT call `Date.now()` or any hidden clock. An event whose HLC timestamp exceeds `now` by more than 5 minutes SHALL fail that complete schema parse. The protocol SHALL define the canonical total-ordering and last-writer-wins rule as composite `(hlc, id)`; comparison and clock adoption after an accepted parse belong to the application/page Domain/model layer, or a shared Domain/model module when both pages and Runtime consume them, and SHALL NOT revalidate the HLC.

#### Scenario: Future-poisoned event

- **WHEN** the complete Chat schema receives an event with an HLC timestamp more than 5 minutes in the future and an explicit `now`
- **THEN** the schema parse SHALL fail without calling a hidden clock or requiring a later time predicate

#### Scenario: Same-clock different messages

- **WHEN** two schema-accepted messages share an HLC timestamp and counter but have different ids
- **THEN** they SHALL be ordered and deduplicated by `(hlc, id)`, never by HLC alone, without revalidating either message
