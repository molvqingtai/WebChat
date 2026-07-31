> **Authority status (2026-07-31):** The Owner confirmed the final product result: the normal shell is the only root UI; initialization is non-presentational lifecycle logic rather than a wrapper/shell; every initialization loading or error state uses the one generic Toaster contained by the normal shell; and no independent initialization status component exists. Checked authority items record only this final result. They do not imply replacement source, source gates, Review, browser results, acceptance, or merge.

## 1. Product Authority

- [x] 1.1 Keep one directly mounted normal shell/root/store through initialization, failure, Retry, ready capability activation, and later recovery, with no initialization wrapper, alternate shell, or fallback UI tree.
- [x] 1.2 Restore and persist expanded/collapsed state from the shell lifetime without waiting for any initialization dependency.
- [x] 1.3 Keep exactly one generic Toaster inside normal-shell ownership and represent every initialization loading/error state through it, with no independent status component or external renderer.
- [x] 1.4 Keep required initialization sequencing, deadlines, cancellation, Runtime detach, dependency gating, attempt identity, and stale fencing as non-presentational lifecycle logic.
- [x] 1.5 Keep the existing AppButton actions menu reachable pre-ready and make its single Refresh slot retry initialization before ready and retain current-site ChatRoom retry/reconnect after ready.
- [x] 1.6 Preserve one operation owner, disabled/rotating/single-flight Refresh projection, same-shell recovery, matching generic feedback, and no-success-Toast behavior in each exclusive context.
- [x] 1.7 Preserve newer pre-hydration shell interaction, one status/Toast owner, storage schema, ready-state Runtime/ChatRoom/WorldRoom truth, accessibility, and existing visual policy.
- [x] 1.8 Keep preload-warning repair, mandatory stage logging, timeout redesign, raw diagnostic UI, schema/API/dependency work, QA, QC, and UX outside scope unless separately authorized.
- [x] 1.9 Validate, commit, push, and publish this corrected requirements-only authority as a docs child on the existing `fix/restore-shell-state` Draft PR.

## 2. Final-Result Regression And FAIL-Before

- [x] 2.1 Add a final-result structural control requiring the content root to mount one normal application shell directly, independent of initialization settlement.
- [x] 2.2 Require the sole generic Toaster to be a descendant owned by that normal shell, never a wrapper/shell sibling, second root, or host-page portal.
- [x] 2.3 Forbid every independent initialization loading/error/result component and require active/terminal status to use generic Toast descriptors only.
- [x] 2.4 Retain final-result expanded/collapsed/no-record hydration and opposite-value pre-hydration interaction controls.
- [x] 2.5 Retain final-result Refresh/readiness, single-flight, same-shell success, and stale hydration/initialization fencing controls.
- [x] 2.6 Run the unchanged final-result assertions on the implementation parent to establish fail-before without committing any parent-state expectation.

## 3. Replacement

- [x] 3.1 Mount the one normal shell directly and remove every initialization wrapper, alternate shell, fallback tree, and independent status component.
- [x] 3.2 Run required initialization as non-presentational lifecycle logic without changing dependency order, deadlines, cancellation, Runtime detach, single-flight, or stale fencing.
- [x] 3.3 Mount exactly one generic Toaster inside normal-shell ownership and route active initialization loading and matching terminal failure through generic descriptors only.
- [x] 3.4 Activate shell-status hydration/persistence without awaiting application dependencies; preserve newer user interaction and the single existing storage path.
- [x] 3.5 Keep the AppButton actions menu and Refresh slot reachable pre-ready, with initialization-only dispatch/eligibility before ready and existing ChatRoom-only dispatch/eligibility after the atomic switch.
- [x] 3.6 Project the current attempt through disabled/rotating Refresh, reject duplicates, restore retry eligibility on matching failure, enable ready capabilities in the same shell on success, and fence stale generations.
- [x] 3.7 Keep dependency-backed Domain/effect work gated, exactly one Toaster/status watcher/effect/root/store, existing feedback lifetime and visuals, no success Toast, and no WorldRoom rebuild from Refresh.

## 4. Source And Delivery Gates

- [x] 4.1 Run focused parent FAIL-before and replacement controls for structural ownership, all initialization stage classes, status restoration, pre-ready menu/Refresh, Toast-only status, expanded/collapsed behavior, single-flight, same-shell recovery, ready context switch, duplicates, and stale generations.
- [x] 4.2 Run complete repository source tests, typecheck, lint, format, Chrome/Firefox builds, strict OpenSpec, and exact identity/scope gates on one immutable replacement exact.
- [ ] 4.3 Obtain fresh independent Review of the complete branch diff and close every finding on a replacement exact before release.
- [ ] 4.4 Publish only the same reviewed exact to the single `fix/restore-shell-state` Draft PR and require exact CI to pass without force, rebase, or unrelated scope.
- [ ] 4.5 Keep QA, QC, and UX absent unless the Owner explicitly requests the corresponding role; never report an unperformed result as PASS.
- [ ] 4.6 After Owner acceptance, update this OpenSpec/task truth, recheck final exact identity and CI, and follow the established conditional Ready/merge authorization flow; stop on failure or drift.
