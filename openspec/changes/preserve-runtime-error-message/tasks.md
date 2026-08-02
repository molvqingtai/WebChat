> **Acceptance status (2026-08-01):** The Owner explicitly accepted PR #93 at immutable source exact `ff8437a551d00358e707473435d00a0cd212727b` through the unified PR #91-#94 acceptance branch. Fresh architecture-first Review task #529 passed with P0/P1/P2 `0/0/0`, and exact CI passed 4/4. Owner acceptance is conditional Ready/merge authorization after this PM-owned documentation child and final identity/CI gates.

## 1. Product Authority

- [x] 1.1 Define `error.message` as the complete host-to-content Runtime error transport value.
- [x] 1.2 Define content Runtime-backed `ChatRoom` as the sole Error reconstruction boundary.
- [x] 1.3 Preserve Runtime failure ownership, page targeting, ChatRoom public error behavior, and Toast presentation without transporting Error metadata.

## 2. Source And Regression Coverage

- [x] 2.1 Project host Runtime Errors to their exact message string in `PagePort` before page delivery.
- [x] 2.2 Type the internal Runtime server error callback as `string` and reconstruct `new Error(message)` in content `ChatRoom`.
- [x] 2.3 Cover JSON-safe exact-message delivery, content Error reconstruction, and final adapter observation without test-side reconstruction.

## 3. Delivery Gates

- [x] 3.1 Pass focused and complete source tests, typecheck, format, lint, Chrome/Firefox production builds, runtime boundary, and exact CI 4/4 on the immutable source exact; pass strict OpenSpec on this documentation child.
- [x] 3.2 Obtain fresh architecture-first Review task #529 with P0/P1/P2 `0/0/0` and exact branch/PR identity.
- [x] 3.3 Record explicit Owner acceptance as conditional merge authorization and hand final identity/CI, Ready, and merge execution to Coder after this documentation child.
