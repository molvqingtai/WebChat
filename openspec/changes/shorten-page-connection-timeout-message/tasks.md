## 1. Product Authority

- [x] 1.1 Fix the existing content connection-timeout Toast text as exactly `Connection timed out`.
- [x] 1.2 Remove page and prerequisite implementation terminology from that user-facing text.
- [x] 1.3 Preserve the current trigger, deadline, settlement, retry/recovery, connection truth, and complete Toast presentation behavior except text.

## 2. Minimum Source And Regression

- [ ] 2.1 Replace only the existing page connection prerequisite timeout copy without adding another Toast, state, helper, or compatibility path.
- [ ] 2.2 Cover the real timeout path, exact rendered text, single-feedback behavior, and unchanged settlement/retry/connection controls.
- [ ] 2.3 Keep tests behavior-based with no production-source reader, regex, parser, AST, snapshot, or test seam.

## 3. Delivery Gates

- [ ] 3.1 Pass focused and complete source tests, typecheck, format, lint, Chrome and Firefox production builds, strict OpenSpec, and scope/identity gates on one immutable exact.
- [ ] 3.2 Obtain fresh architecture-first Review with no unresolved findings before publication.
- [ ] 3.3 Integrate both confirmed message reductions into the accepted PR #97 lineage, publish one replacement exact, and obtain exact-bound CI without changing the Owner checkout.
- [ ] 3.4 Keep QA, QC, and UX absent unless the Owner explicitly requests one of those roles; do not report unperformed verification as PASS.
- [ ] 3.5 After the source and delivery gates pass, use the Owner's confirmed conditional authorization to make PR #97 Ready and merge; stop on identity, Review, CI, or scope drift.
