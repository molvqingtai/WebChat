## Context

See `proposal.md` for motivation. The current public protocol defines message interfaces/unions before their Valibot schemas, then completes validation through exported predicates and repeated caller checks. The repeated checks currently appear at peer receive, local record load, local identity/message production, send, clock adoption, History supply, and intermediate Runtime consumption.

The accepted boundary is narrower: this change covers only peer-protocol data owned by `src/protocol`. Protocol validation exists only at peer receive and local persistence load, uses schemas exclusively, and silently discards failures without a Toast. Current v4 wire values, physical namespaces, codec representation, and persisted record format do not change.

## Goals / Non-Goals

**Goals:**

- Establish one schema-owned definition graph for every public protocol data type.
- Express every retained structural, resource, and cross-field protocol rule inside the complete schema pipeline.
- Give peer receive and local persistence load exclusive ownership of protocol parsing.
- Remove duplicate protocol checks and partially validated values from every other path.

**Non-Goals:**

- Changing protocol fields, message types, v4 namespaces, canonical bytes, History behavior, persistence format, or UI.
- Applying schema-first rules to extension page/content/background/offscreen control-plane messages.
- Removing non-protocol authorization, ownership, lifecycle, queue, or scheduling decisions.
- Adding a dependency, compatibility path, data migration, or user-facing validation feedback.

## Decisions

### 1. The schema graph defines the public data graph

`Session` owns the schemas for `ChatUser` and `ChatSession`; `ChatRoom` owns `HLC`, mention, SESSION/END, text, reaction, History, Chat-message, and closed Chat-room schemas; `WorldRoom` owns `ChatSite` and the complete World snapshot schema. Parent schemas compose exported child schemas rather than copying their fields into a separate type declaration.

Every public protocol data type is inferred from its owning schema output. This includes leaf values, variants, and unions. Constants may remain ordinary values, and `WireCodec`, `NativeWireCodec`, `WireCodecError`, and public limits remain ordinary non-message API declarations. Handwritten interfaces/unions, type assertions that manufacture schema output, and aliases duplicating a schema-owned structure are removed.

Alternative rejected: retain interfaces as documentation and test them against schemas. That still leaves two editable facts and cannot prevent drift.

### 2. Complete schemas own supported cross-field and contextual rules

Whole-value byte limits, mention ranges relative to `body`, exact World origins, unique World sites, unique History users, History message-to-user references, and similar relationships are schema pipeline actions on the smallest complete value that owns all required fields. Reusable child schemas own only constraints they can decide independently.

The complete Chat schema is constructed with explicit receiver `now` so future-HLC rejection stays inside the schema without a hidden clock. Its inferred output remains the public Chat type. No `is*`, `check*`, or post-parse `parse*` helper may finish validation after schema parsing. If the installed schema API cannot express a rule, the rule and its validation test are deleted; a custom caller predicate is not an alternative.

Alternative rejected: perform a structural schema parse and then run semantic validators. That is the current split authority the change removes.

### 3. Only peer receive and local load parse protocol values

At peer receive, Wire first uses trusted transport context to select the World or Chat protocol, supplies explicit `now` where required, and safe-parses the decoded `unknown` through that complete schema. Failure emits no typed message and reaches no Session, History, persistence, notification, unread, or page behavior. It creates no Toast.

At local load, the local record schema composes the authoritative protocol child schema and all local-only record fields/relationships needed to accept one database item. Each unknown stored item is parsed once as it enters the typed query result. Failure omits the item from the returned result and every projection, with no Toast.

Local producers, outbound send, persistence write, History supply, clock adoption, and downstream Session/History consumers trust their TypeScript inputs and do not parse or inspect message fields for protocol validity. Existing non-protocol identity authorization, operation ownership, lifecycle fencing, and bounded scheduling remain where they are.

Alternative rejected: validate before persistence or send as defense in depth. The Owner selected two exclusive validation boundaries; extra checks would recreate path-dependent behavior.

### 4. Codec safety is representation work, not a third message validator

`NativeWireCodec` keeps strict Base64 canonicality, bounded deflate streaming, fatal UTF-8, JSON decode/encode, and encoded/decompressed resource ceilings because those steps are required to safely produce or consume a frame. It returns decoded `unknown` and never inspects a message discriminator, property, relationship, or protocol semantic. Message validation begins only at the selected complete schema.

Alternative rejected: move compressed-frame safety into message schemas. A message schema cannot safely inspect a value until frame decoding has completed, so this would remove the resource boundary needed to reach schema parsing.

### 5. The refactor is wire- and storage-neutral

Schema output for every accepted value remains structurally identical to the current v4 value. No field transform, default, strip, coercion, alias, namespace change, or compatibility branch is introduced. Stored record identity and database version remain unchanged; the load boundary only determines whether an unknown row becomes a typed result.

## Risks / Trade-offs

- [A schema action hides an old predicate inside a new name] -> Keep the action inside the exported owning schema pipeline, remove separately callable validation helpers, and prove callers use only complete schema parse results.
- [A contextual Chat schema is rebuilt for each parse] -> Keep construction pure and limited to the two validation boundaries; correctness and explicit clock ownership take priority over caching a schema with hidden time.
- [A locally produced invalid typed value reaches encode/send] -> This is intentional: producers do not validate protocol shape, and the receiving boundary is authoritative.
- [A previously enforced rule is unsupported by the schema API] -> Remove the rule and its tests exactly as authorized; do not retain a fallback or imply the rule remains enforced.
- [Manually corrupted local rows disappear from results] -> Discard before projection and preserve all valid rows; do not repair, coerce, migrate, or surface a Toast.

## Migration Plan

1. Land the docs authority, schema/type refactor, two boundary integrations, duplicate-check deletion, and replacement tests on one requirement branch and Draft PR.
2. Keep v4 wire namespaces, encoded values, and the database version unchanged; no compatibility or data migration step exists.
3. Obtain fresh architecture-first review of the complete branch diff and verify all final gates on one exact.
4. Roll back by reverting the complete requirement PR; no persisted-data conversion or cross-version bridge requires separate reversal.
