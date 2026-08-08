## 1. Make Schemas The Protocol Data Authority

- [ ] 1.1 Define `ChatUser` and `ChatSession` from their Session schemas and move every supported user/session constraint into those schema pipelines.
- [ ] 1.2 Define HLC, mention, SESSION/END, text, reaction, History, Chat-message, and closed Chat-room types from their owning schemas; make the complete explicit-`now` Chat schema own all supported byte, range, time, uniqueness, and reference constraints.
- [ ] 1.3 Define `ChatSite` and `WorldRoomMessage` from their owning schemas and make the complete World schema own supported user-size, origin-only, and unique-site constraints.
- [ ] 1.4 Remove handwritten protocol interfaces/unions, output casts, standalone parse/check/boolean validators, duplicate structural aliases, and their public exports; keep only schema-inferred data types, schemas, limits/constants, and codec surfaces reachable from `src/protocol/index.ts`.

## 2. Enforce Exactly Two Validation Boundaries

- [ ] 2.1 At peer receive, select one complete Chat or World schema from trusted room context, supply explicit `now`, safe-parse the decoded `unknown` once, and discard rejection before any typed event or user-visible feedback.
- [ ] 2.2 At local persistence load, compose the complete protocol schema into the local record schema, parse each unknown database item once, and omit rejected/corrupted rows from every result and projection with no Toast.
- [ ] 2.3 Delete protocol parsing and manual message-property/resource checks from local identity/message production, outbound send, persistence write, History supply, HLC adoption, and downstream Session/History/intermediate Runtime consumption.
- [ ] 2.4 Preserve non-protocol authorization, ownership, lifecycle, queue, and scheduling decisions plus bounded codec representation mechanics without letting any of them recreate protocol validation; delete any protocol rule unsupported by the installed schema API rather than adding a fallback.

## 3. Replace Regression Coverage

- [ ] 3.1 Prove every exported protocol data type is inferred from its owning schema and add residue controls rejecting handwritten duplicate declarations, validator helpers, output casts, and forbidden validator exports.
- [ ] 3.2 Prove complete Chat and World schemas directly accept/reject all retained strict-key, union, field, byte, mention-range, HLC-time, origin, uniqueness, and History-reference cases without post-parse predicates.
- [ ] 3.3 Prove one invalid peer value and one manually corrupted local row are each discarded at their sole boundary, change no Runtime/page state, and produce no Toast or other user-visible feedback.
- [ ] 3.4 Prove locally produced/stored/supplied/sent typed values are not protocol-validated and that schema-accepted receive/load values are not revalidated downstream.
- [ ] 3.5 Prove current v4 message structures, namespaces, canonical accepted bytes, codec behavior, storage version/format, and all non-validation product behavior remain unchanged.

## 4. Delivery Gates

- [ ] 4.1 Pass focused protocol/Wire/MessageStore/Session/History regressions, the complete source suite, typecheck, lint, format, and Chrome/Firefox production builds on one exact.
- [ ] 4.2 Pass strict OpenSpec validation, OpenSpec Doctor, artifact status, schema/type/validator residue scans, diff checks, exact identity, and clean-worktree gates.
- [ ] 4.3 Publish the complete requirement through only `refactor/schema-first-protocol-validation` and one Draft PR based on `develop`; obtain fresh architecture-first Inspector review of the complete branch diff and close every finding on the same branch/PR.
- [ ] 4.4 Record any performed or unavailable browser behavior verification truthfully as non-blocking; do not route QA, QC, or UX unless the Owner explicitly requests that role, and require final exact identity plus CI before Ready/merge after acceptance.
