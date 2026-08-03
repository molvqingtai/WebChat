## 1. Product Authority

- [x] 1.1 Fix the untrusted-room rejection message as exactly `Untrusted room message`.
- [x] 1.2 Keep all room-derived text out of the Error message while allowing only optional, separately structured internal debug context.
- [x] 1.3 Preserve trusted-room validation, provider targeting, settlement, retry, Runtime state, and existing UI behavior.
- [x] 1.4 Add no tests for this copy-only change; allow only mechanical synchronization of an existing literal expectation made stale by the direct replacement.

## 2. Direct Copy Only

- [x] 2.1 Replace only the existing untrusted-room rejection copy without adding another error, state, helper, or compatibility path.
- [x] 2.2 Add no test case, branch, fixture, snapshot, source reader, seam, or migrated assertion; any test diff is limited to an existing stale literal expectation.

## 3. Delivery Gates

- [x] 3.1 Pass the existing focused and complete source tests, typecheck, format, lint, Chrome and Firefox production builds, strict OpenSpec, and scope/identity gates on one immutable exact.
- [x] 3.2 Obtain fresh architecture-first Review with no unresolved findings before publication.
- [x] 3.3 Publish the same requirement branch and obtain exact-bound CI without changing unrelated PRs or the Owner checkout.
- [x] 3.4 Keep QA, QC, and UX absent unless the Owner explicitly requests one of those roles; do not report unperformed verification as PASS.
- [x] 3.5 Require explicit Owner acceptance before Ready or merge.
