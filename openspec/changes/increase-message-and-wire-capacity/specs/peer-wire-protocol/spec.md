## ADDED Requirements

### Requirement: Current v6 peer wire is a clean capacity generation

The current peer protocol SHALL use exact v6 Chat and World physical namespaces. It SHALL retain the exact current strict message fields, discriminants, History Pull/Push structures, and codec representation while replacing the capacity contract in this change. Current clients SHALL join and publish only v6. They SHALL not join, advertise, decode, publish, bridge, or fall back to v1-v5 rooms. The namespace cut SHALL prevent a v5 peer from appearing compatible and then failing only when a frame exceeds the old budgets.

#### Scenario: Current peers use v6 only

- **WHEN** a current client joins Chat and World
- **THEN** it SHALL select exact v6 namespace inputs and SHALL not join, advertise, or publish to a v1, v2, v3, v4, or v5 room

#### Scenario: Removed Chat lifecycle type stays outside v6

- **WHEN** a peer presents `type:'session-end'` or another removed Chat lifecycle value
- **THEN** the strict v6 Chat schema SHALL reject it as unknown, and no current client SHALL join an older room to interpret it

#### Scenario: History bytes use only the replacement shapes

- **WHEN** the same peer begins History synchronization under v6
- **THEN** it SHALL exchange only `history-messages-pull` and `history-messages-push` pages and SHALL emit no v3 `history-request`, `history-response`, `before`, or `HistoryCursor` value

#### Scenario: v5 capacity peers are physically isolated

- **WHEN** a v5 peer using the 48KiB message-like, 64KiB final-frame, and 256KiB decompressed limits is present in the same signaling environment as a current peer
- **THEN** the two generations SHALL share no Chat or World physical membership, and no capacity negotiation, compatibility send, decoder fallback, or bridge SHALL run

### Requirement: Canonical object resource guards complement structural schemas

Static declarative Valibot schemas SHALL remain the sole authority for public protocol data structure, schema-derived TypeScript types, discriminants, unknown keys, primitive shape, and declaratively expressible field/array limits. They SHALL receive no byte counter, callback, transform, clock, Set, reference map, or dynamic context.

The public protocol SHALL additionally own narrowly scoped pure resource guards that measure the UTF-8 byte length of the canonical `JSON.stringify` representation of one complete `ChatMessage` and one complete `ChatUser`. A complete canonical `ChatMessage` SHALL be no larger than 192KiB, including its discriminator, ID, HLC, user/target fields, body with every expanded image data URL, mentions, avatars, ranges, and every other variant field. A complete canonical `ChatUser` SHALL be no larger than 8KiB, including `id`, `name`, and `avatar`. These guards SHALL return acceptance/failure without transforming data, applying semantic relationships, or exposing a general callback validator surface.

The complete-object guards SHALL run for a locally produced user/message before transport or persistence and after the existing one complete structural parse at peer receive or local persistence load before application/projection. A locally produced user SHALL be guarded before join/publication or profile persistence; each parsed containing SESSION, World, mention, History, or local-record value SHALL apply the user guard to every nested `ChatUser`. An accepted typed value SHALL not be reparsed or repeatedly remeasured in intermediate Runtime, History supply, Delivery, or persistence paths. This resource exception narrowly supersedes earlier active statements that no whole-value `ChatMessage` or `ChatUser` canonical byte size may be computed; it does not weaken schema-owned structure, the declarative-only schema rule, or the existing two unknown-input parse boundaries.

#### Scenario: Complete message includes expanded images and mentions

- **WHEN** a locally produced or structurally parsed `ChatMessage` contains text, data URL images, mentions, avatars, ranges, and ordinary message fields whose complete canonical UTF-8 JSON is at most 192KiB
- **THEN** the pure message resource guard SHALL accept the complete object without changing it, while a value one byte over the budget SHALL fail before transport, persistence, or Runtime application

#### Scenario: Complete user budget is not an avatar string ceiling

- **WHEN** a locally produced or structurally parsed `ChatUser` has a complete canonical UTF-8 JSON representation at most 8KiB
- **THEN** the pure user resource guard SHALL accept it, and SHALL reject a complete user one byte over 8KiB even when its avatar field alone is shorter than 8KiB

#### Scenario: Resource guards do not become semantic validators

- **WHEN** protocol authority is inspected
- **THEN** schemas SHALL remain static/declarative and the pure object guards SHALL perform only deterministic canonical UTF-8 byte measurement, with no mention/body, HLC/time, URL, uniqueness, reference, identity, coercion, transform, or migration rule

#### Scenario: Typed values are not repeatedly validated

- **WHEN** one value has passed its owning structural parse and complete-object resource guard or was locally produced and guarded
- **THEN** intermediate Runtime, History supply, Delivery, and persistence paths SHALL trust that typed value and SHALL NOT add another parse, relationship validator, or duplicate object-budget stage

## MODIFIED Requirements

### Requirement: Wire messages are strict closed unions with limits

The public protocol SHALL define closed static declarative schemas, pure complete-object resource guards, and public constants whose names and units match their actual behavior. `WireDomain` SHALL parse the room-selected schema once at peer acceptance and apply the complete-object guards before typed application. Queue/drop/apply/flush scheduling, rate-limited logging, reconnect behavior, page sequencing, History lifecycle, and Delivery admission are not public protocol semantics.

Chat wire messages SHALL form the existing strict closed discriminated union keyed by `type`; World wire payloads SHALL use the existing strict schema selected by trusted v6 `roomId` and SHALL NOT carry a payload `type`. The codec SHALL enforce exactly 256KiB for one final Base64 wire frame and exactly 1MiB for streaming decompressed JSON before UTF-8 decode/JSON parse. The protocol SHALL enforce exactly 192KiB UTF-8 for one complete canonical `ChatMessage`, exactly 8KiB UTF-8 for one complete canonical `ChatUser`, and at most 100 messages in one History Push page. Declarative schemas SHALL retain their existing explicit built-in field and array ceilings except that the expanded wire `body` field ceiling SHALL be exactly 192 \* 1024 JavaScript string/UTF-16 code units so send-time data URLs are structurally representable. That field rule SHALL be named and treated separately from the complete-message UTF-8 byte budget. Unknown types, unknown keys, forbidden envelope/context fields, missing or invalid required values, declaratively expressible limit violations, complete-object byte violations, non-canonical/malformed Base64, invalid UTF-8/JSON/deflate, and encoded/decompressed bound violations SHALL reject the complete value before application.

The exact layered constants are:

- final encoded frame: 256KiB;
- streaming decompressed JSON: 1MiB;
- complete canonical `ChatMessage`: 192KiB UTF-8;
- complete canonical `ChatUser`: 8KiB UTF-8; and
- History Push count: at most 100 messages.

No application fragmentation/reassembly, alternate envelope, capacity negotiation, or compatibility limit SHALL exist.

#### Scenario: Final frame and decompression limits are independent

- **WHEN** a frame is encoded or decoded
- **THEN** the codec SHALL reject a final Base64 string over 256KiB and SHALL stop streamed decompression over 1MiB before materializing unsafe UTF-8/JSON, even when the other limit would pass

#### Scenario: Unknown or oversized message

- **WHEN** peer input has an unknown type, violates a declarative field/array ceiling or complete-object byte budget, or exceeds the 256KiB encoded codec frame bound
- **THEN** the room-selected schema, pure resource guard, or codec SHALL reject the complete input before any Runtime application, without specifying queue, retry, reconnect, or logging behavior

#### Scenario: Decompression and field resource limits

- **WHEN** decompression would produce more than 1MiB, one complete canonical `ChatUser` exceeds 8KiB UTF-8, one complete canonical `ChatMessage` exceeds 192KiB UTF-8, or a decoded value violates a retained declarative field/array ceiling
- **THEN** the codec SHALL stop unsafe materialization or the owning schema/resource guard SHALL reject the complete value before application, without adding a callback-backed schema rule or semantic validator

#### Scenario: One canonical message reaches the wire only within both budgets

- **WHEN** one complete canonical `ChatMessage` is at most 192KiB UTF-8 and its containing current wire value encodes to at most 256KiB
- **THEN** it MAY be sent as one unfragmented frame, while violation of either bound SHALL reject the complete send/input without a partial frame

#### Scenario: Oversize input is source-local

- **WHEN** a peer supplies a malformed, over-256KiB final frame, over-1MiB decompressed value, or over-budget complete `ChatMessage`/`ChatUser`
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

The public peer protocol SHALL retain the exact current `HistoryMessagesPull` and `HistoryMessagesPush` structures, one synchronization per connection/direction, continuous page rules, fixed current type strings/keys, and no old History variants or compatibility aliases. Every Pull and Push page SHALL be no larger than the common 256KiB final Base64 wire-frame ceiling after the exact current codec representation. Each Push SHALL carry at most 100 messages. The provider SHALL shrink a candidate page until the real codec accepts it, and one legal 192KiB canonical `ChatMessage` plus its required user and Push envelope SHALL remain replayable in one page. A Push with no individually legal sendable record SHALL fail that source-local History attempt rather than emit an empty non-final page or silently drop the record.

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

#### Scenario: Full-size legal live message remains replayable

- **WHEN** a legal canonical message near 192KiB is the next missing History record
- **THEN** the provider SHALL construct one Push page within the common 256KiB final-frame ceiling containing that message and required author/envelope, rather than applying an obsolete 64KiB History cap

#### Scenario: History page count and wire bounds both apply

- **WHEN** a History Push candidate contains more than 100 messages or its exact final encoded frame exceeds 256KiB
- **THEN** the schema or real codec preflight SHALL reject/shrink the candidate before send, and no page SHALL partially cross the peer boundary

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

- **WHEN** a History Push exceeds its declarative 100-message count rule or its exact final frame exceeds 256KiB
- **THEN** the static schema or real codec preflight SHALL reject or shrink the complete page before Runtime application/send, without prescribing retry, supplier, timeout, queue, or peer-state behavior

#### Scenario: Old and ambiguous history keys reject

- **WHEN** a History frame uses an old type, carries `before`, `requestId`, `events`, `snapshotId`, `nextBefore`, an acknowledgement type, both old and new keys, or any compatibility alias
- **THEN** the strict schema SHALL reject the complete frame, the Runtime SHALL project and persist nothing from it, no Toast SHALL publish, and no fallback SHALL run

### Requirement: No old-protocol compatibility

The current peer protocol SHALL NOT bridge, translate, negotiate, or interoperate with released v1-v5 peers, including v5 peers that retain the old 48KiB message-like, 64KiB final-frame, or 256KiB decompressed limits. The new v6 192KiB complete-message, 256KiB final-frame, and 1MiB decompressed contract SHALL replace those values in one current-only delivery. v1-v6 SHALL use isolated Chat and World room namespaces. No old decoder, fallback limit, dual publication, dual read/write, room bridge, translator, capability bit, migration, or conditional compatibility path SHALL exist. Retained structural message fields remain current; capacity incompatibility SHALL not be hidden by a second path.

#### Scenario: Old-capacity peer has no compatibility route

- **WHEN** a current peer and an older-capacity peer encounter a value valid only under the new budgets
- **THEN** no negotiation, fallback encoding, smaller compatibility send, alternate room publication, or retry SHALL run; the older peer is intentionally incompatible

#### Scenario: Current peer exposes one capacity truth

- **WHEN** current public constants, codec checks, Footer preflight, History paging, documentation, and existing affected expectations are inspected
- **THEN** they SHALL describe only 192KiB complete message, 256KiB final frame, and 1MiB decompressed JSON limits, with no reachable old-value branch

#### Scenario: v1/v2 cross-traffic

- **WHEN** v1, v2, v3, v4, v5, and v6 clients meet in a shared signaling environment
- **THEN** each generation SHALL use isolated Chat and World namespaces, none SHALL parse or advertise another generation's traffic, and no compatibility fallback SHALL exist

## REMOVED Requirements

### Requirement: Current v5 peer wire is a clean generation cut

**Reason**: The current capacity contract advances the clean peer generation from v5 to v6, so the canonical v5 requirement must not remain a second current-generation authority.

**Migration**: None. Current clients join only v6 Chat and World namespaces under the added v6 requirement; no runtime compatibility, room bridge, fallback, or data migration path exists.
