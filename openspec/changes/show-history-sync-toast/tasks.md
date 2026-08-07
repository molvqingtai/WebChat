## 1. Product Authority

- [x] 1.1 Freeze exact copy `Syncing message history` with no visible count.
- [x] 1.2 Freeze loading kind and exact `3000ms` automatic duration without synchronization-owned dismissal or success conversion.
- [x] 1.3 Define one independent Toast immediately upon receipt of each nonempty valid history-response batch, without waiting for or inspecting insertion completion, and retain existing coverage by a later Toast.
- [x] 1.4 Add no count propagation, aggregation, storage, or display; exclude request start, waiting, no response, empty completion responses, and responses rejected before the application/page boundary.
- [x] 1.5 Preserve notifications, unread attention, system notices, synchronization, persistence, acknowledgement, Runtime/protocol ownership, and the generic Toast surface.

## 2. Minimum Implementation

- [x] 2.1 Use the existing nonempty-batch fact at the application/page history-response receipt boundary; do not wait for insertion completion or derive, propagate, aggregate, store, or display a count.
- [x] 2.2 Immediately publish one generic loading Toast with exact copy and `3000ms` when the received valid batch contains at least one message.
- [x] 2.3 Keep later batches independent and rely on the existing Toast surface coverage; add no aggregation, queue, manual cancel, terminal conversion, or source-specific presenter.
- [x] 2.4 Preserve every existing history side-effect exclusion and operation boundary, with no protocol, storage-schema, public-API, dependency, or Runtime-owner change.

## 3. Regression Coverage

- [x] 3.1 Prove one nonempty valid batch publishes exactly once upon receipt while its insertion work remains unsettled, without reading an insertion result.
- [x] 3.2 Prove request start, waiting, no response, an empty `done` response, and a response rejected before the application/page boundary publish no history-sync Toast.
- [x] 3.3 Prove an all-existing replay still publishes once because the received valid batch is nonempty, with no count state or visible count.
- [x] 3.4 Prove exact loading kind, copy, and `3000ms` expiry with no explicit cancel or success update.
- [x] 3.5 Prove rapid nonempty batches publish independently through the existing one-visible surface, do not aggregate, and do not delay insertion, acknowledgement, pagination, or continuation; history application still creates no notification, unread-attention mark, or system notice and does not disturb unrelated Toast sources.

## 4. Delivery Gates

- [ ] 4.1 Pass focused regressions, complete source tests, typecheck, lint, format, Chrome/Firefox production builds, strict OpenSpec validation, OpenSpec Doctor, diff, identity, and clean-worktree gates on one exact.
- [ ] 4.2 Publish the requirement and implementation through the single `feat/pulled-message-count-toast` branch and Draft PR based on `develop`.
- [ ] 4.3 Obtain fresh architecture-first Inspector review of the complete branch diff and close every finding on the same requirement branch/PR.
- [ ] 4.4 Record any performed or unavailable browser behavior verification truthfully without making it a source/CI blocker; keep QA, QC, and UX absent unless the Owner explicitly requests one.
- [ ] 4.5 After explicit Owner acceptance, update final OpenSpec/task truth and require final exact identity plus CI before Ready/merge.
