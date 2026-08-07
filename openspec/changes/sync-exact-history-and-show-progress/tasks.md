## 1. Replace The Public History Protocol

- [ ] 1.1 Replace `HistoryCursor`, `HistoryRequestMessage`, and `HistoryResponseMessage` with the exact `HistoryMessagesRequest` and `HistoryMessagesResponse` declarations, strict schemas, exports, and Chat union.
- [ ] 1.2 Enforce continuous non-negative page values, exact response user references, 64KiB frame limits, 100-message response pages, opaque message-ID elements, and strict old-type/key rejection.
- [ ] 1.3 Advance Chat and World room namespaces to v4, preserve non-History v3 payload bytes, and prove v1/v2/v3/v4 isolation with no fallback or dual publication.

## 2. Replace History Orchestration End To End

- [ ] 2.1 Delete the cursor/full-window requester/provider state machine and implement one outgoing requester attempt with a fixed 180-day ID snapshot, independent `syncId`, and paged inventory output.
- [ ] 2.2 Implement one incoming provider attempt that waits for the complete inventory, freezes its own 180-day record snapshot, filters the exact ID set, and streams recent-first missing-record pages with exact per-page authors.
- [ ] 2.3 Enforce phase-zero start, continuous ordering, explicit empty completion, identical replay idempotency, changed replay/gap/post-done rejection, 10,000-entry/8MiB phase budgets, the existing 10-second operational timeout, and source-local cancellation.
- [ ] 2.4 Preserve page-supplier `supplyId`/AbortSignal physical settlement, four-active/32-admitted/8KiB admission, dormant replacement isolation, and local-send-only provider progression without a peer ACK.
- [ ] 2.5 On leave, replacement, timeout, invalid input, supplier failure, local processing failure, or lifecycle cleanup, discard the complete attempt and make reconnect start a fresh `syncId` and current 180-day difference.

## 3. Settle Missing Records And Loading Feedback

- [ ] 3.1 Admit each response page atomically, process pages in one bounded serial queue, resolve every message through its exact user snapshot, and complete a final page only after every `insert-if-absent` settles.
- [ ] 3.2 Activate one attempt-owned loading state only after the first actual insertion, project exact copy `Syncing message history...` with no count or fixed duration to every current same-domain page, and give newly attached same-domain pages the current projection.
- [ ] 3.3 Dismiss only the same attempt's loading owner after final-page processing or cancellation, with no success conversion, minimum dwell, stale-owner effect, cross-domain effect, or impact on another Toast.
- [ ] 3.4 Keep empty/all-existing responses silent and preserve History exclusions from notifications, unread attention, system notices, remote-state inference, and History-specific success/error feedback.

## 4. Replace Regression Coverage And Remove Residue

- [ ] 4.1 Replace protocol fixtures and tests with exact new structures, limits, author-reference completeness, opaque-ID aggregate bounds, old-shape rejection, v4 isolation, and unchanged non-History bytes.
- [ ] 4.2 Replace History runtime tests with both directional flows, fixed 180-day snapshots, exact filtering, empty phases, ordering/replay/caps, supplier cancellation, local send semantics, response serialization, and fresh reconnect recomputation.
- [ ] 4.3 Prove live, multi-peer, and same-domain-page insert races; one activation per `syncId`; same-domain fan-out; new-page projection; terminal/cancellation dismissal; concurrent-owner isolation; and zero-insert silence through the real persistence boundary.
- [ ] 4.4 Delete old cursor/full-window implementation, tests, fixtures, names, room inputs, compatibility branches, body-request/ACK proposals, and behavior assertions rather than retaining them behind aliases or fallbacks.

## 5. Delivery Gates

- [ ] 5.1 Pass focused regressions, the complete source suite, typecheck, lint, format, Chrome/Firefox production builds, strict OpenSpec validation, OpenSpec Doctor, residue scans, diff, identity, and clean-worktree gates on one exact.
- [ ] 5.2 Publish the complete requirement through the single `perf/exact-history-sync` branch and one Draft PR based on `develop`; do not modify or reuse Draft PR #109.
- [ ] 5.3 Obtain fresh architecture-first Inspector review of the complete branch diff and close every finding on the same branch and PR.
- [ ] 5.4 Record any performed or unavailable browser behavior verification truthfully as non-blocking; do not route QA, QC, or UX unless the Owner explicitly requests that role.
- [ ] 5.5 After explicit Owner acceptance, update final OpenSpec/task truth and require final exact identity plus CI before Ready/merge.
