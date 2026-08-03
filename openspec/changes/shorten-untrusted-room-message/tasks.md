## 1. Product Authority

- [x] 1.1 Fix the untrusted-room rejection message as exactly `Untrusted room message`.
- [x] 1.2 Keep all room-derived text out of the Error message while allowing only optional, separately structured internal debug context.
- [x] 1.3 Preserve trusted-room validation, provider targeting, settlement, retry, Runtime state, and existing UI behavior.

## 2. Minimum Source And Regression

- [ ] 2.1 Replace only the existing untrusted-room rejection copy without adding another error, state, helper, or compatibility path.
- [ ] 2.2 Cover the real rejected send, exact message, absence of room-derived message text, zero provider calls, and unchanged trusted-room controls.
- [ ] 2.3 Keep tests behavior-based with no production-source reader, regex, parser, AST, snapshot, or test seam.

## 3. Delivery Gates

- [ ] 3.1 Pass focused and complete source tests, typecheck, format, lint, Chrome and Firefox production builds, strict OpenSpec, and scope/identity gates on one immutable exact.
- [ ] 3.2 Obtain fresh architecture-first Review with no unresolved findings before publication.
- [ ] 3.3 Publish the same requirement branch and obtain exact-bound CI without changing unrelated PRs or the Owner checkout.
- [ ] 3.4 Keep QA, QC, and UX absent unless the Owner explicitly requests one of those roles; do not report unperformed verification as PASS.
- [ ] 3.5 Require explicit Owner acceptance before Ready or merge.
