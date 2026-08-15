## 1. Replace The Public History Protocol

- [x] 1.1 Replace `HistoryCursor`, `HistoryRequestMessage`, and `HistoryResponseMessage` with the exact `HistoryMessagesPull` and `HistoryMessagesPush` declarations, strict declarative schemas, exports, and Chat union.
- [x] 1.2 Enforce declarative non-negative page values, 100-message Push pages, opaque message-ID elements, and strict old-type/key rejection; keep encoded/decompressed codec bounds separate and do not schema-validate user/message references.
- [ ] 1.3 Use current v5 Chat and World room namespaces, exclude `session-end`, and prove v1-v5 isolation with no fallback or dual publication.

## 2. Replace History Orchestration End To End

- [x] 2.1 Delete the cursor/full-window requester/provider state machine and make each accepted room connection trigger exactly one outgoing requester synchronization with a fixed 30-day ID snapshot, independent `syncId`, and paged inventory output.
- [x] 2.2 Bind the first valid incoming page zero as that connection's sole provider `syncId`, wait for the complete inventory, freeze one 30-day record snapshot, filter the exact ID set, and stream recent-first missing-record pages with exact per-page authors.
- [x] 2.3 Enforce phase-zero start, continuous ordering, explicit empty completion, active identical-replay idempotency, changed replay/gap/post-done rejection, no cumulative entry/byte phase budget, a fixed 10-second operational timeout whose accepted progress does not re-arm or replace the timer, source-local cancellation, and a constant-size terminal ID fence that rejects both same- and different-ID restarts.
- [x] 2.4 Preserve page-supplier `supplyId`/AbortSignal physical settlement, four-active/32-admitted/8KiB admission, dormant replacement isolation, and local-send-only provider progression without a peer ACK.
- [x] 2.5 On completion, timeout, invalid input, supplier failure, local processing failure, or cancellation, discard working State but retain that connection direction's terminal ID fence; clear all fences only on source replacement/domain release, and let the next room connection start one independent synchronization with no retry, resume, or prior progress.

## 3. Settle Missing Records And Loading Feedback

- [x] 3.1 Admit each response page atomically, process pages in one bounded serial queue, resolve every message through its exact user snapshot, and complete a final page only after every `insert-if-absent` settles.
- [x] 3.2 Activate one attempt-owned loading state only after the first actual insertion, project exact copy `Syncing message history...` with no count or fixed duration to every current same-domain page, and give newly attached same-domain pages the current projection.
- [x] 3.3 Dismiss only the same attempt's loading owner after final-page processing or cancellation, with no success conversion, minimum dwell, stale-owner effect, cross-domain effect, or impact on another Toast.
- [x] 3.4 Keep empty/all-existing responses silent and preserve History exclusions from notifications, unread attention, system notices, remote-state inference, and History-specific success/error feedback.

## 4. Replace Regression Coverage And Remove Residue

- [ ] 4.1 Replace protocol fixtures and tests with exact current structures, declarative limits, opaque-ID frame bounds, old-shape and `session-end` rejection, v5 isolation, retained payload/codec controls, and no callback-backed author-reference rejection.
- [x] 4.2 Replace History runtime tests with both directional flows, fixed 30-day snapshots, exact filtering, empty phases, ordering/replay/page bounds, supplier cancellation, local send semantics, response serialization, exactly one synchronization per connection/direction, terminal same/different-ID rejection, domain-release fence cleanup, and an independent next-connection synchronization with no continued progress.
- [x] 4.3 Prove live, multi-peer, and same-domain-page insert races; one activation per `syncId`; same-domain fan-out; new-page projection; terminal/cancellation dismissal; concurrent-owner isolation; and zero-insert silence through the real persistence boundary.
- [x] 4.4 Delete old cursor/full-window implementation, tests, fixtures, names, room inputs, compatibility branches, body-request/ACK proposals, and behavior assertions rather than retaining them behind aliases or fallbacks.

## 5. Delivery Gates

- [ ] 5.1 Pass focused regressions, the complete source suite, typecheck, lint, format, Chrome/Firefox production builds, strict OpenSpec validation, OpenSpec Doctor, residue scans, diff, identity, and clean-worktree gates on one exact.
- [x] 5.2 Publish the complete requirement through the single `perf/exact-history-sync` branch and one Draft PR based on `develop`; do not modify or reuse Draft PR #109.
- [ ] 5.3 Obtain fresh architecture-first Inspector review of the complete branch diff and close every finding on the same branch and PR.
- [x] 5.4 Record any performed or unavailable browser behavior verification truthfully as non-blocking; do not route QA, QC, or UX unless the Owner explicitly requests that role.
- [x] 5.5 After explicit Owner acceptance, update final OpenSpec/task truth and require final exact identity plus CI before Ready/merge.
