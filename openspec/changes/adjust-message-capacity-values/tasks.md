## 1. Freeze The Values-Only Contract

- [x] 1.1 Record the exact old-to-new message, wire, decoded JSON, and History cumulative values plus every explicitly unchanged boundary.
- [x] 1.2 Exclude Blob/editor lifecycle, schema/protocol/History structure, compatibility, migration, fragmentation, fallback, additional guards, new tests, and new abstractions.

## 2. Replace Existing Values

- [ ] 2.1 Change `MAX_CHAT_EVENT_BYTES` from `48 * 1024` to `192 * 1024`, `MAX_WIRE_BYTES` from `64 * 1024` to `256 * 1024`, and `MAX_DECODED_JSON_BYTES` from `256 * 1024` to `1024 * 1024` without changing their existing owners or call paths.
- [ ] 2.2 Delete the History-session `10,000`-message/`8MiB` constants, options, counters, truncation, and fail-closed branches without adding a replacement cumulative guard or changing History structure.
- [ ] 2.3 Mechanically change the existing `48KiB` footer warning to `192KiB`; keep the 500-unit text limit, `30KiB` image target, and editor behavior unchanged.

## 3. Synchronize Existing Evidence

- [ ] 3.1 Mechanically update only existing exact-value, codec-limit, field-ceiling, and footer expectations made stale by the three substitutions; add no test case or test abstraction.
- [ ] 3.2 Delete or mechanically align only existing History cumulative-budget fixtures and expectations made obsolete by removing `10,000`/`8MiB`; add no replacement test case or helper.
- [x] 3.3 Synchronize this delta and the currently active OpenSpec numeric/aggregate wording without importing any withdrawn PR #125 design.

## 4. Verification And Delivery

- [ ] 4.1 Pass the existing focused protocol, codec, footer, History, Wire, and Delivery suites plus the complete 843-test suite, typecheck, lint, format, Chrome/Firefox builds, strict OpenSpec validation, Doctor, residue, diff, identity, and clean-worktree gates on one exact.
- [ ] 4.2 Obtain fresh source/product review and exact-head CI for the single values-only implementation candidate before any later delivery decision.
