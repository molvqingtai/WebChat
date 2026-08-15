> **Acceptance status (2026-08-01):** The Owner explicitly accepted PR #91 at immutable source exact `5d6aff72c96b11a23272956aee9755db108edc26` through the unified PR #91-#94 acceptance branch. Fresh architecture-first Review task #515 passed with P0/P1/P2 `0/0/0`, and exact CI passed 4/4. Real Firefox production initialization and concurrent-tab behavior passed; the five-second blocked terminal is covered deterministically and remains real-browser `UNVERIFIED`, not PASS. Owner acceptance is conditional Ready/merge authorization after this PM-owned documentation child and final identity/CI gates. The 2026-08-16 caught-error observability synchronization reopens only the blocked-failure routing regression row below; browser coordination, deadline, Retry, and historical evidence remain unchanged.

## 1. Product Authority

- [x] 1.1 Define Firefox direct persistence preparation and Chrome Web Locks arbitration at browser composition.
- [x] 1.2 Preserve one versioned persistence lifecycle, canonical identities, generation fencing, and idempotent current-version writes without alternate state.
- [x] 1.3 Define the five-second blocked IndexedDB deletion terminal and retryable initialization feedback.

## 2. Source And Regression Coverage

- [x] 2.1 Inject one preparation coordinator into origin-local configuration and canonical message-database preparation.
- [x] 2.2 Keep Firefox free of Web Locks execution while Chrome owns Web Locks arbitration.
- [ ] 2.3 Cover direct/Web Locks selection, concurrent convergence, abort generations, blocked deadline settlement, and Retry through final-result tests; prove a genuine current-page failure directly replaces same-ID loading with the original `error.message` and no preceding cancel or decorated/replacement copy, while no-page/no-impact failure uses direct `console.error(error)`.

## 3. Delivery Gates

- [x] 3.1 Pass focused and complete tests, typecheck, format, lint, Chrome/Firefox production builds, and runtime boundary gates on the immutable source exact; pass strict OpenSpec on this documentation child.
- [x] 3.2 Obtain fresh architecture-first Review with no remaining P0/P1/P2 finding and exact-bound CI success.
- [x] 3.3 Record real Firefox initialization and concurrent-tab truth separately from deterministic blocked-timeout coverage without inventing a browser PASS.
- [x] 3.4 Record explicit Owner acceptance as conditional merge authorization and hand final identity/CI, Ready, and merge execution to Coder after this documentation child.
