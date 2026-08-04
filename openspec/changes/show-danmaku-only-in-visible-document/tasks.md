## 1. Product Authority

- [x] 1.1 Define local Danmaku eligibility as the existing configuration being enabled and exact `document.visibilityState === 'visible'`.
- [x] 1.2 Define every non-visible document state as Danmaku-disabled and require immediate clearing of all current local Danmaku.
- [x] 1.3 Define otherwise-eligible live deliveries observed while non-visible as dropped for Danmaku with no queue or replay.
- [x] 1.4 Define return to visibility as permitting only later new eligible deliveries while the existing setting remains authoritative.
- [x] 1.5 Define same-domain documents as independently governed by their own local visibility without background tab/window state or cross-tab coordination.
- [x] 1.6 Preserve message/history, panel/open, unread, notification, setting UI/persistence, Runtime, protocol, permissions, dependencies, and public APIs.

## 2. Regression Coverage

- [ ] 2.1 Prove initial visible plus setting-on admits one otherwise-eligible live delivery, while initial non-visible admits none.
- [ ] 2.2 Prove `visible -> hidden` immediately clears every rendered and pending Danmaku item and repeated non-visible events remain idempotent.
- [ ] 2.3 Prove deliveries observed while non-visible create no push, queue, deferred work, or later replay.
- [ ] 2.4 Prove `hidden -> visible` leaves the surface empty until one later new eligible delivery arrives.
- [ ] 2.5 Prove the setting remains authoritative across every visibility state and setting transition.
- [ ] 2.6 Prove same-domain tab A hidden and tab B visible produce no Danmaku in A and the normal one in B, without changing shared message, open, unread, or notification truth.
- [ ] 2.7 Prove content remount and disposal leave one visibility listener, one Danmaku manager lifecycle, and no stale clear or push authority.
- [ ] 2.8 Add structural controls excluding browser tab/window APIs, background coordination, persistence, protocol, permissions, new UI, and additional dependencies.

## 3. Minimum Implementation

- [ ] 3.1 Keep the existing Danmaku Domain/Extern as the sole Danmaku behavior boundary and derive one ephemeral local eligibility value from the setting and document visibility.
- [ ] 3.2 Read the initial visibility, observe `visibilitychange`, and clean up the local listener with the content document lifecycle.
- [ ] 3.3 Use the same eligibility result for manager activation/clearing and every otherwise-eligible live-message push.
- [ ] 3.4 Clear rendered and pending Danmaku immediately when eligibility becomes false and prevent old items from resuming or reappearing.
- [ ] 3.5 Admit only later new deliveries after eligibility becomes true, without history lookup, buffering, replay, timer, or cross-tab state.
- [ ] 3.6 Preserve the existing Danmaku setting and every unaffected product/runtime boundary listed in the delta specification.

## 4. Delivery Gates

- [ ] 4.1 Pass focused regressions, the complete source test suite, typecheck, lint, format, Chrome/Firefox production builds, strict OpenSpec validation, OpenSpec Doctor, diff, identity, and clean-worktree gates on one exact.
- [ ] 4.2 Obtain fresh architecture-first Review of the complete requirement-branch diff and close every finding before publication.
- [ ] 4.3 Publish the reviewed exact through one independent requirement branch/Draft PR based on `develop`, without mixing AppButton PR #103 or another requirement.
- [ ] 4.4 Keep QA, QC, and UX absent unless the Owner explicitly requests one; record any performed or unavailable browser behavior verification truthfully without making it a source/CI blocker.
- [ ] 4.5 Record explicit Owner acceptance and update final OpenSpec/task truth; keep Ready/merge conditional on the closeout exact's identity and CI.
