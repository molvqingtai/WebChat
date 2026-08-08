## Context

See `proposal.md` for motivation. The current public protocol defines message interfaces/unions before their Valibot schemas, then completes validation through exported predicates and repeated caller checks. The repeated checks currently appear at peer receive, local record load, local identity/message production, send, clock adoption, History supply, and intermediate Runtime consumption.

The accepted boundary is narrower: this change covers only peer-protocol data owned by `src/protocol`. Protocol validation exists only at peer receive and local persistence load, uses schemas exclusively, and silently discards failures without a Toast. Current v4 wire values, physical namespaces, codec representation, and persisted record format do not change.

## Goals / Non-Goals

**Goals:**

- Establish one schema-owned definition graph for every public protocol data type.
- Retain only protocol rules expressible through declarative Valibot primitives and combinators.
- Give peer receive and local persistence load exclusive ownership of protocol parsing.
- Remove duplicate protocol checks and partially validated values from every other path.

**Non-Goals:**

- Changing encoded protocol fields, wire variants/literals, v4 namespaces, canonical bytes, History behavior, persistence format, or UI; only the public History Request/Response symbols are renamed to Pull/Push.
- Applying schema-first rules to extension page/content/background/offscreen control-plane messages.
- Removing non-protocol authorization, ownership, lifecycle, queue, or scheduling decisions.
- Adding a dependency, compatibility path, data migration, or user-facing validation feedback.

## Decisions

### 1. The schema graph defines the public data graph

`Session` owns the schemas for `ChatUser` and `ChatSession`; `ChatRoom` owns `HLC`, mention, SESSION/END, text, reaction, History Pull/Push, Chat-message, and closed Chat-room schemas; `WorldRoom` owns `ChatSite` and the complete World snapshot schema. Parent schemas compose exported child schemas rather than copying their fields into a separate type declaration.

Every public protocol data type is inferred from its owning schema output. This includes leaf values, variants, and unions. Constants may remain ordinary values, and `WireCodec`, `NativeWireCodec`, `WireCodecError`, and public limits remain ordinary non-message API declarations. Handwritten interfaces/unions, type assertions that manufacture schema output, and aliases duplicating a schema-owned structure are removed.

The current History symbols are `HistoryMessagesPull`/`HistoryMessagesPullSchema` and `HistoryMessagesPush`/`HistoryMessagesPushSchema`. The old Request/Response symbols are deleted without aliases; the existing `history-messages-pull`/`history-messages-push` literals and encoded shapes do not change.

Alternative rejected: retain interfaces as documentation and test them against schemas. That still leaves two editable facts and cannot prevent drift.

### 2. Protocol schemas contain no executable validation logic

Protocol schemas use only declarative Valibot primitives and combinators such as strict objects, variants, literals, picklists, arrays, tuples, optionals, primitive types, and built-in length/value/integer actions. A pipeline remains declarative only when every member is a built-in declarative schema or action.

`v.check`, `v.partialCheck`, `v.rawCheck`, `v.custom`, `v.transform`, user-provided callbacks, and equivalent executable predicates or transforms are forbidden. The Chat and World schemas are static and receive no contextual `now`, clock, URL parser, byte counter, Set, reference map, or other JavaScript validation input. No `is*`, `check*`, schema factory, or post-parse helper may finish validation after parsing.

Whole-value canonical JSON byte size, mention ranges relative to `body`, future HLC relative to receiver time, origin-only URL semantics, uniqueness, History user/message reference completeness, and local record identity relationships are therefore not validated. Their former callback tests are deleted. Structural keys, discriminants, primitive types, safe non-negative integer shape, field/array ceilings, and other rules directly expressible by declarative built-ins remain.

Alternative rejected: hide a JavaScript callback inside `v.pipe` and call it schema-native. The callback is still handwritten validation and violates the pure-Schema boundary.

### 3. Only peer receive and local load parse protocol values

At peer receive, Wire first uses trusted transport context to select the static World or Chat protocol schema and safe-parses the decoded `unknown` once. Failure emits no typed message and reaches no Session, History, persistence, notification, unread, or page behavior. It creates no Toast.

At local load, the declarative local record schema composes the authoritative protocol child schema with its local-only structural fields. Each unknown stored item is parsed once as it enters the typed query result. Failure omits the item from the returned result and every projection, with no Toast. Database-key/message/user relationships that need a callback are not validated.

Local producers, outbound send, persistence write, History supply, clock adoption, and downstream Session/History consumers trust their TypeScript inputs and do not parse or inspect message fields for protocol validity. Existing non-protocol identity authorization, operation ownership, lifecycle fencing, and bounded scheduling remain where they are.

Alternative rejected: validate before persistence or send as defense in depth. The Owner selected two exclusive validation boundaries; extra checks would recreate path-dependent behavior.

### 4. Codec safety is representation work, not a third message validator

`NativeWireCodec` keeps strict Base64 canonicality, bounded deflate streaming, fatal UTF-8, JSON decode/encode, and encoded/decompressed resource ceilings because those steps are required to safely produce or consume a frame. It returns decoded `unknown` and never inspects a message discriminator, property, relationship, or protocol semantic. Message validation begins only at the selected complete schema.

Alternative rejected: move compressed-frame safety into message schemas. A message schema cannot safely inspect a value until frame decoding has completed, so this would remove the resource boundary needed to reach schema parsing.

### 5. The refactor is wire- and storage-neutral

Schema output for every accepted value remains structurally identical to the current v4 value. No field transform, default, strip, coercion, alias, namespace change, or compatibility branch is introduced. Stored record identity and database version remain unchanged; the load boundary only determines whether an unknown row becomes a typed result.

## Risks / Trade-offs

- [A callback is hidden inside a schema pipeline] -> Ban every callback/custom/transform API and add residue controls over the full protocol schema graph and local-load schema.
- [An unsupported former rule is assumed to remain enforced] -> Name the removed byte, cross-field, time, URL, uniqueness, reference, and record-identity checks explicitly and delete their rejection tests.
- [A locally produced invalid typed value reaches encode/send] -> This is intentional: producers do not validate protocol shape, and the receiving boundary is authoritative.
- [A previously enforced rule is unsupported by the schema API] -> Remove the rule and its tests exactly as authorized; do not retain a fallback or imply the rule remains enforced.
- [Manually corrupted local rows disappear from results] -> Discard before projection and preserve all valid rows; do not repair, coerce, migrate, or surface a Toast.

## Migration Plan

1. Land the corrected docs authority, declarative schema/type refactor, History Pull/Push rename, two boundary integrations, duplicate-check deletion, and replacement tests on one requirement branch and Draft PR.
2. Keep v4 wire namespaces, encoded values, and the database version unchanged; no compatibility or data migration step exists.
3. Obtain fresh architecture-first review of the complete branch diff and verify all final gates on one exact.
4. Roll back by reverting the complete requirement PR; no persisted-data conversion or cross-version bridge requires separate reversal.
