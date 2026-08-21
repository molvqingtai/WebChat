> **Final coding status (2026-08-21):** Runtime replacement cleanup exact `8ef8a10cfb08e532a530519a453e52729cb4093c` passed the complete repository gates, hosted CI `32409609462` (`4/4`), and fresh cumulative CODE FINAL PASS `0/0/0` in report `edf9f271-e09b-44d5-bbf4-6f50e5b08e74`. The cleanup removes the dead coordinator start/status/generation surface, write-only Page-binding generation, and final obsolete Offscreen mock without changing admission, callback, Room, release, production, or peer behavior. Canonical docs/status are the only permitted child before Owner acceptance; Ready, merge, `master`, release, and deploy remain unauthorized.

## 1. Product And Architecture Authority

- [x] 1.1 Freeze the approved Chromium MV3 and Firefox MV2 lifecycle in the project-owned Archify source and generated HTML.
- [x] 1.2 Define the clean-cut event-driven ownership, restart, callback, action-admission, release, and stale-work contract.
- [x] 1.3 Forbid dependency on legacy Runtime control flow, compatibility fallback, dual architecture, wrapper delegation, patch layering, and tests that use old implementation order as their oracle.

## 2. Event And State Model

- [x] 2.1 Publish the exact Domain owner matrix for Runtime state, Queries, Commands, Events, Effects, and Extern capabilities before source replacement begins.
- [x] 2.2 Define typed Page RPC, browser lifecycle, provider callback, host lifecycle, callback-rebind, readiness, release, and stale-work events with exact owner identity at each restart boundary.
- [x] 2.3 Define the Chromium Background logical Runtime and Offscreen transport-proxy boundary, plus the Firefox single-document ownership variant.
- [x] 2.4 Define target-scoped readiness and non-blocking recovery state without a global action barrier.

## 3. Clean-Cut Replacement

- [x] 3.1 Implement the new Runtime lifecycle from the event/state contract without importing, wrapping, delegating to, or preserving legacy lifecycle control flow.
- [x] 3.2 Implement all four Background/Offscreen restart combinations and Page `onSessionsChange` initial-load/rebind behavior.
- [x] 3.3 Implement exact target readiness, one-time action execution, transport/current-state callback replacement, and generation-fenced release.
- [x] 3.4 Remove the superseded Runtime lifecycle, compatibility paths, old owners, and obsolete tests in the same candidate exact.
- [x] 3.5 Prove no reachable old/new dual path, feature flag, fallback, dual-write, dual-read, shadow owner, Page polling, or added heartbeat remains.
- [x] 3.6 Remove the dead coordinator start/status/generation API, duplicate host phase, write-only Page-binding generation, and obsolete Offscreen mock while retaining exact host, transport, callback, Room, and release fences.

## 4. Contract-Derived Controls

- [x] 4.1 Build fail-before controls from the event/state contract rather than snapshots of legacy helper order.
- [x] 4.2 Cover Background fresh + Offscreen surviving, Background surviving + Offscreen fresh, both fresh, and both current.
- [x] 4.3 Cover Page initial load/rebind, immediate full Sessions before activation, ordered later deltas, binding drift, and asynchronous recovery of other provisional Pages.
- [x] 4.4 Cover target-only readiness, accepted action exactly once, ambiguous caller timeout without replay, and live-domain recovery remaining non-blocking.
- [x] 4.5 Cover exact stale identity rejection for provider callbacks, callback generations, Page bindings, Room handles, late closes, and grace tokens.
- [x] 4.6 Cover Firefox persistent Background ownership with no Offscreen or `ensureTransport` branch.

## 5. Delivery

- [x] 5.1 Run strict OpenSpec plus focused and complete repository source/browser gates on one immutable clean-cut candidate.
- [x] 5.2 Obtain fresh architecture-first review of the complete replacement and legacy-removal exact.
- [x] 5.3 Publish the reviewed coding exact followed only by canonical docs/status, and require exact hosted CI on the resulting docs head before Owner acceptance.
- [ ] 5.4 Keep Ready, merge, `master`, release, and deploy outside this contract until separately authorized.
