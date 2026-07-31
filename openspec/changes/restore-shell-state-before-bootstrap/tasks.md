> **Authority status (2026-07-31):** The Owner confirmed that the normal shell loads first and retains `Preparing WebChat`; local expanded/collapsed state restores independently; bootstrap terminal errors use the one generic Toast; and recovery uses the existing AppButton actions-menu Refresh, not a panel-local `Unavailable + Retry` surface. Task #465 bound the current defects to merged `develop@8419cf36e14a679c83e0b77f84a5a81006871292`. Checked items freeze and publish product authority only; they do not imply source implementation, source gates, Review, browser results, acceptance, or merge.

## 1. Product Authority

- [x] 1.1 Preserve one loading shell/root/store with current `Preparing WebChat` content through initial and retried bootstrap attempts.
- [x] 1.2 Restore and persist expanded/collapsed state from the shell lifetime without waiting for any application bootstrap dependency.
- [x] 1.3 Present bootstrap terminal errors through the one shell-level generic Toaster with existing error lifetime/configuration, and remove the panel-local `WebChat unavailable + Retry` terminal.
- [x] 1.4 Keep the existing AppButton actions menu reachable pre-ready and make its single Refresh slot retry bootstrap before ready and retain current-site ChatRoom retry/reconnect after ready.
- [x] 1.5 Preserve one operation owner, disabled/rotating/single-flight projection, stale fencing, same-root recovery, and no-success-Toast behavior in each exclusive Refresh context.
- [x] 1.6 Preserve newer pre-hydration shell interaction, one status/Toast owner, dependency gating, storage schema, ready-state Runtime/ChatRoom/WorldRoom truth, accessibility, and existing visual policy.
- [x] 1.7 Keep preload-warning repair, mandatory stage logging, timeout redesign, raw diagnostic UI, schema/API/dependency work, QA, QC, and UX outside scope unless separately authorized.
- [x] 1.8 Validate, commit, push, and publish this requirements-only authority as the first exact of its independent Draft PR from `develop@8419cf36e14a679c83e0b77f84a5a81006871292`.

## 2. Deterministic FAIL-Before

- [x] 2.1 Prove the parent does not restore persisted expanded state while representative browser-sync, page-local configuration, IndexedDB, and Runtime stages remain pending or settle terminally unavailable.
- [x] 2.2 Prove the parent hides the AppButton actions menu/Refresh before ready and routes ready Refresh only to ChatRoom reconnect.
- [x] 2.3 Prove the parent renders panel-local `WebChat unavailable + Retry` after bootstrap failure while the generic Toaster/presentation owner is absent.
- [x] 2.4 Add provenance-sensitive persisted-collapsed and no-record controls plus an opposite-value pre-hydration user interaction race.
- [x] 2.5 Prove Retry/ready activation and superseded hydration/bootstrap results can currently threaten duplicate or stale ownership boundaries.

## 3. Minimum Repair

- [x] 3.1 Activate existing shell-status hydration/persistence and the one generic Toast presentation lifecycle from the mounted shell without awaiting application dependencies.
- [x] 3.2 Keep `Preparing WebChat` only as loading content; remove bootstrap error/Retry UI from the panel and publish one normalized generic error descriptor at the current attempt terminal.
- [x] 3.3 Keep the AppButton actions menu and Refresh slot reachable pre-ready, with bootstrap-only dispatch/eligibility before ready and existing ChatRoom-only dispatch/eligibility after the atomic ready switch.
- [x] 3.4 Project the current bootstrap attempt through disabled/rotating Refresh, reject duplicates, restore retry eligibility on matching failure, recover the same root on success, and fence stale generations.
- [x] 3.5 Preserve a newer user expand/collapse through late hydration and persist it through the single shell-owned path without changing untouched status fields.
- [x] 3.6 Keep dependency-backed Domain/effect work gated, exactly one Toaster/status watcher/effect/root/store, existing error lifetime, no success Toast, and no WorldRoom rebuild from Refresh.

## 4. Source And Delivery Gates

- [x] 4.1 Run focused parent FAIL-before and candidate controls for every bootstrap stage class, status restoration, pre-ready menu/Refresh, Toast-only terminal, open/closed panel, single-flight, same-root recovery, ready context switch, duplicates, and stale generations.
- [x] 4.2 Run complete repository source tests, typecheck, lint, format, Chrome/Firefox builds, strict OpenSpec, and exact identity/scope gates on one immutable source candidate.
- [ ] 4.3 Obtain fresh independent Review of the complete branch diff and close every finding on a replacement exact before release.
- [ ] 4.4 Publish only the same reviewed exact to the single `fix/restore-shell-state` Draft PR and require exact CI to pass without force, rebase, or unrelated scope.
- [ ] 4.5 Keep QA, QC, and UX absent unless the Owner explicitly requests the corresponding role; never report an unperformed result as PASS.
- [ ] 4.6 After Owner acceptance, update this OpenSpec/task truth, recheck final exact identity and CI, and follow the established conditional Ready/merge authorization flow; stop on failure or drift.
