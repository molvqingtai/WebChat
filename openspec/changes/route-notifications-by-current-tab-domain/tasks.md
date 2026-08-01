> **Acceptance status (2026-08-01):** The Owner explicitly accepted PR #94 at immutable source exact `dd00f964ba3352125f5daac27eab8e849111221c` through the unified PR #91-#94 acceptance branch. Fresh architecture-first Review task #532 passed with P0/P1/P2 `0/0/0`, and exact CI run `30690624836` passed 4/4. Owner acceptance is conditional Ready/merge authorization after this PM-owned documentation child and final identity/CI gates.

## 1. Product Authority

- [x] 1.1 Preserve the existing notification-enabled switch as authoritative and preserve `All message` / `Only @self` eligibility.
- [x] 1.2 Define the focused browser window's currently viewed highlighted tab as the sole tab-domain comparison input.
- [x] 1.3 Define exact same-domain suppression, different-or-unavailable-domain notification, exactly-once creation, and zero tab/window mutation.
- [x] 1.4 Preserve self/history/duplicate exclusion and request-local failure isolation while keeping notification-click handling outside eligibility, protocol, persistence, UI, permissions, and public APIs.

## 2. Regression Coverage

- [x] 2.1 Add the final regression requiring one notification when an eligible message belongs to domain A, the user is viewing domain B in the focused window, and an unfocused window has a highlighted domain-A tab.
- [x] 2.2 Add controls for same-current-domain suppression, different-current-domain creation, absent current-tab context, and zero tab/window mutation.
- [x] 2.3 Cover the disabled switch, `All message`, `Only @self`, self-authored messages, history application, duplicate delivery, and request-local notification failure.

## 3. Minimum Repair

- [x] 3.1 Resolve only the focused window's currently viewed highlighted tab for each eligible request and compare its existing WebChat domain identity with the message domain.
- [x] 3.2 Create exactly one notification when equality is not established and create none when the current domains are equal, without adding state, caches, owners, retries, or browser-specific business branches.
- [x] 3.3 Keep eligibility read-only with respect to tabs/windows and keep user-initiated notification-click handling outside eligibility.
- [x] 3.4 Add deterministic regressions for every scenario in the delta specification at the existing Domain/service/provider boundaries.

## 4. Delivery Gates

- [x] 4.1 Pass focused regressions, the complete source test suite, typecheck, lint, format, Chrome/Firefox production builds, strict OpenSpec validation, OpenSpec Doctor, diff, identity, and clean-worktree gates on one exact.
- [x] 4.2 Obtain fresh architecture-first Review of the complete requirement-branch diff and close every finding before publication.
- [x] 4.3 Publish the reviewed exact through the single requirement branch/PR and require exact-bound CI to pass.
- [x] 4.4 Keep QA, QC, and UX absent unless the Owner explicitly requests one; record any performed or unavailable browser behavior verification truthfully without making it a source/CI blocker.
- [x] 4.5 After explicit Owner acceptance, update the final OpenSpec/task truth and hand final identity/CI, Ready, and merge execution to Coder under the resulting conditional authorization; this documentation task does not claim that Ready or merge has already occurred.
