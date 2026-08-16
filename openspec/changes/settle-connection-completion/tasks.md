> **Acceptance status (2026-07-31):** The Owner explicitly accepted PR #85 while its published immutable source head was `87e93e3a5324e721e620962fbd953e1cb54ebd1f`. Exact CI run `30607637081` passed setup/linter/tests/build 4/4, and fresh Review task #445 passed P0/P1/P2 `0/0/0` with report SHA-256 `c73932163c6a85ef76cdf4cedc27d1013823b6866100dea36791aeb01557c117`. Nonblocking browser task #447 passed its reached Chrome for Testing 149 and Firefox failure-shell paths with report SHA-256 `a4d456b752bfbb08727508883b9235035f96cdeebb40478860df717d5f817966`; Firefox ready/recovery, system Chrome 151 side-load, and the final-exact connected-visible-user, zero-user, ordinary-refresh, grace-return, and post-grace-rejoin browser cases that task #447 did not rerun remain `UNVERIFIED`. Owner acceptance is conditional merge authorization after this documentation/task closeout and the final exact's identity and CI gates pass; the PR remains Draft and unmerged until those conditions finish. A checked item means implemented, freshly gated, truthfully recorded, or explicitly accepted; it does not reinterpret an `UNVERIFIED` result as PASS. The 2026-08-16 caught-error observability synchronization reopens only the bootstrap failure-copy implementation and evidence rows below; terminal connection settlement, shell continuity, Retry, and generation fencing remain unchanged.

## 1. Authority And Evidence

- [x] 1.1 Freeze `develop@d7fa3d386250aee22a740ca84e3cd29dadbbc724`, task #422 diagnostic SHA-256 `256872c6688aedeb03859a75ac68ec331fb48bfe3ef0d12434a7aebde72dad27`, the four RED signatures, and the lifecycle PASS before source edits.
- [x] 1.2 Freeze the minimum product boundary: terminal page-attempt ownership, pre-connection prerequisite deadlines/cancellation, post-commit active Presence persistence independence, tail recovery, and current local release/grace semantics.
- [x] 1.3 Record callback/replay/IDB request identity, `pageId` metadata, and provider-refresh callback behavior as non-prescriptive hypotheses rather than implementation requirements.

## 2. Focused RED Controls

- [x] 2.1 Add the minimum focused regression proving a non-settling post-commit active Presence save projects the local user but cannot retain page completion/loading.
- [x] 2.2 Add focused regressions proving non-settling callback registration, replay, and replay-record persistence each terminate the matching zero-user page attempt before physical join.
- [x] 2.3 Prove timeout, page detach, host replacement, and supersession dispose or fence partial prerequisite work and let a later attempt start without waiting for the stale Promise.
- [ ] 2.4 Preserve controls proving an ordinary refresh starts no grace, a page returning during grace reuses its domain Chat peer and dedicated World owner, and a post-grace page creates a new domain Chat peer after completed release while obtaining or reusing World according to current site demand.
- [x] 2.5 Prefer existing focused suites and reusable fixtures; do not ship the diagnostic trace wholesale or add production observability unless it removes more code or proves a required boundary.

## 3. Terminal Settlement Repair

- [x] 3.1 Give one page connection attempt a finite deadline/cancellation owner across callback registration, replay, replay persistence, Runtime join, and current snapshot acceptance.
- [x] 3.2 Make failed/cancelled prerequisite work clear only its matching application request, dispose partial callbacks/resources, abort Database work where supported, and reject stale late results.
- [x] 3.3 Complete page success from the current committed domain Chat connection plus World contribution and snapshot containing the local session; keep active post-commit Presence persistence outside the page completion Promise.
- [x] 3.4 Bound and recover the per-domain active Presence persistence tail so an unresolved predecessor cannot strand later current-generation persistence or final release and a late old completion cannot replace the current generation.
- [ ] 3.5 Preserve local active-generation cleanup, application request-ID fencing, five-second domain grace, scoped Chat-peer and dedicated World contribution reuse/release, and the exact current public `ChatRoom`/protocol/schema/version/UI contracts; retain no Chat end send, retry, settlement, cleanup record, or peer-signal departure gate.

## 4. Exact-Bound Verification

- [x] 4.1 Run the focused settlement controls, canonical full tests, TypeScript, format, lint, OpenSpec strict validation/doctor, and applicable Chrome/Firefox production builds on one immutable source exact.
- [x] 4.2 Prove the connection-settlement portion contains no Toast copy selection or duration mask, independent readiness authority, fixed pre-App status view, `pageId` business field, provider-specific compatibility path, protocol/public-port/schema/version/dependency/workflow drift, or permanent diagnostic bulk.
- [x] 4.3 Freeze exact/tree/sole-parent/patch identity, branch/remote/PR identity, clean worktree, and all PASS/FAIL/BLOCKED/UNVERIFIED evidence without transferring task #422 diagnostic results as implementation PASS.

## 5. Panel Shell Continuity

- [x] 5.1 Freeze the Owner boundary that any Runtime, storage-preparation, or other bootstrap error may gate only its dependent capability and never the existing launcher or openable panel shell.
- [ ] 5.2 Add parent-sensitive regressions proving browser-sync/local configuration, MessageStore, and Runtime bootstrap failure currently leaves no Shadow UI, while the repair mounts exactly one shell, reaches a finite degraded state, fences late old results, presents exactly the original `error.message` for a genuine current-page failure, and uses direct console diagnostics for no-page/no-impact failure.
- [x] 5.3 Mount the bootstrap-independent Shadow UI/shell before asynchronous preparation; ignite each application Domain and side effect only after its own prerequisite is ready, with no duplicate root/store or panel visual redesign.
- [ ] 5.4 Present one visible, accessible unavailable state and Retry action for the current failed bootstrap generation; directly replace same-ID loading with the exact original-message error and no preceding cancel or decorated/replacement copy; recover the same shell in place on success and return to retryable unavailable without infinite loading on failure.
- [ ] 5.5 Prove one fresh shell/generation after reload or genuine replacement, current-generation-only hydration, keyboard/focus accessibility, exact original-message settlement for the current page, and no stale bootstrap result or Retry terminal mutates the current shell.

## 6. Review And Release

- [x] 6.1 Obtain fresh independent Review for terminal ownership, post-commit success boundary, prerequisite cleanup, persistence-tail recovery, shell continuity/recovery, stale-generation fencing, lifecycle preservation, and minimum-code scope.
- [x] 6.2 Keep the single `fix/settle-connection-completion` Draft PR updated to each reviewed exact by verified normal fast-forward only; stop on remote drift and do not merge.
- [x] 6.3 Run nonblocking exact-bound Chrome MV3 and Firefox MV2 behavior observation for shell continuity on storage-preparation and Runtime startup failure, in-place retry, connected-visible-user and zero-user failure signatures, ordinary refresh, return during grace, post-grace rejoin, and cleanup; report unexecuted cases as UNVERIFIED.
- [x] 6.4 Record Owner smoke acceptance on the published immutable source exact as conditional merge authorization after documentation/task closeout and final gates.
- [ ] 6.5 Publish this documentation/status child by verified normal fast-forward, require its exact identity and CI gates to pass, then perform normal Ready and merge under the Owner's conditional authorization; stop on failure or drift.
