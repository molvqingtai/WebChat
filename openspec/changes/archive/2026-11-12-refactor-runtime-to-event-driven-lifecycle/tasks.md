> **Current delivery status (2026-08-26):** Owner accepted recovery behavior exact `4527b1a7f65aa8cd6bedcd774c70b8c811ab164f`; formatter-only child `fced6103ed56934a7928a9de5140553795f29669` is the current reviewed code exact. Focused tests passed `9/9`, the full suite passed `85 files / 1057 tests`, `check`, `format:check` (`592` files), and `diff-check` are green, and fresh cumulative code review passed `0/0/0`. This four-file canonical docs/status phase has passed affected and repository-wide strict OpenSpec validation (`46/46`), status (`4/4`), doctor, format, lint, check, full tests, and diff-check; independent docs scope review remains pending. PR #157/ref promotion, exact hosted CI, Ready, closure of superseded Draft PRs #152-#156, and merge to `develop` remain pending; `master`, release, and deploy remain outside this delivery.

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
- [x] 3.7 Make duplicate active World peer joins idempotent, advance source generation only after explicit leave and same-ID rejoin, and validate committed recovery entries without equating physical membership count with logical recovery completeness.

## 4. Contract-Derived Controls

- [x] 4.1 Build fail-before controls from the event/state contract rather than snapshots of legacy helper order.
- [x] 4.2 Cover Background fresh + Offscreen surviving, Background surviving + Offscreen fresh, both fresh, and both current.
- [x] 4.3 Cover Page initial load/rebind, immediate full Sessions before activation, ordered later deltas, binding drift, and asynchronous recovery of other provisional Pages.
- [x] 4.4 Cover target-only readiness, accepted action exactly once, ambiguous caller timeout without replay, and live-domain recovery remaining non-blocking.
- [x] 4.5 Cover exact stale identity rejection for provider callbacks, callback generations, Page bindings, Room handles, late closes, and grace tokens.
- [x] 4.6 Cover Firefox persistent Background ownership with no Offscreen or `ensureTransport` branch.
- [x] 4.7 Cover duplicate active-peer join retaining committed recovery and explicit leave/rejoin invalidating old-generation recovery while preserving exact peer ID plus generation fail-closed validation.

## 5. Delivery

- [x] 5.1 Run strict OpenSpec plus focused and complete repository source/browser gates on one immutable clean-cut candidate.
- [x] 5.2 Obtain fresh architecture-first review of the complete replacement and legacy-removal exact.
- [x] 5.3 Obtain Owner acceptance and fresh cumulative code review of recovery exact `fced6103ed56934a7928a9de5140553795f29669`.
- [ ] 5.4 Publish only the canonical four-file docs/status child, pass its repository gates and independent scope review, then fast-forward PR #157 and the acceptance branch to that exact and require exact hosted CI green.
- [ ] 5.5 After exact hosted CI is green, mark PR #157 Ready, close only superseded Draft PRs #152-#156, and merge PR #157 to `develop`; do not alter `master`, release, or deploy.
