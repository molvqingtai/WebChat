## 1. Make Schemas The Protocol Data Authority

- [ ] 1.1 Define `ChatUser` and `ChatSession` from static declarative Session schemas and retain only built-in structural/field constraints.
- [ ] 1.2 Define HLC, mention, SESSION/END, text, reaction, History Pull/Push, Chat-message, and closed Chat-room types from static declarative owning schemas; rename Request/Response types and schemas to Pull/Push and delete the old symbols without aliases.
- [ ] 1.3 Define `ChatSite` and `WorldRoomMessage` from static declarative owning schemas with no callback-based origin, uniqueness, or whole-value checks.
- [ ] 1.4 Remove handwritten protocol interfaces/unions, output casts, standalone parse/check/boolean validators, schema factories, duplicate structural aliases, and their public exports; keep only schema-inferred data types, static declarative schemas, limits/constants, and codec surfaces reachable from `src/protocol/index.ts`.
- [ ] 1.5 Remove every `v.check`, `v.partialCheck`, `v.rawCheck`, `v.custom`, `v.transform`, user callback, and equivalent executable predicate/transform from protocol and local-load schema graphs; do not replace them with renamed or caller-side JavaScript.

## 2. Enforce Exactly Two Validation Boundaries

- [ ] 2.1 At peer receive, select one static complete Chat or World schema from trusted room context, safe-parse the decoded `unknown` once, and discard rejection before any typed event or user-visible feedback.
- [ ] 2.2 At local persistence load, compose the protocol child schema into a declarative local record schema, parse each unknown database item once, and omit declaratively rejected rows from every result and projection with no Toast.
- [ ] 2.3 Delete protocol parsing and manual message-property/resource checks from local identity/message production, outbound send, persistence write, History supply, HLC adoption, and downstream Session/History/intermediate Runtime consumption.
- [ ] 2.4 Preserve non-protocol authorization, ownership, lifecycle, queue, and scheduling decisions plus bounded codec representation mechanics without letting any of them recreate protocol validation; omit whole-value bytes, cross-field ranges, HLC-now, URL-origin, uniqueness, reference, and record-identity rules that declarative schemas cannot express.

## 3. Replace Regression Coverage

- [ ] 3.1 Prove every exported protocol data type is inferred from its owning schema and add residue controls rejecting handwritten duplicate declarations, validator helpers, schema factories, callback/custom/transform actions, output casts, old History Request/Response names, and forbidden validator exports.
- [ ] 3.2 Prove static Chat, World, and local-record schemas directly accept/reject only retained declarative strict-key, union, primitive, safe-integer, field, tuple, and array cases.
- [ ] 3.3 Prove values that violate only removed whole-value byte, mention/body, HLC-now, origin-only, uniqueness, History-reference, or local-record identity rules are not rejected by a hidden fallback.
- [ ] 3.4 Prove one declaratively invalid peer value and one declaratively invalid local row are each discarded at their sole boundary, change no Runtime/page state, and produce no Toast or other user-visible feedback.
- [ ] 3.5 Prove locally produced/stored/supplied/sent typed values are not protocol-validated and that schema-accepted receive/load values are not revalidated downstream.
- [ ] 3.6 Prove current v4 wire structures, literals, namespaces, canonical encoded bytes, codec behavior, storage version/format, and all non-validation product behavior remain unchanged while public History symbols use only Pull/Push names.

## 4. Delivery Gates

- [ ] 4.1 Pass focused protocol/Wire/MessageStore/Session/History regressions, the complete source suite, typecheck, lint, format, and Chrome/Firefox production builds on one exact.
- [ ] 4.2 Pass strict OpenSpec validation, OpenSpec Doctor, artifact status, schema/type/validator residue scans, diff checks, exact identity, and clean-worktree gates.
- [ ] 4.3 Publish the complete requirement through only `refactor/schema-first-protocol-validation` and one Draft PR based on `develop`; obtain fresh architecture-first Inspector review of the complete branch diff and close every finding on the same branch/PR.
- [ ] 4.4 Record any performed or unavailable browser behavior verification truthfully as non-blocking; do not route QA, QC, or UX unless the Owner explicitly requests that role, and require final exact identity plus CI before Ready/merge after acceptance.
