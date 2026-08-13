## 1. Make Schemas The Protocol Data Authority

- [x] 1.1 Define `ChatUser` and `ChatSession` from static declarative Session schemas and retain only built-in structural/field constraints.
- [x] 1.2 Define HLC, mention, SESSION, text, reaction, History Pull/Push, Chat-message, and closed Chat-room types from static declarative owning schemas; rename Request/Response types and schemas to Pull/Push and delete the old symbols without aliases.
- [x] 1.3 Define `ChatSite` and `WorldRoomMessage` from static declarative owning schemas with no callback-based origin, uniqueness, or whole-value checks.
- [x] 1.4 Remove handwritten protocol interfaces/unions, output casts, standalone parse/check/boolean validators, schema factories, duplicate structural aliases, and their public exports; keep only schema-inferred data types, static declarative schemas, limits/constants, and codec surfaces reachable from `src/protocol/index.ts`.
- [x] 1.5 Remove every `v.check`, `v.partialCheck`, `v.rawCheck`, `v.custom`, `v.transform`, user callback, and equivalent executable predicate/transform from protocol and local-load schema graphs; do not replace them with renamed or caller-side JavaScript.
- [x] 1.6 Delete `SessionEndMessage`, `SessionEndMessageSchema`, their exports and union member, every `session-end` fixture, and every compatibility alias; the strict Chat schema SHALL reject `session-end` as unknown.

## 2. Enforce Exactly Three Validation Boundaries

- [x] 2.1 At peer receive, select one static complete Chat or World schema from trusted room context, safe-parse the decoded `unknown` once, and discard rejection before any typed event or user-visible feedback.
- [ ] 2.2 At locally authored `ChatMessage` delivery, parse the complete message once through `ChatMessageSchema` before both local persistence and peer codec encoding/send; reject without either side effect when it fails.
- [x] 2.3 At local persistence load, compose `ChatMessageSchema` into a declarative local record schema, parse each unknown database item once, and omit declaratively rejected rows from every result and projection with no Toast.
- [ ] 2.4 Delete protocol parsing and manual message-property/resource checks from SESSION, History Pull/Push, World publication, `ChatMessage` allocation/production before its delivery boundary, Footer, persistence write and codec encoding after the boundary, HLC adoption, and downstream Session/History/intermediate Runtime consumption.
- [ ] 2.5 Preserve non-protocol authorization, ownership, lifecycle, queue, and scheduling decisions plus bounded codec representation mechanics without letting any of them recreate protocol validation; omit whole-value bytes, cross-field ranges, HLC-now, URL-origin, uniqueness, reference, and record-identity rules that declarative schemas cannot express.

## 3. Replace Final End With PeerLeave Grace

- [x] 3.1 Make the last physical source loss for a bound presence start one five-second Session-owned grace while retaining that presence in every online snapshot.
- [x] 3.2 Cancel only the matching pending leave when a valid SESSION rebinds the same `presenceId`, `user.id`, and `joinedAt` before expiry; emit no leave or join and fence the stale deadline.
- [x] 3.3 On expiry, remove only that presence and persist one observer-local leave only when the user has no other active or grace-preserved presence; duplicate leave facts and multi-source loss SHALL remain idempotent.
- [x] 3.4 Delete final-end persistence records, transitions, send/receive handlers, retry/settlement/cleanup effects, restore paths, and end-specific allocation/send/release gates. Physical Chat/World departure SHALL not wait for an end frame.
- [x] 3.5 Advance both Chat and World room namespaces to v5 and delete every v1-v4 room input, bridge, alias, fallback, dual publication, or compatibility branch.

## 4. Replace Regression Coverage

- [x] 4.1 Prove every exported protocol data type is inferred from its owning schema and add residue controls rejecting handwritten duplicate declarations, validator helpers, schema factories, callback/custom/transform actions, output casts, old History Request/Response names, `SessionEndMessage`, and forbidden validator exports.
- [x] 4.2 Prove static Chat, World, and local-record schemas directly accept/reject only retained declarative strict-key, union, primitive, safe-integer, field, tuple, and array cases, including complete `session-end` rejection.
- [x] 4.3 Prove values that violate only removed whole-value byte, mention/body, HLC-now, origin-only, uniqueness, History-reference, or local-record identity rules are not rejected by a hidden fallback.
- [x] 4.4 Prove one declaratively invalid peer value and one declaratively invalid local row are each discarded at their sole boundary, change no Runtime/page state, and produce no Toast or other user-visible feedback.
- [ ] 4.5 Mechanically update the existing local-`ChatMessage` expectation so a complete locally authored message uses `ChatMessageSchema` exactly once before both local persistence and peer codec encoding/send, rejection causes neither side effect, and allocation/producers/Footer plus schema-accepted peer-receive/`ChatMessage`/local-load values are not revalidated downstream; add no new test case or test abstraction.
- [x] 4.6 Prove v5 Chat/World namespace isolation, retained current payload/codec behavior, unchanged origin storage version/format, and Pull/Push-only public History symbols.
- [x] 4.7 Prove online display throughout PeerLeave grace, same-presence cancellation without notice, stale-deadline fencing, expiry removal, multi-source/multi-presence user counting, exactly-once final-user leave, and local release without any end transaction.

## 5. Delivery Gates

- [ ] 5.1 Pass focused protocol/Wire/MessageStore/Session/History/Connection regressions, the complete source suite, typecheck, lint, format, and Chrome/Firefox production builds on one replacement exact.
- [ ] 5.2 Pass strict OpenSpec validation, OpenSpec Doctor, artifact status, schema/type/validator/final-end residue scans, diff checks, exact identity, and clean-worktree gates on that exact.
- [ ] 5.3 Publish the complete current requirement through Draft PR #126, obtain fresh architecture-first Inspector review of the cumulative branch diff, and close every finding on the same branch/PR.
- [x] 5.4 Record any performed or unavailable browser behavior verification truthfully as non-blocking; do not route QA, QC, or UX unless the Owner explicitly requests that role, and require final exact identity plus CI before Ready/merge after acceptance.
