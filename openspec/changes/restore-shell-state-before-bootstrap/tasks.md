> **Authority status (2026-07-31):** The Owner confirmed the final product result: release `v1.9.7` exact `b5f1b0183a80ba089ad8e51f15f40dabd8089a50` freezes only the content-root, `App`, and `AppMain` component hierarchy; neither `appStatusLoadIsFinished` nor initialization `ready` gates that composition; business components consume dependencies at use sites; the original Toaster remains inside the positioned AppMain panel; and the existing `Toast.ts` path is the sole Toast capability. Checked authority items record only this final result. They do not imply replacement source, source gates, Review, browser results, acceptance, or merge.

## 1. Product Authority

- [x] 1.1 Freeze the `v1.9.7` root hierarchy as `StrictMode -> RemeshRoot(store) -> RemeshScope(existing required Domains) -> App`, with no initialization wrapper, `Application` layer, fallback root, or initialization props on `<App />`.
- [x] 1.2 Keep the current business-required Scope Domains; the historical single-Domain example does not narrow that list.
- [x] 1.3 Freeze only the `v1.9.7` App component hierarchy and order: themed `#app`; `AppMain` then `AppButton`; and `DanmakuContainer` at the app level. Remove `appStatusLoadIsFinished` and every initialization `ready` condition around that tree.
- [x] 1.4 Freeze the ordered AppMain children as `Header`, `Main`, `Footer`, conditional `Setup`, and `Toaster`, followed internally by the existing resize handle under `AnimatePresence -> appOpenStatus && motion.div`.
- [x] 1.5 Keep the original Toaster inside that positioned panel with its existing rich-colors, theme, offset, visible-count, top-center, and dark-class configuration; forbid an AppMain prop, panel sibling, portal, external renderer, or second Toaster.
- [x] 1.6 Keep initialization `ready` out of the root/App/AppMain hierarchy; gate only the exact Runtime-dependent operation at its use site.
- [x] 1.7 Make `App`, `AppMain`, `AppButton`, and other business components consume their existing hooks, Domains, stores, and services directly; forbid dependency bags, activation/business callbacks, test-only props, and replacement Provider/context/controller injection.
- [x] 1.8 Delete `ToastPresentation.ts`, `toast-presentation.tsx`, mounted-surface state, descriptor bus, acknowledgements, and DOM-paint observation; use only `Toast.ts -> ToastExtern -> ToastImpl -> Sonner`, extending that existing input minimally if required.
- [x] 1.9 Allow stable `data-testid` attributes directly on existing production JSX; forbid dynamic selector injection, test-only props/wrappers, and runtime DOM rewriting.
- [x] 1.10 Fix the test stack to `vitest`, `happy-dom`, the complete `@testing-library/*` and `@vitest/*` families as needed, and `vitest-browser-react`; use `@vitest/browser-playwright` for the browser-rendered controls, remove `linkedom`, and permit only the required test-development dependency changes.
- [x] 1.11 Keep required initialization sequencing, deadlines, cancellation, Runtime detach, dependency gating, attempt identity, stale fencing, AppStatus restoration, and newer pre-hydration user interaction; neither storage hydration nor application initialization may gate the component tree.
- [x] 1.12 Keep the existing AppButton Refresh slot: initialization retry before ready, current-site ChatRoom retry/reconnect after ready, one operation owner, disabled/rotating single-flight state, matching Toast feedback, and no success Toast.
- [x] 1.13 Keep preload-warning repair, mandatory stage logging, timeout redesign, raw diagnostic UI, schema/API/dependency work, QA, QC, and UX outside scope unless separately authorized.
- [x] 1.14 Validate, commit, push, and publish this requirements-only authority as a docs child on the existing `fix/restore-shell-state` Draft PR.

## 2. Final-Result Regression And FAIL-Before

- [ ] 2.1 Add a structural control that compares the production root/App/AppMain hierarchy with the frozen `v1.9.7` result while allowing the current business-required Scope Domain list.
- [ ] 2.2 Prove the implementation parent fails because it adds `Application`, passes initialization dependencies/callbacks/test timing into business components, and gates page composition; require both `appStatusLoadIsFinished` and initialization `ready` to be absent from component-tree conditions.
- [ ] 2.3 Render the real AppMain path with the fixed happy-dom/Testing Library and Vitest Browser Mode stack, and prove the sole Toaster's actual DOM ancestors include the positioned visual panel; use literal production `data-testid` attributes when stable selectors are needed, and reject `linkedom`, dynamic injection, a shared React/Shadow root, `display: contents` shell, mocked broad wrapper, or panel-sibling Toaster as insufficient.
- [ ] 2.4 Assert `ToastPresentation.ts`, `toast-presentation.tsx`, `useToastPresentation`, mounted-surface state, acknowledgement/paint observers, and replacement dependency injection are absent.
- [ ] 2.5 Retain final-result expanded/collapsed/no-record hydration, opposite-value pre-hydration interaction, Toast-only initialization status, Refresh/readiness, single-flight, same-page success, and stale-generation controls.
- [ ] 2.6 Run the unchanged final-result assertions on the implementation parent to establish fail-before without committing any parent-state expectation.

## 3. Replacement

- [ ] 3.1 Restore the frozen `v1.9.7` root/App/AppMain component hierarchy and remove `Application`, every initialization wrapper/alternate tree, and every `appStatusLoadIsFinished` or initialization `ready` composition branch.
- [ ] 3.2 Remove initialization dependencies, activation callbacks, business-state projections, and test-only controls from business-component props; consume existing capabilities directly at their use sites without replacement injection.
- [ ] 3.3 Delete the `ToastPresentation` Domain/adapter path and route initialization, Runtime readiness, reconnect, join retry, and unrelated feedback through existing `Toast.ts` commands.
- [ ] 3.4 Restore the sole Toaster as the last AppMain business child inside the positioned panel with the frozen props and no external renderer.
- [ ] 3.5 Run required initialization as non-presentational lifecycle logic without changing dependency order, deadlines, cancellation, Runtime detach, single-flight, or stale fencing.
- [ ] 3.6 Mount the normal component tree before AppStatus hydration or application dependencies settle; preserve a newer pre-hydration user choice, later user persistence, and the single existing storage path.
- [ ] 3.7 Keep AppButton and its Refresh slot reachable pre-ready, with initialization-only dispatch before ready and existing ChatRoom-only dispatch after the atomic switch.
- [ ] 3.8 Project the current attempt through disabled/rotating Refresh, reject duplicates, restore retry eligibility on matching failure, activate dependent capabilities in place on success, and fence stale generations.
- [ ] 3.9 Align test-only development dependencies and regression configuration with the fixed stack, including any required `@testing-library/*` and `@vitest/*` packages; remove `linkedom` usage without changing production dependencies or behavior.

## 4. Source And Delivery Gates

- [ ] 4.1 Run focused parent FAIL-before and replacement controls for structure, real Toaster ancestry, single Toast path, all initialization stage classes, status restoration, pre-ready Refresh, expanded/collapsed behavior, same-page recovery, ready context switch, duplicates, and stale generations.
- [ ] 4.2 Run fixed-stack DOM/component and browser-mode controls, complete repository source tests, typecheck, lint, format, Chrome/Firefox builds, strict OpenSpec, and exact identity/scope gates on one immutable replacement exact.
- [ ] 4.3 Obtain fresh independent Review of the complete branch diff against `The-Absolute-Code.md` and the frozen `v1.9.7` hierarchy; close every finding on a replacement exact before release.
- [ ] 4.4 Publish only the same reviewed exact to the single `fix/restore-shell-state` Draft PR and require exact CI to pass without force, rebase, or unrelated scope.
- [ ] 4.5 Keep QA, QC, and UX absent unless the Owner explicitly requests the corresponding role; never report an unperformed result as PASS.
- [ ] 4.6 After Owner acceptance, update this OpenSpec/task truth, recheck final exact identity and CI, and follow the established conditional Ready/merge authorization flow; stop on failure or drift.
