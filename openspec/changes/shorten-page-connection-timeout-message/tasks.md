## 1. Product Authority

- [x] 1.1 Fix the existing content connection-timeout Toast text as exactly `Connection timed out`.
- [x] 1.2 Remove page and prerequisite implementation terminology from that user-facing text.
- [x] 1.3 Preserve the current trigger, deadline, settlement, retry/recovery, connection truth, and complete Toast presentation behavior except text.
- [x] 1.4 Add no tests for this copy-only change; allow only mechanical synchronization of an existing literal expectation made stale by the direct replacement.

## 2. Direct Copy Only

- [x] 2.1 Replace only the existing page connection prerequisite timeout copy without adding another Toast, state, helper, or compatibility path.
- [x] 2.2 Add no test case, branch, fixture, snapshot, source reader, seam, or migrated assertion; any test diff is limited to an existing stale literal expectation.

## 3. Delivery Gates

- [x] 3.1 Pass the existing focused and complete source tests, typecheck, format, lint, Chrome and Firefox production builds, strict OpenSpec, and scope/identity gates on one immutable exact.
- [x] 3.2 Obtain fresh architecture-first Review with no unresolved findings before publication.
- [x] 3.3 Integrate both confirmed message reductions into the accepted PR #97 lineage, publish one replacement exact, and obtain exact-bound CI without changing the Owner checkout.
- [x] 3.4 Keep QA, QC, and UX absent unless the Owner explicitly requests one of those roles; do not report unperformed verification as PASS.
- [x] 3.5 After the source and delivery gates pass, use the Owner's confirmed conditional authorization to make PR #97 Ready and merge; stop on identity, Review, CI, or scope drift.
