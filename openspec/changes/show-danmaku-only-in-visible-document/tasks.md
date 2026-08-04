## 1. Product Authority

- [x] 1.1 Define each new Danmaku push as eligible only when the existing configuration is enabled and exact `document.visibilityState === 'visible'` at admission time.
- [x] 1.2 Keep the existing setting and content lifecycle as the only manager lifecycle owner; visibility changes perform no mount, unmount, clear, pause, resume, or restart action.
- [x] 1.3 Define otherwise-eligible live deliveries observed while non-visible as dropped for Danmaku with no queue or replay.
- [x] 1.4 Preserve every already accepted item under the existing Danmaku runtime across visibility changes and admit only later new deliveries after visibility returns.
- [x] 1.5 Define same-domain documents as independently governed by their own local visibility without background tab/window state or cross-tab coordination.
- [x] 1.6 Preserve message/history, panel/open, unread, notification, setting UI/persistence, Runtime, protocol, permissions, dependencies, and public APIs.

## 2. Regression Coverage

- [ ] 2.1 Prove setting-on plus visible admits one otherwise-eligible live delivery, while non-visible admits none.
- [ ] 2.2 Prove `visible -> hidden -> visible` does not mount, unmount, clear, pause, resume, restart, or duplicate the manager or any already accepted item.
- [ ] 2.3 Prove deliveries observed while non-visible create no push, queue, deferred work, or later replay, while one later visible delivery is admitted once.
- [ ] 2.4 Prove the existing setting remains the sole manager activation boundary across every visibility state and setting transition.
- [ ] 2.5 Prove same-domain tab A hidden and tab B visible produce no new Danmaku in A and the normal one in B without changing shared message, open, unread, or notification truth.
- [ ] 2.6 Add structural controls excluding a visibility listener/state/lifecycle owner, browser tab/window APIs, background coordination, persistence, protocol, permissions, new UI, and additional dependencies.

## 3. Minimum Implementation

- [ ] 3.1 Keep the existing Danmaku Domain/Extern and setting-driven manager lifecycle as the sole Danmaku behavior boundary.
- [ ] 3.2 Read exact `document.visibilityState` directly when each otherwise-eligible live delivery reaches the existing push boundary.
- [ ] 3.3 Perform no manager or item lifecycle action when document visibility changes.
- [ ] 3.4 Drop hidden deliveries and admit only later new visible deliveries without history lookup, buffering, replay, timer, listener, or cross-tab state.
- [ ] 3.5 Preserve every unaffected product/runtime boundary listed in the delta specification.

## 4. Delivery Gates

- [ ] 4.1 Pass focused regressions, the complete source test suite, typecheck, lint, format, Chrome/Firefox production builds, strict OpenSpec validation, OpenSpec Doctor, diff, identity, and clean-worktree gates on one exact.
- [ ] 4.2 Obtain fresh architecture-first Review of the complete requirement-branch diff and close every finding before publication.
- [ ] 4.3 Publish the reviewed exact through one independent requirement branch/Draft PR based on `develop`, without mixing AppButton PR #103 or another requirement.
- [ ] 4.4 Keep QA, QC, and UX absent unless the Owner explicitly requests one; record any performed or unavailable browser behavior verification truthfully without making it a source/CI blocker.
- [ ] 4.5 Record explicit Owner acceptance and update final OpenSpec/task truth; keep Ready/merge conditional on the closeout exact's identity and CI.
