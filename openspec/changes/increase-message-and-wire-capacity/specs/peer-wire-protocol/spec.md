## ADDED Requirements

### Requirement: Current v6 peer wire is a clean capacity generation

The current peer protocol SHALL use exact v6 Chat and World physical namespaces. It SHALL retain the exact current strict message fields, discriminants, History Pull/Push structures, codec representation, Session `{presenceId, joinedAt}` semantics, and provider-PeerLeave lifecycle while replacing only the capacity contract in this change. Physical departure SHALL remain trusted provider context outside peer data, and no Chat lifecycle-end value SHALL exist. Current clients SHALL join and publish only v6. They SHALL not join, advertise, decode, publish, bridge, or fall back to v1-v5 rooms. The namespace cut SHALL prevent a v5 peer from appearing compatible and then failing only when a frame exceeds the old budgets.

#### Scenario: Current peers use v6 only

- **WHEN** a current client joins Chat and World
- **THEN** it SHALL select exact v6 namespace inputs and SHALL not join, advertise, or publish to a v1, v2, v3, v4, or v5 room

#### Scenario: Removed Chat lifecycle type stays outside v6

- **WHEN** a peer presents `type:'session-end'` or another removed Chat lifecycle value
- **THEN** the strict v6 Chat schema SHALL reject it as unknown, and no current client SHALL join an older room to interpret it

#### Scenario: Physical leave lifecycle survives the capacity cut

- **WHEN** a current v6 source physically departs or rebinds the same logical generation during Session's five-second leave grace
- **THEN** the provider PeerLeave fact and Session binding SHALL remain the sole lifecycle path, `{presenceId, joinedAt}` SHALL retain its current meaning, and no lifecycle-end wire value, compatibility decoder, or capacity-specific alternate path SHALL run

#### Scenario: History bytes use only the replacement shapes

- **WHEN** the same peer begins History synchronization under v6
- **THEN** it SHALL exchange only `history-messages-pull` and `history-messages-push` pages and SHALL emit no v3 `history-request`, `history-response`, `before`, or `HistoryCursor` value

#### Scenario: v5 capacity peers are physically isolated

- **WHEN** a v5 peer using the 48KiB message-like, 64KiB final-frame, and 256KiB decompressed limits is present in the same signaling environment as a current peer
- **THEN** the two generations SHALL share no Chat or World physical membership, and no capacity negotiation, compatibility send, decoder fallback, or bridge SHALL run

### Requirement: Pure Schema validation remains at exactly three boundaries

Static declarative Valibot schemas SHALL remain the sole application authority for public protocol data structure, schema-derived TypeScript types, discriminants, unknown keys, primitive shape, and declaratively expressible field/array limits. They SHALL receive no byte counter, callback, transform, clock, Set, reference map, or dynamic context. The same complete pure Schema SHALL validate protocol values exactly once at peer receive, exactly once at outbound send, and exactly once when unknown local persistence records enter a typed load result. The codec SHALL separately own only its physical final-frame and streaming decompression limits.

The public protocol SHALL define no complete-object JSON or UTF-8 budget for `ChatMessage` or `ChatUser`. `MAX_CHAT_MESSAGE_BYTES`, `isChatMessageWithinBudget`, `isChatUserWithinBudget`, `utf8ByteLength`, and any equivalent helper SHALL be absent. The three validation boundaries SHALL use only their complete static Schema. Local production before the unified send boundary, Footer, persistence write after that boundary, Session, UserInfo, ChatRoom, Server, World, History supply, Delivery, profile, allocation, join, mention, and downstream paths SHALL add no extra parse, caller-side complete-object guard, or corresponding defensive drop branch.

The static wire `body` field SHALL allow at most 192 × 1024 JavaScript string/UTF-16 code units, the static `ChatUser.avatar` field SHALL allow at most 8 × 1024 code units, and all retained field/array rules SHALL continue to use built-in Schema operations at the three validation boundaries. Independently, every encoded or decoded frame SHALL pass the real codec's physical limits. If a message rule cannot be expressed by static Schema, the protocol SHALL not validate it elsewhere.

#### Scenario: Complete-object byte guards are absent

- **WHEN** a `ChatMessage` or `ChatUser` reaches peer receive, outbound send, or local persistence load, or is already typed inside another application path
- **THEN** no helper or caller SHALL serialize it to measure a complete-object byte budget; the three owning boundaries SHALL use only the same static Schema, and other typed internal paths SHALL not revalidate it

#### Scenario: Field units remain explicit

- **WHEN** public capacity constants and schemas are inspected
- **THEN** the 192 × 1024 `body` and 8 × 1024 `avatar` ceilings SHALL be named and applied as JavaScript string/UTF-16 code-unit field limits, never as complete-message or complete-user byte budgets

#### Scenario: Outbound typed data uses the unified Schema boundary

- **WHEN** an already typed local value is sent for peer transport or local persistence
- **THEN** the unified outbound owner SHALL parse it once through the same complete static Schema before codec encoding and persistence write, with no Footer parse, object-level byte guard, or other validation layer

## MODIFIED Requirements

### Requirement: Wire messages are strict closed unions with limits

The public protocol SHALL define closed static declarative schemas and public constants whose names and units match their actual behavior. `WireDomain` SHALL parse the room-selected schema once at peer acceptance, the unified outbound owner SHALL parse once before send/persistence write, and local persistence load SHALL parse each unknown stored record once through its complete declarative record schema. No other application path SHALL parse protocol values or add a post-parse complete-object budget guard. Queue/drop/apply/flush scheduling, rate-limited logging, reconnect behavior, page sequencing, History lifecycle, and Delivery admission are not public protocol semantics.

Chat wire messages SHALL form the existing strict closed discriminated union keyed by `type`; World wire payloads SHALL use the existing strict schema selected by trusted v6 `roomId` and SHALL NOT carry a payload `type`. The codec SHALL enforce exactly 256KiB for one final Base64 wire frame and exactly 1MiB for streaming decompressed JSON before UTF-8 decode/JSON parse. Declarative schemas SHALL enforce exactly 192 × 1024 JavaScript string/UTF-16 code units for the expanded wire `body` field, exactly 8 × 1024 code units for `ChatUser.avatar`, at most 100 messages in one History Push page, and every other retained built-in field/array ceiling. Unknown types, unknown keys, forbidden envelope/context fields, missing or invalid required values, declaratively expressible limit violations, non-canonical/malformed Base64, invalid UTF-8/JSON/deflate, and encoded/decompressed bound violations SHALL reject the complete value before application.

The exact layered constants are:

- final encoded frame: 256KiB;
- streaming decompressed JSON: 1MiB;
- wire `body`: 192 × 1024 JavaScript string/UTF-16 code units;
- `ChatUser.avatar`: 8 × 1024 JavaScript string/UTF-16 code units; and
- History Push count: at most 100 messages.

No application fragmentation/reassembly, alternate envelope, capacity negotiation, or compatibility limit SHALL exist.

#### Scenario: Final frame and decompression limits are independent

- **WHEN** a frame is encoded or decoded
- **THEN** the codec SHALL reject a final Base64 string over 256KiB and SHALL stop streamed decompression over 1MiB before materializing unsafe UTF-8/JSON, even when the other limit would pass

#### Scenario: Unknown or oversized message

- **WHEN** peer input has an unknown type, violates a declarative field/array ceiling, or exceeds the 256KiB encoded codec frame bound
- **THEN** the room-selected Schema or codec SHALL reject the complete input before any Runtime application, without specifying queue, retry, reconnect, or logging behavior

#### Scenario: Decompression and field resource limits

- **WHEN** decompression would produce more than 1MiB or a decoded value violates a retained declarative field/array ceiling such as `body` or `avatar`
- **THEN** the codec SHALL stop unsafe materialization or the owning static Schema SHALL reject the complete value before application, without adding a callback-backed rule, object-byte helper, or caller-side validator

#### Scenario: One typed message uses the unified send boundary and common codec

- **WHEN** one typed `ChatMessage` is placed in a current wire value that satisfies the same complete static Schema and encodes to at most 256KiB while decoding to at most 1MiB
- **THEN** the outbound owner SHALL parse it once and MAY send it as one unfragmented frame, while the receiving peer SHALL independently parse the decoded unknown value through that same static Schema

#### Scenario: Oversize input is source-local

- **WHEN** a peer supplies a malformed value, over-256KiB final frame, over-1MiB decompressed value, or value rejected by the static Schema
- **THEN** the complete source-local value SHALL be rejected before application and the capacity failure SHALL NOT require room disconnect, peer recreation, fallback decoding, or a compatibility retry

#### Scenario: Unchanged operational queue bounds

- **WHEN** current frames enter the Runtime decode pipeline
- **THEN** each source SHALL remain bounded to 8 queued frames and 256KiB aggregate wire bytes, so one full-size frame MAY occupy that source's complete byte queue without changing another source or the room

#### Scenario: Opaque message IDs remain aggregate-bounded

- **WHEN** a History Pull carries message IDs with any string content or individual length
- **THEN** the schema SHALL apply no per-ID regex, NanoID-length rule, or independent string ceiling, while the complete Pull page SHALL remain within the 256KiB codec bounds and the current attempt lifecycle

#### Scenario: Redundant envelope fields

- **WHEN** any wire type is defined
- **THEN** its strict schema SHALL reject a frame carrying room, sender peerId, version, sentAt, receivedAt, or any other forbidden envelope/context field; `receivedAt` SHALL remain receiver-local metadata and no field SHALL be stripped or tolerated

#### Scenario: Invalid logical join time

- **WHEN** a SESSION omits `joinedAt`, adds an unknown key, or supplies a negative, fractional, non-finite, or unsafe integer value
- **THEN** the strict schema SHALL reject the complete frame before Session binding, membership mutation, or notice classification

#### Scenario: Invalid History page number

- **WHEN** a History page omits `page`, adds an unknown key, or supplies a negative, fractional, non-finite, or unsafe page value
- **THEN** the strict schema SHALL reject the complete frame before History attempt mutation, persistence, or feedback

### Requirement: History wire shapes are bounded and reference-complete

The public peer protocol SHALL retain the exact current `HistoryMessagesPull` and `HistoryMessagesPush` structures, one synchronization per connection/direction, continuous page rules, fixed current type strings/keys, and no old History variants or compatibility aliases. Every Pull and Push page SHALL be no larger than the common 256KiB final Base64 wire-frame ceiling after the exact current codec representation. The provider SHALL construct each Push with at most 100 typed messages, pass it once through the unified outbound Schema boundary, and shrink a candidate page until the real codec accepts it. If one typed record from the persistence-load boundary plus its required authors and Push envelope cannot fit, that source-local History attempt SHALL fail rather than emit an empty non-final page, silently drop the record, or add a separate per-message object guard.

The provider SHALL retain the existing producer responsibility to include exactly one `ChatUser` for every distinct `messages[].userId`, no duplicate or unrelated users, and no users when messages are empty. Static schemas SHALL not validate those cross-array relationships. Pull ID elements remain opaque strings governed by the complete page codec bound and Runtime lifecycle rather than a standalone ID rule or a cumulative 10,000-entry/8MiB protocol budget.

The schemas SHALL continue to accept only `history-messages-pull`/`history-messages-push` and their exact current keys. `HistoryCursor`, old Request/Response types, `history-request`, `history-response`, `before`, `requestId`, response `events`, `snapshotId`, `nextBefore`, acknowledgement variants, compatibility aliases, and old/new key pairs SHALL remain absent.

#### Scenario: Pull pagination

- **WHEN** two current v6 peers synchronize one direction
- **THEN** the requester SHALL send continuous bounded `history-messages-pull` inventory pages through one final `done: true` page, after which the provider SHALL send continuous bounded `history-messages-push` missing-record pages through one final `done: true` page using the same `syncId`; no third peer type or body request SHALL participate

#### Scenario: A current connection cannot synchronize twice in one direction

- **GIVEN** one current source incarnation and direction has bound its sole `syncId`
- **WHEN** that synchronization completes, is canceled, or fails and a later page uses either the same or a different `syncId`
- **THEN** no new History synchronization SHALL start until source replacement or domain release ends that connection binding

#### Scenario: A later connection starts independently

- **WHEN** a source is replaced or released and a later connection joins the room
- **THEN** that connection SHALL use a fresh `syncId`, page zero, and current snapshots without any resumed page, retry count, cursor, or progress from the prior connection

#### Scenario: Empty inventory and empty difference are explicit

- **WHEN** the requester inventory is empty or the provider computes no missing records
- **THEN** the corresponding phase SHALL still send exactly one `page: 0, done: true` page with an empty `messageIds` array or empty `users` and `messages` arrays

#### Scenario: One-record page still uses the real codec

- **WHEN** one typed missing record and its required author/envelope fit within the common 256KiB final-frame ceiling
- **THEN** the provider SHALL send it in one Push page rather than applying an obsolete 64KiB or separate per-message cap; if that complete page cannot fit, the source-local attempt SHALL fail

#### Scenario: History page count and wire bounds both apply

- **WHEN** a provider builds a History Push candidate whose count would exceed 100 or whose exact final encoded frame exceeds 256KiB
- **THEN** the provider SHALL cap the count, the unified outbound owner SHALL parse the candidate once, and the real codec preflight SHALL drive page shrinking before send

#### Scenario: Pull inventory has no cumulative protocol cap

- **WHEN** a fixed eligible requester snapshot contains more than 10,000 IDs or 8MiB of inventory across its pages
- **THEN** the requester MAY continue emitting continuous individually bounded Pull pages until snapshot exhaustion, cancellation, failure, or no-progress timeout; no cumulative protocol budget SHALL truncate the snapshot

#### Scenario: Complete history references

- **WHEN** the provider constructs a History Push containing messages and users
- **THEN** it SHALL include exactly one matching user for each distinct message `userId`, no unrelated or duplicate users, and no users for an empty message page, while the receiver schema SHALL NOT enforce those cross-array relationships

#### Scenario: Unsupported History reference validation is absent

- **WHEN** an otherwise declaratively valid History Push contains a missing, duplicate, or unrelated user reference
- **THEN** schema parsing SHALL NOT reject it through a callback, Set, reference map, post-parse predicate, or caller-side compatibility fallback

#### Scenario: History response wire limits

- **WHEN** a provider constructs a History Push or a peer receives one
- **THEN** the provider SHALL retain at most 100 typed messages and use the real codec preflight for the 256KiB frame, while the receiving peer SHALL independently apply the static Schema after decode

#### Scenario: Old and ambiguous history keys reject

- **WHEN** a History frame uses an old type, carries `before`, `requestId`, `events`, `snapshotId`, `nextBefore`, an acknowledgement type, both old and new keys, or any compatibility alias
- **THEN** the strict schema SHALL reject the complete frame, the Runtime SHALL project and persist nothing from it, no Toast SHALL publish, and no fallback SHALL run

### Requirement: No old-protocol compatibility

The current peer protocol SHALL NOT bridge, translate, negotiate, or interoperate with released v1-v5 peers, including v5 peers that retain the old 48KiB body-field, 64KiB final-frame, or 256KiB decompressed limits. The new v6 192 × 1024-code-unit body-field, 256KiB final-frame, and 1MiB decompressed contract SHALL replace those values in one current-only delivery. v1-v6 SHALL use isolated Chat and World room namespaces. No old decoder, fallback limit, dual publication, dual read/write, room bridge, translator, capability bit, migration, or conditional compatibility path SHALL exist. Retained structural message fields remain current; capacity incompatibility SHALL not be hidden by a second path.

#### Scenario: Old-capacity peer has no compatibility route

- **WHEN** a current peer and an older-capacity peer encounter a value valid only under the new budgets
- **THEN** no negotiation, fallback encoding, smaller compatibility send, alternate room publication, or retry SHALL run; the older peer is intentionally incompatible

#### Scenario: Current peer exposes one capacity truth

- **WHEN** current public constants, Schema checks, codec checks, History paging, documentation, and existing affected expectations are inspected
- **THEN** they SHALL describe only the 192 × 1024-code-unit body field, retained static user fields, 256KiB final frame, and 1MiB decompressed JSON limits, with no complete-object byte guard or reachable old-value branch

#### Scenario: v1/v2 cross-traffic

- **WHEN** v1, v2, v3, v4, v5, and v6 clients meet in a shared signaling environment
- **THEN** each generation SHALL use isolated Chat and World namespaces, none SHALL parse or advertise another generation's traffic, and no compatibility fallback SHALL exist

## REMOVED Requirements

### Requirement: Current v5 peer wire is a clean generation cut

**Reason**: The current capacity contract advances the clean peer generation from v5 to v6, so the canonical v5 requirement must not remain a second current-generation authority.

**Migration**: None. Current clients join only v6 Chat and World namespaces under the added v6 requirement; no runtime compatibility, room bridge, fallback, or data migration path exists.
