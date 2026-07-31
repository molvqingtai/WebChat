## 1. Product Authority

- [x] 1.1 Define the root as `StrictMode -> RemeshRoot(store) -> RemeshScope -> App`, with exactly `NotificationDomain()` and `AppFeedbackDomain()` at root and AppFeedback retaining its nested AppStatus and Toast dependencies.
- [x] 1.2 Define `AppStatusDomain` as the single owner of persisted `open / unread / position`, non-persisted `connecting / unavailable / ready`, Retry, and incoming non-self unread effects, with only production-consumed public API and file-local persistence/unread actions.
- [x] 1.3 Define `Initialization.ts` as plain bounded lifecycle orchestration using `AppStatusDomain`, with no Remesh Domain declaration or parallel phase state.
- [x] 1.4 Define direct `App`, `AppButton`, `AppFeedbackDomain`, and initialization-lifecycle consumption of `AppStatusDomain`.
- [x] 1.5 Define shell hydration, component composition, panel-owned Toaster, Refresh contexts, single-flight operations, and stale-result fencing as one current model.
- [x] 1.6 Define final-result tests with the fixed Vitest, happy-dom, Testing Library, and Vitest Browser Mode stack.

## 2. Source And Tests

- [x] 2.1 Make `AppStatusDomain` own initialization phase, Retry, and incoming unread processing while persisting only `open / unread / position`; expose only production-consumed API and keep hydration, persistence, unread mutation, storage synchronization, defaults, and effect identifiers file-local.
- [x] 2.2 Keep `Initialization.ts` as lifecycle orchestration that reads and updates `AppStatusDomain` through the store.
- [x] 2.3 Mount exactly `NotificationDomain()` and `AppFeedbackDomain()` in the root Scope; retain `AppStatusDomain` and `ToastDomain` only through `AppFeedbackDomain` dependencies.
- [x] 2.4 Make `App`, `AppButton`, and `AppFeedbackDomain` consume `AppStatusDomain` directly.
- [x] 2.5 Add focused final-result controls for Domain ownership, minimal root mounts, production-only exports, lifecycle boundaries, direct consumers, initialization terminals, Retry, unread cases, hydration races, and stale generations through real storage and public projections.
- [x] 2.6 Keep the normal App/AppMain tree, panel-owned Toaster, persisted shell behavior, ChatRoom recovery, and Runtime feedback behavior unchanged.

## 3. Delivery Gates

- [x] 3.1 Run focused tests, complete repository tests, typecheck, lint, format, Chrome/Firefox builds, strict OpenSpec, and exact scope/identity checks on one immutable source exact.
- [ ] 3.2 Obtain fresh architecture-first Review of the complete branch against `The-Absolute-Code.md`; every Domain, state, effect, dependency, and abstraction must be globally necessary.
- [ ] 3.3 Publish only the reviewed exact to the existing Draft PR and require exact CI to pass without unrelated scope.
- [ ] 3.4 Keep QA, QC, and UX absent unless the Owner explicitly requests the corresponding role; never report an unperformed result as PASS.
- [ ] 3.5 After Owner acceptance, update OpenSpec/task truth, recheck final exact identity and CI, and follow the established conditional Ready/merge authorization flow.
