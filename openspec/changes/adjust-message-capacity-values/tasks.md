## 1. Freeze The Final Values-Only Contract

- [x] 1.1 Record the exact final message, wire, decoded JSON, and History no-cumulative-limit contract plus every explicitly unchanged boundary.
- [x] 1.2 Exclude Blob/editor lifecycle, schema/protocol/History structure, compatibility, migration, fragmentation, fallback, additional guards, new tests, and new abstractions.

## 2. Apply The Final Values

- [ ] 2.1 Set `MAX_CHAT_EVENT_BYTES = 192 * 1024` at the static Text schema, `MAX_WIRE_BYTES = 256 * 1024`, and `MAX_DECODED_JSON_BYTES = 1024 * 1024` at their codec owners; remove the producer-side/footer whole-value authored-message preflight without adding another validation path.
- [ ] 2.2 Ensure History has no session-wide cumulative message-count or canonical-content-byte constants, options, counters, truncation, fail-closed branches, or substitute aggregate guard, without changing History structure.
- [ ] 2.3 Remove the footer whole-value size warning/preflight; keep the 500-unit text input limit, `30KiB` image target, draft/send lifecycle, and other editor behavior unchanged.

## 3. Synchronize Existing Evidence

- [ ] 3.1 Mechanically align only existing exact-value, codec-limit, declarative field-ceiling, and removed-footer-preflight expectations with the final contract; add no test case or test abstraction.
- [ ] 3.2 Mechanically align only existing History fixtures and expectations with the no-session-wide-cumulative-limit contract; add no test case or helper.
- [x] 3.3 Synchronize this delta and the currently active OpenSpec numeric, aggregate, and timeout wording without expanding product scope.

## 4. Verification And Delivery

- [ ] 4.1 Pass the existing focused protocol, codec, footer, History, Wire, and Delivery suites plus the complete 843-test suite, typecheck, lint, format, Chrome/Firefox builds, strict OpenSpec validation, Doctor, residue, diff, identity, and clean-worktree gates on one exact.
- [ ] 4.2 Obtain fresh source/product review and exact-head CI for the single values-only implementation candidate before any later delivery decision.
