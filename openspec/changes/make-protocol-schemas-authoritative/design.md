## Context

See `proposal.md` for motivation. The current public protocol defines message interfaces/unions before their Valibot schemas, then completes validation through exported predicates and repeated caller checks. The repeated checks currently appear at peer receive, local record load, local identity/message production, send, clock adoption, History supply, and intermediate Runtime consumption.

Protocol validation exists exactly at peer receive, outbound send, and local persistence load, uses the same pure static Schema, and adds no handwritten validator. Receive/load failures are silently discarded without a Toast; outbound failure sends and persists nothing. The cumulative current contract removes complete-object guards and the unreliable Chat end variant, keeps editor-session `blob:<id>` locators outside protocol data, makes Artico physical departure the sole remote leave input, and isolates the resulting wire through v6 Chat and World namespaces.

## Goals / Non-Goals

**Goals:**

- Establish one schema-owned definition graph for every public protocol data type.
- Retain only protocol rules expressible through declarative Valibot primitives and combinators.
- Give peer receive, outbound send, and local persistence load exclusive ownership of protocol validation.
- Remove duplicate protocol checks and partially validated values from every other path.
- Remove `SessionEndMessage` and every final-end state/effect so one physical lifecycle signal owns remote leave classification.
- Preserve stable online presence across a bounded five-second PeerLeave grace and classify one user leave only after the last presence expires.
- Make the breaking wire change through one v6 Chat/World namespace cut with no compatibility path.

**Non-Goals:**

- Changing retained SESSION, text, reaction, History, or World payload fields, the origin-database format, or UI copy beyond the cumulative v6 capacity contract. That contract changes only the static body ceiling, codec resource ceilings, History cumulative-budget behavior, and editor Blob-locator implementation described here.
- Applying schema-first rules to extension page/content/background/offscreen control-plane messages.
- Removing non-protocol authorization, ownership, queue, or scheduling decisions unrelated to final-end deletion and PeerLeave grace.
- Adding a dependency, compatibility path, data migration, or user-facing validation feedback.

## Decisions

### 1. The schema graph defines the public data graph

`Session` owns the schemas for `ChatUser` and `ChatSession`; `ChatRoom` owns `HLC`, mention, SESSION, text, reaction, History Pull/Push, Chat-message, and closed Chat-room schemas; `WorldRoom` owns `ChatSite` and the complete World snapshot schema. Parent schemas compose exported child schemas rather than copying their fields into a separate type declaration.

Every public protocol data type is inferred from its owning schema output. This includes leaf values, variants, and unions. Constants may remain ordinary values, and `WireCodec`, `NativeWireCodec`, `WireCodecError`, and public limits remain ordinary non-message API declarations. Handwritten interfaces/unions, type assertions that manufacture schema output, and aliases duplicating a schema-owned structure are removed.

The current History symbols are `HistoryMessagesPull`/`HistoryMessagesPullSchema` and `HistoryMessagesPush`/`HistoryMessagesPushSchema`. The old Request/Response symbols are deleted without aliases; the existing `history-messages-pull`/`history-messages-push` literals and encoded shapes do not change.

Alternative rejected: retain interfaces as documentation and test them against schemas. That still leaves two editable facts and cannot prevent drift.

### 2. Protocol schemas contain no executable validation logic

Protocol schemas use only declarative Valibot primitives and combinators such as strict objects, variants, literals, picklists, arrays, tuples, optionals, primitive types, and built-in length/value/integer actions. A pipeline remains declarative only when every member is a built-in declarative schema or action.

`v.check`, `v.partialCheck`, `v.rawCheck`, `v.custom`, `v.transform`, user-provided callbacks, and equivalent executable predicates or transforms are forbidden. The Chat and World schemas are static and receive no contextual `now`, clock, URL parser, byte counter, Set, reference map, or other JavaScript validation input. No `is*`, `check*`, schema factory, or post-parse helper may finish validation after parsing.

Whole-value canonical JSON byte size, mention ranges relative to `body`, future HLC relative to receiver time, origin-only URL semantics, uniqueness, History user/message reference completeness, and local record identity relationships are therefore not validated. Their former callback tests are deleted. Structural keys, discriminants, primitive types, safe non-negative integer shape, field/array ceilings, and other rules directly expressible by declarative built-ins remain.

Alternative rejected: hide a JavaScript callback inside `v.pipe` and call it schema-native. The callback is still handwritten validation and violates the pure-Schema boundary.

### 3. Receive, send, and local load share one Schema authority

At peer receive, Wire first uses trusted transport context to select the static World or Chat protocol schema and safe-parses the decoded `unknown` once. Failure emits no typed message and reaches no Session, History, persistence, notification, unread, or page behavior. It creates no Toast.

At outbound send, Wire parses the complete typed value once through the same static World or Chat protocol schema before codec encoding and persistence write. Failure sends and persists nothing. The local producer and Footer do not add their own parse or handwritten validation.

At local load, the declarative local record schema composes the authoritative protocol child schema with its local-only structural fields. Each unknown stored item is parsed once as it enters the typed query result. Failure omits the item from the returned result and every projection, with no Toast. Database-key/message/user relationships that need a callback are not validated.

Local producers before the outbound boundary, persistence write after it, History supply, clock adoption, and downstream Session/History consumers trust their TypeScript inputs and do not add another parse or inspect message fields for protocol validity. Existing non-protocol identity authorization, operation ownership, lifecycle fencing, and bounded scheduling remain where they are.

Alternative rejected: add validation before or after the three unified boundaries as defense in depth. Extra checks would recreate path-dependent behavior.

### 4. Codec safety is representation work, not another message validator

`NativeWireCodec` keeps strict Base64 canonicality, bounded deflate streaming, fatal UTF-8, JSON decode/encode, and encoded/decompressed resource ceilings because those steps are required to safely produce or consume a frame. It returns decoded `unknown` and never inspects a message discriminator, property, relationship, or protocol semantic. Message validation begins only at the selected complete schema.

The current v6 codec ceilings are exactly 256KiB for the final Base64 frame and 1MiB for decompressed JSON. The static Chat `body` field ceiling is 192 × 1024 JavaScript string/UTF-16 code units. No `MAX_CHAT_MESSAGE_BYTES`, `isChatMessageWithinBudget`, `isChatUserWithinBudget`, `utf8ByteLength`, or equivalent complete-object helper sits before, after, or beside those owners.

Alternative rejected: move compressed-frame safety into message schemas. A message schema cannot safely inspect a value until frame decoding has completed, so this would remove the resource boundary needed to reach schema parsing.

### 5. PeerLeave owns remote leave classification

Artico peer departure is the only remote leave input. When the last current physical source for an accepted `presenceId` leaves, Session retains that logical presence in the online snapshot and starts exactly one five-second pending-leave deadline. Duplicate physical-leave facts neither extend the deadline nor emit a notice. A valid SESSION that rebinds the same `presenceId`, `user.id`, and `joinedAt` before expiry cancels the pending leave and changes no membership or notice.

If no current source has rebound when the deadline expires, Session removes that presence. It emits one observer-local leave only when the user transitions from at least one active or grace-preserved presence to zero; another active or pending presence for that user suppresses the leave. A new physical source or a different presence does not resurrect an expired generation. Pending leave state is Runtime-owned lifecycle state, not peer wire or a durable final-end transaction.

Alternative rejected: remove `SessionEndMessage` and apply PeerLeave immediately. That makes ordinary transport replacement flicker offline/online and produces false leave/join notices.

### 6. Final release has no end transaction

Local domain release retains the existing page-owned five-second Lifecycle grace and current local cleanup. It removes the local active-generation authority and physically leaves the Chat/World rooms without producing a Chat end frame. There is no in-flight end, pending-end retry, settled-cleanup record, end-send settlement, observer end handler, or end-specific live-message gate. Release fencing remains only for the current local release operation and disappears with its owned state.

Alternative rejected: retain private final-end persistence while deleting only the wire variant. Without an end frame, those records and gates own no externally observable fact and only prolong physical departure.

### 7. v6 is one clean current generation

`ChatRoomMessage` is exactly `SessionMessage | ChatMessage | HistoryMessagesPull | HistoryMessagesPush`. The strict Chat schema rejects `session-end` as an unknown type. Both Chat and World select v6 physical namespace inputs so no v1-v5 peer shares membership or payload traffic with the current presence and capacity model. No decoder alias, dual publication, bridge, translator, fallback, or capability negotiation exists.

Every retained accepted payload preserves its current field structure. The v6 body/codec limits replace the v5 capacity values in place. The origin message database and version remain unchanged; obsolete private final-end records are deleted rather than migrated or interpreted.

### 8. Blob ids are editor-session locators, not protocol values

Image insertion generates one opaque id with `crypto.randomUUID()`, stores the compressed Blob in an editor-owned session-only `Map<string, Blob>`, and writes exact `![Image](blob:<id>)` into the textarea. The editor creates no object URL. At send, it resolves the currently referenced ids and converts their Blobs to data URLs in a temporary candidate before that candidate reaches the unified outbound Schema boundary and codec. Only the resulting data URLs may enter wire, History, or persistence.

Missing ids, Blob conversion failure, Schema failure, or codec failure reject the entire send and preserve the current draft. Successful older asynchronous work must not clear edits made after that send started, but this contract requires only that result and no particular generation-fence abstraction. Final-reference removal, explicit clear, successful send when no longer referenced, and unmount delete the relevant map entries. No object URL, persistence, fallback, compatibility path, compensation state, or additional lifecycle framework exists.

## Risks / Trade-offs

- [A callback is hidden inside a schema pipeline] -> Ban every callback/custom/transform API and add residue controls over the full protocol schema graph and local-load schema.
- [An unsupported former rule is assumed to remain enforced] -> Name the removed byte, cross-field, time, URL, uniqueness, reference, and record-identity checks explicitly and delete their rejection tests.
- [A locally produced invalid typed value reaches the outbound boundary] -> Parse it once through the same pure static Schema before encode/persistence; add no producer-specific validation.
- [A previously enforced rule is unsupported by the schema API] -> Remove the rule and its tests exactly as authorized; do not retain a fallback or imply the rule remains enforced.
- [Manually corrupted local rows disappear from results] -> Discard before projection and preserve all valid rows; do not repair, coerce, migrate, or surface a Toast.
- [A transport replacement looks like a user departure] -> Keep the accepted presence online for exactly five seconds and cancel only on a valid same-presence rebind.
- [Two physical sources or presences belong to one user] -> Expire only the affected presence and emit leave only on the user's final active-or-pending transition to zero.
- [An older client would still send `session-end` or use v5 capacity] -> Isolate v6 Chat and World namespaces and retain no compatibility decoder or capacity fallback.

## Migration Plan

1. Land the corrected cumulative docs authority, declarative schema/type refactor, History Pull/Push rename, three boundary integrations, complete-object guard deletion, editor Blob-id replacement, SessionEnd deletion, PeerLeave grace, v6 namespace cut, and duplicate-path deletion on the existing requirement branch and Draft PR.
2. Delete obsolete final-end and complete-object guard state plus all v1-v5 compatibility inputs in the same exact; no data migration or cross-version bridge exists.
3. Obtain fresh architecture-first review of the complete branch diff and verify all final gates on one exact.
4. Roll back by reverting the complete requirement PR; the unchanged origin database requires no separate reversal.
