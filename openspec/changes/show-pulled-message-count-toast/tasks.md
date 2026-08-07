## 1. Product Authority

- [x] 1.1 Freeze exact copy `Pulled {count} new messages.` for every positive per-batch count, with no singular variant.
- [x] 1.2 Freeze loading kind and exact `3000ms` automatic duration without synchronization-owned dismissal or success conversion.
- [x] 1.3 Define one independent Toast per qualifying history-response batch, no whole-sync aggregation, and existing coverage by a later Toast.
- [x] 1.4 Define `count` as canonical newly inserted messages and exclude request start, no response, zero-new, duplicate, conflict-retained, invalid, and rejected values.
- [x] 1.5 Preserve notifications, unread attention, system notices, synchronization, persistence, acknowledgement, Runtime/protocol ownership, and the generic Toast surface.

## 2. Minimum Implementation

- [ ] 2.1 Derive the current batch's newly inserted count at the existing application/page history-application boundary without a second scan, persisted counter, or whole-sync state.
- [ ] 2.2 Publish one generic loading Toast with exact copy and `3000ms` only when the batch count is positive.
- [ ] 2.3 Keep later batches independent and rely on the existing Toast surface coverage; add no aggregation, queue, manual cancel, terminal conversion, or source-specific presenter.
- [ ] 2.4 Preserve every existing history side-effect exclusion and operation boundary, with no protocol, storage-schema, public-API, dependency, or Runtime-owner change.

## 3. Regression Coverage

- [ ] 3.1 Prove one batch containing new and existing values reports only the canonical newly inserted count once.
- [ ] 3.2 Prove request start, no response, zero-new, all-existing replay, retained conflict, invalid, and rejected batches publish no pulled-message Toast.
- [ ] 3.3 Prove exact loading kind, copy, and `3000ms` expiry with no explicit cancel or success update.
- [ ] 3.4 Prove rapid qualifying batches publish independently through the existing one-visible surface, do not aggregate, and do not delay persistence, acknowledgement, pagination, or continuation.
- [ ] 3.5 Prove history application still creates no notification, unread-attention mark, or system notice and does not disturb unrelated Toast sources.

## 4. Delivery Gates

- [ ] 4.1 Pass focused regressions, complete source tests, typecheck, lint, format, Chrome/Firefox production builds, strict OpenSpec validation, OpenSpec Doctor, diff, identity, and clean-worktree gates on one exact.
- [ ] 4.2 Publish the requirement and implementation through the single `feat/pulled-message-count-toast` branch and Draft PR based on `develop`.
- [ ] 4.3 Obtain fresh architecture-first Inspector review of the complete branch diff and close every finding on the same requirement branch/PR.
- [ ] 4.4 Record any performed or unavailable browser behavior verification truthfully without making it a source/CI blocker; keep QA, QC, and UX absent unless the Owner explicitly requests one.
- [ ] 4.5 After explicit Owner acceptance, update final OpenSpec/task truth and require final exact identity plus CI before Ready/merge.
