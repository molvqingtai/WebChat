> **Acceptance status (2026-08-01):** The Owner explicitly accepted PR #87 while its published immutable source head was `aef4244f18b33b6cfdc921ea9aeab034de19c502`. Exact CI run `30661430841` passed setup/tests/build/linter 4/4, and fresh architecture-first Review task #505 passed P0/P1/P2 `0/0/0` with report SHA-256 `1caf215ba8e6da24554142847a15f9dfc488b74478342ead3eda4c649ede8177`. QA, QC, and UX were not routed under the Owner's explicit role boundary, so no unperformed result is recorded as PASS. Owner acceptance is conditional Ready/merge authorization after this documentation/task closeout and the final exact's identity and CI gates pass; the PR remains Draft and unmerged until those conditions finish. A checked item means implemented, freshly gated, truthfully recorded, or explicitly accepted; it does not invent a missing verification result.

## 1. Product Authority

- [x] 1.1 Define the root as `StrictMode -> RemeshRoot(store) -> RemeshScope -> App`, with exactly `NotificationDomain()` and `AppFeedbackDomain()` at root and AppFeedback retaining its nested AppStatus and Toast dependencies.
- [x] 1.2 Define `AppStatusDomain` as the single owner of one aggregate `open / unread / position` business truth persisted through three field-scoped keys, non-persisted `connecting / unavailable / ready`, Retry, and incoming non-self boolean-attention effects, with only production-consumed public API and file-local persistence/unread actions.
- [x] 1.3 Define `Initialization.ts` as plain bounded lifecycle orchestration using `AppStatusDomain`, with no Remesh Domain declaration or parallel phase state.
- [x] 1.4 Define direct `App`, `AppButton`, `AppFeedbackDomain`, and initialization-lifecycle consumption of `AppStatusDomain`.
- [x] 1.5 Define shell hydration, component composition, panel-owned Toaster, Refresh contexts, single-flight operations, and stale-result fencing as one current model.
- [x] 1.6 Define final-result tests with the fixed Vitest, happy-dom, Testing Library, and Vitest Browser Mode stack.

## 2. Source And Tests

- [x] 2.1 Make `AppStatusDomain` own initialization phase, Retry, and incoming boolean unread-attention processing while persisting `open / position / unread` independently through their field-scoped keys; expose only production-consumed API and keep hydration, persistence, unread mutation, storage synchronization, defaults, and effect identifiers file-local.
- [x] 2.2 Keep `Initialization.ts` as lifecycle orchestration that reads and updates `AppStatusDomain` through the store.
- [x] 2.3 Mount exactly `NotificationDomain()` and `AppFeedbackDomain()` in the root Scope; retain `AppStatusDomain` and `ToastDomain` only through `AppFeedbackDomain` dependencies.
- [x] 2.4 Make `App`, `AppButton`, and `AppFeedbackDomain` consume `AppStatusDomain` directly.
- [x] 2.5 Add focused final-result controls for Domain ownership, minimal root mounts, production-only exports, lifecycle boundaries, direct consumers, initialization terminals, Retry, unread cases, hydration races, and stale generations through real storage and public projections.
- [x] 2.6 Keep the normal App/AppMain tree, panel-owned Toaster, persisted shell behavior, ChatRoom recovery, and Runtime feedback behavior unchanged.

## 3. Delivery Gates

- [x] 3.1 Run focused tests, complete repository tests, typecheck, lint, format, Chrome/Firefox builds, strict OpenSpec, and exact scope/identity checks on one immutable source exact.
- [x] 3.2 Obtain fresh architecture-first Review of the complete branch against `The-Absolute-Code.md`; every Domain, state, effect, dependency, and abstraction must be globally necessary.
- [x] 3.3 Publish only the reviewed exact to the existing Draft PR and require exact CI to pass without unrelated scope.
- [x] 3.4 Keep QA, QC, and UX absent unless the Owner explicitly requests the corresponding role; never report an unperformed result as PASS.
- [x] 3.5 Record Owner acceptance and task truth as conditional Ready/merge authorization after documentation closeout and final gates.
- [ ] 3.6 Publish this documentation/status child by verified normal fast-forward, require the final exact identity and CI gates to pass, then hand off normal Ready and merge to Coder under the Owner's conditional authorization; stop on failure or drift.
