## 1. Make Schemas The Protocol Data Authority

- [x] 1.1 Define `ChatUser` and `ChatSession` from static declarative Session schemas and retain only built-in structural/field constraints.
- [x] 1.2 Define HLC, mention, SESSION, text, reaction, History Pull/Push, Chat-message, and closed Chat-room types from static declarative owning schemas; rename Request/Response types and schemas to Pull/Push and delete the old symbols without aliases.
- [x] 1.3 Define `ChatSite` and `WorldRoomMessage` from static declarative owning schemas with no callback-based origin, uniqueness, or whole-value checks.
- [ ] 1.4 Remove handwritten protocol interfaces/unions, output casts, standalone parse/check/boolean validators including the complete-object budget helpers, schema factories, duplicate structural aliases, and their public exports; keep only schema-inferred data types, static declarative schemas, limits/constants, and codec surfaces reachable from `src/protocol/index.ts`.
- [x] 1.5 Remove every `v.check`, `v.partialCheck`, `v.rawCheck`, `v.custom`, `v.transform`, user callback, and equivalent executable predicate/transform from protocol and local-load schema graphs; do not replace them with renamed or caller-side JavaScript.
- [x] 1.6 Delete `SessionEndMessage`, `SessionEndMessageSchema`, their exports and union member, every `session-end` fixture, and every compatibility alias; the strict Chat schema SHALL reject `session-end` as unknown.

## 2. Enforce Exactly Three Validation Boundaries

- [x] 2.1 At peer receive, select one static complete Chat or World schema from trusted room context, safe-parse the decoded `unknown` once, and discard rejection before any typed event or user-visible feedback.
- [ ] 2.2 At outbound send, parse each complete typed protocol value once through the same selected static Schema before codec encoding and persistence write; reject without sending or persisting when it fails.
- [x] 2.3 At local persistence load, compose the protocol child schema into a declarative local record schema, parse each unknown database item once, and omit declaratively rejected rows from every result and projection with no Toast.
- [ ] 2.4 Delete protocol parsing, `MAX_CHAT_MESSAGE_BYTES`, `isChatMessageWithinBudget`, `isChatUserWithinBudget`, `utf8ByteLength`, and every manual message-property/resource check and defensive drop branch from local identity/message production before the outbound boundary, persistence write after it, History supply, HLC adoption, and downstream Session/History/intermediate Runtime consumption.
- [ ] 2.5 Preserve non-protocol authorization, ownership, lifecycle, queue, and scheduling decisions plus the codec's 256KiB final-frame and 1MiB decompressed representation mechanics without letting any of them recreate protocol validation; omit whole-value bytes, cross-field ranges, HLC-now, URL-origin, uniqueness, reference, and record-identity rules that declarative schemas cannot express.
- [ ] 2.6 Keep exact `![Image](blob:<id>)` locators backed only by an editor-session `Map<string, Blob>` with `crypto.randomUUID()` ids; resolve them to data URLs before the outbound Schema boundary, create no object URL, preserve the draft and newer edits on failure or stale async completion, delete entries at the specified draft lifecycle boundaries, and allow neither locator nor map into wire, History, or persistence.

## 3. Replace Final End With PeerLeave Grace

- [x] 3.1 Make the last physical source loss for a bound presence start one five-second Session-owned grace while retaining that presence in every online snapshot.
- [x] 3.2 Cancel only the matching pending leave when a valid SESSION rebinds the same `presenceId`, `user.id`, and `joinedAt` before expiry; emit no leave or join and fence the stale deadline.
- [x] 3.3 On expiry, remove only that presence and persist one observer-local leave only when the user has no other active or grace-preserved presence; duplicate leave facts and multi-source loss SHALL remain idempotent.
- [x] 3.4 Delete final-end persistence records, transitions, send/receive handlers, retry/settlement/cleanup effects, restore paths, and end-specific allocation/send/release gates. Physical Chat/World departure SHALL not wait for an end frame.
- [x] 3.5 Advance both Chat and World room namespaces to v6 and delete every v1-v5 room input, bridge, alias, fallback, dual publication, or compatibility branch.

## 4. Replace Regression Coverage

- [ ] 4.1 Prove every exported protocol data type is inferred from its owning schema and mechanically update existing residue controls to reject handwritten duplicate declarations, validator and complete-object budget helpers, schema factories, callback/custom/transform actions, output casts, old History Request/Response names, `SessionEndMessage`, and forbidden validator exports; add no new test case.
- [x] 4.2 Prove static Chat, World, and local-record schemas directly accept/reject only retained declarative strict-key, union, primitive, safe-integer, field, tuple, and array cases, including complete `session-end` rejection.
- [ ] 4.3 Prove values that violate only removed whole-value byte, mention/body, HLC-now, origin-only, uniqueness, History-reference, or local-record identity rules are not rejected by a hidden fallback after the object-budget call chains are deleted; mechanically update existing expectations only.
- [x] 4.4 Prove one declaratively invalid peer value and one declaratively invalid local row are each discarded at their sole boundary, change no Runtime/page state, and produce no Toast or other user-visible feedback.
- [ ] 4.5 Mechanically update the existing outbound-path expectation so typed values use the same complete static Schema exactly once and producers/suppliers plus schema-accepted receive/send/load values are not revalidated downstream; add no new test case.
- [x] 4.6 Prove v6 Chat/World namespace isolation, retained payload fields, 192 × 1024-code-unit body/256KiB final-frame/1MiB decompressed limits, unchanged origin storage version/format, and Pull/Push-only public History symbols through existing expectations; add no new test case.
- [x] 4.7 Prove online display throughout PeerLeave grace, same-presence cancellation without notice, stale-deadline fencing, expiry removal, multi-source/multi-presence user counting, exactly-once final-user leave, and local release without any end transaction.

## 5. Delivery Gates

- [ ] 5.1 Pass focused protocol/Wire/MessageStore/Session/History/Connection regressions, the complete source suite, typecheck, lint, format, and Chrome/Firefox production builds on one replacement implementation exact.
- [ ] 5.2 Pass strict OpenSpec validation, OpenSpec Doctor, artifact status, schema/type/validator/object-budget/final-end/Blob-locator residue scans, diff checks, exact identity, and clean-worktree gates on that exact.
- [ ] 5.3 Publish the cumulative v6 requirement through only `docs/increase-message-capacity` and Draft PR #125 based on `develop`; obtain fresh architecture-first Inspector review of the complete branch diff and close every finding on the same branch/PR.
- [x] 5.4 Record any performed or unavailable browser behavior verification truthfully as non-blocking; do not route QA, QC, or UX unless the Owner explicitly requests that role, and require final exact identity plus CI before Ready/merge after acceptance.
