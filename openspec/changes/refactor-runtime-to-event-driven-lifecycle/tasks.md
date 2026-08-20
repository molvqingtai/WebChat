## 1. Product And Architecture Authority

- [x] 1.1 Freeze the approved Chromium MV3 and Firefox MV2 lifecycle in the project-owned Archify source and generated HTML.
- [x] 1.2 Define the clean-cut event-driven ownership, restart, callback, action-admission, release, and stale-work contract.
- [x] 1.3 Forbid dependency on legacy Runtime control flow, compatibility fallback, dual architecture, wrapper delegation, patch layering, and tests that use old implementation order as their oracle.

## 2. Event And State Model

- [ ] 2.1 Publish the exact Domain owner matrix for Runtime state, Queries, Commands, Events, Effects, and Extern capabilities before source replacement begins.
- [ ] 2.2 Define typed Page RPC, browser lifecycle, provider callback, host lifecycle, callback-rebind, readiness, release, and stale-work events with exact current-generation ownership.
- [ ] 2.3 Define the Chromium Background logical Runtime and Offscreen transport-proxy boundary, plus the Firefox single-document ownership variant.
- [ ] 2.4 Define target-scoped readiness and non-blocking recovery state without a global action barrier.

## 3. Clean-Cut Replacement

- [ ] 3.1 Implement the new Runtime lifecycle from the event/state contract without importing, wrapping, delegating to, or preserving legacy lifecycle control flow.
- [ ] 3.2 Implement all four Background/Offscreen restart combinations and Page `onSessionsChange` initial-load/rebind behavior.
- [ ] 3.3 Implement exact target readiness, one-time action execution, transport/current-state callback replacement, and generation-fenced release.
- [ ] 3.4 Remove the superseded Runtime lifecycle, compatibility paths, old owners, and obsolete tests in the same candidate exact.
- [ ] 3.5 Prove no reachable old/new dual path, feature flag, fallback, dual-write, dual-read, shadow owner, Page polling, or added heartbeat remains.

## 4. Contract-Derived Controls

- [ ] 4.1 Build fail-before controls from the event/state contract rather than snapshots of legacy helper order.
- [ ] 4.2 Cover Background fresh + Offscreen surviving, Background surviving + Offscreen fresh, both fresh, and both current.
- [ ] 4.3 Cover Page initial load/rebind, immediate full Sessions before activation, ordered later deltas, binding drift, and asynchronous recovery of other provisional Pages.
- [ ] 4.4 Cover target-only readiness, accepted action exactly once, ambiguous caller timeout without replay, and live-domain recovery remaining non-blocking.
- [ ] 4.5 Cover exact generation rejection for stale provider callbacks, callback IDs, bindings, Room handles, late closes, and grace tokens.
- [ ] 4.6 Cover Firefox persistent Background ownership with no Offscreen or `ensureTransport` branch.

## 5. Delivery

- [ ] 5.1 Run strict OpenSpec plus focused and complete repository source/browser gates on one immutable clean-cut candidate.
- [ ] 5.2 Obtain fresh architecture-first review of the complete replacement and legacy-removal exact.
- [ ] 5.3 Publish only the reviewed exact and require exact hosted CI before Owner acceptance.
- [ ] 5.4 Keep Ready, merge, `master`, release, and deploy outside this contract until separately authorized.
