> **Acceptance status (2026-07-31):** The Owner explicitly accepted PR #86 while its published immutable source head was `34d10cf83e62b8e43e08866da234dabf37b20b8b`. Exact CI run `30615201337` passed setup/linter/tests/build 4/4, and fresh Review task #455 passed P0/P1/P2 `0/0/0` with report SHA-256 `28bb21e1cd845cd6f77a29c08f99b2daac0daa239d1c3f30a3b2cb9773ca7cbf`. QA, QC, and UX were not routed under the Owner's explicit role boundary, so no unperformed result is recorded as PASS. Owner acceptance is conditional merge authorization after this documentation/task closeout, related temporary-worktree cleanup, and the final exact's identity and CI gates pass; the PR remains Draft and unmerged until those conditions finish. A checked item means implemented, freshly gated, truthfully recorded, or explicitly accepted; it does not invent a missing verification result.

## 1. Product Authority

- [x] 1.1 Preserve the generic Toast default duration for errors; do not make errors indefinite or add a custom timer.
- [x] 1.2 Forbid business-driven active dismissal of current error descriptors while allowing user dismissal, natural duration expiry, explicit same-ID descriptor replacement, and actual surface teardown.
- [x] 1.3 Keep success/ready dismissal for matching loading entries only, with existing request identity, dwell, stale fencing, and no-success-Toast behavior.
- [x] 1.4 Preserve existing generic Toaster accessibility/visual configuration, recovery controls, panel state, and terminal non-replay.
- [x] 1.5 Bind the authority to task #450 report SHA-256 `0f2a47484f778bbba72b07f400a36211cf03738aba7a803be2a4a6ae9b285fe7` and independent `develop` lineage.
- [x] 1.6 Validate, commit, push, and publish this requirements-only authority as the first exact of its own Draft PR.

## 2. Deterministic FAIL-before

- [x] 2.1 Convert the confirmed mounted Remesh/Sonner trace into a tracked parent regression that proves `loading -> error -> dismiss` in the current source and immediate removal from the Sonner store.
- [x] 2.2 Prove the surface and an unrelated Toast remain mounted so replacement, remount, global cleanup, and default-duration expiry stay excluded.

## 3. Minimum Repair

- [x] 3.1 Prevent ready/success/bootstrap/panel/request-settlement cleanup from actively dismissing a current error descriptor, without introducing another Toast owner or custom timer.
- [x] 3.2 Preserve ID-scoped dismissal of matching loading feedback after its existing dwell and preserve stale-request/generation fencing.
- [x] 3.3 Preserve explicit same-ID descriptor replacement, user dismissal, default-duration expiry, actual surface teardown, and no terminal replay on remount.
- [x] 3.4 Keep unrelated Toasts, current error accessibility, existing Retry/reconnect controls, panel state, Runtime truth, and network outcomes unchanged.

## 4. Source And Delivery Gates

- [x] 4.1 Run focused parent FAIL-before and candidate controls for error lifetime, loading-only cleanup, successor replacement, user/default expiry, teardown/non-replay, stale ownership, and unrelated Toast isolation.
- [x] 4.2 Run complete repository source tests, typecheck, lint, format, Chrome/Firefox builds, strict OpenSpec, and identity/scope gates on one immutable candidate exact.
- [x] 4.3 Obtain fresh Review of the complete branch diff and close every finding on a replacement exact before release.
- [x] 4.4 Keep QA, QC, and UX absent unless the Owner explicitly requests them; do not report an unperformed browser result as PASS.
- [x] 4.5 Keep the single `fix/preserve-error-toast-duration` Draft PR updated through its reviewed source exact, and record Owner smoke acceptance as conditional Ready/merge authorization.
- [ ] 4.6 Publish this documentation/status child by verified normal fast-forward, clean the related temporary worktrees, require the final exact identity and CI gates to pass, then perform normal Ready and merge under the Owner's conditional authorization; stop on failure or drift.
