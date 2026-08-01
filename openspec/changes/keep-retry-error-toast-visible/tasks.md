> **Acceptance status (2026-08-01):** The Owner explicitly accepted PR #92 at immutable source exact `da489d7f0848e62411abf798863ec6564db8df35` through the unified PR #91-#94 acceptance branch. Fresh Review task #520 passed with no remaining P0/P1/P2 finding, and exact CI passed 4/4. Real Firefox production evidence confirmed that a failed Retry leaves the new error Toast visible. Owner acceptance is conditional Ready/merge authorization after this PM-owned documentation child and final identity/CI gates.

## 1. Product Authority

- [x] 1.1 Keep one stable initialization Toast identity for initial execution and Retry.
- [x] 1.2 Define current failure as direct same-ID loading-to-error replacement with no preceding cancel.
- [x] 1.3 Preserve default error lifetime, success cancellation, stale-generation fencing, and unrelated Toast independence.

## 2. Source And Regression Coverage

- [x] 2.1 Set unavailable state and publish the same-ID normalized error in one current failure settlement.
- [x] 2.2 Keep success, abort, unmount, and supersession behavior unchanged.
- [x] 2.3 Cover initial failure, Retry failure, success, repeated failure, deferred feedback publication, and stale generations through final-result tests.

## 3. Delivery Gates

- [x] 3.1 Pass focused and complete tests, typecheck, format, lint, and Chrome/Firefox production builds on the immutable source exact; pass strict OpenSpec on this documentation child.
- [x] 3.2 Obtain fresh architecture-first Review with no remaining P0/P1/P2 finding and exact-bound CI success.
- [x] 3.3 Record real Firefox Retry failure behavior without inventing an unperformed result.
- [x] 3.4 Record explicit Owner acceptance as conditional merge authorization and hand final identity/CI, Ready, and merge execution to Coder after this documentation child.
