## 1. Freeze The Final Values-Only Contract

- [x] 1.1 Record the exact final message, wire, decoded JSON, and History no-cumulative-limit contract plus every explicitly unchanged boundary.
- [x] 1.2 Exclude Blob/editor lifecycle, schema/protocol/History structure, compatibility, migration, fragmentation, fallback, guards beyond the exact local user Text Footer preflight, new tests, and new abstractions.

## 2. Apply The Final Values

- [x] 2.1 Set `MAX_CHAT_EVENT_BYTES = 192 * 1024` at the static Text schema and the sole local user Text Footer preflight, `MAX_WIRE_BYTES = 256 * 1024`, and `MAX_DECODED_JSON_BYTES = 1024 * 1024` at their codec owners; add no other authored-message resource guard.
- [x] 2.2 Ensure History has no session-wide cumulative message-count or canonical-content-byte constants, options, counters, truncation, fail-closed branches, or substitute aggregate guard, without changing History structure.
- [x] 2.3 Before local user Text dispatch, compute `getTextByteSize(JSON.stringify({ body, mentions }))`; when it exceeds `192KiB`, show `Message size cannot exceed 192KiB.`, preserve the draft, and perform no Schema parse, wire send, or persistence write. Keep the 500-unit text input limit, `30KiB` image target, and all other editor behavior unchanged.

## 3. Synchronize Existing Evidence

- [x] 3.1 Mechanically align existing exact-value, codec-limit, declarative field-ceiling, and user-copy expectations with the final contract; add no Footer-preflight case, other test case, or test abstraction.
- [x] 3.2 Mechanically align only existing History fixtures and expectations with the no-session-wide-cumulative-limit contract; add no test case or helper.
- [x] 3.3 Synchronize this delta and the currently active OpenSpec numeric, aggregate, and timeout wording without expanding product scope.

## 4. Verification And Delivery

- [x] 4.1 Pass the existing focused protocol, codec, footer, History, Wire, and Delivery suites plus the complete 843-test suite, typecheck, lint, format, Chrome/Firefox builds, strict OpenSpec validation, Doctor, residue, diff, identity, and clean-worktree gates on one exact.
- [ ] 4.2 Obtain fresh source/product review and exact-head CI for the single values-only implementation candidate before any later delivery decision.
