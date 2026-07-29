## 1. Authority And Baseline

- [ ] 1.1 Freeze current authority baseline `3a0a7d1fa11b1f69ce73f93a55f05e8e88cc48b1`, inherited source bytes from `cd1f054301abb383100b89fdea5bcb633ac79332` and `a602149522c7038f29e13307bb925a48ed3848d7`, current protocol bytes/namespaces, Session observation classification, Artico peer lifecycle, supersession flow, Refresh feedback/control state, and ClientLease pending-RPC recovery behavior before source edits.
- [ ] 1.2 Create source work only as a clean detached sole child of this docs exact, then advance only the existing `fix/cross-browser-action-lifecycle` / Draft PR #76 route; keep the Owner checkout, untracked `.pnpm-store/`, unrelated refs/PRs, CI, `master`, tags, and release metadata untouched.
- [ ] 1.3 Treat a602 Reviewer/QA facts, task #253, and invalid non-ancestor `9beec650...` bytes/evidence as non-transferable history. Do not cherry-pick that line. No intermediate implementation head may receive final gate or publication authority.

## 2. Protocol V3 And Logical Join Time

- [ ] 2.1 Add required strict safe non-negative `joinedAt` to `SessionMessage` only; keep `ChatSession`, SESSION_END, ChatMessage/history/reaction, World payload, codec algorithm, and limits unchanged.
- [ ] 2.2 Project only the Session-persisted local logical-generation time into every SESSION and bind the first accepted remote `presenceId` to its `user.id` and `joinedAt`. Fail closed on missing/invalid time without `clock.now()`, discovery, or baseline fallback; accept same-binding `name`/`avatar` projection refresh idempotently and drop a `user.id`/`joinedAt` mutation without changing membership or notices.
- [ ] 2.3 Reuse `{presenceId,joinedAt}` across Refresh, reconnect, recovery, duplicate publication, additional physical session, reattach, and supported host replacement; allocate a later time only for a true later generation.
- [ ] 2.4 Classify remote join eligibility by strict `remote.joinedAt > local.joinedAt` plus zero-to-one user transition. Make delayed historical discovery snapshot-only and keep any provisional later-join candidate attempt-owned until commit.
- [ ] 2.5 Move both Chat and World namespace inputs from exact v2 values to exact v3 values. Join only v3 rooms; add no optional field, v2 parser, dual room/send, translator, fallback, or compatibility alias.
- [ ] 2.6 Update public protocol declarations/schemas/parsers/golden fixtures and concise trust-boundary comments. World canonical payload bytes remain unchanged apart from selecting the v3 room.

## 3. Artico Demand-Driven Recovery

- [ ] 3.1 Introduce one adapter-private peer generation/restart owner shared by close-driven and join-driven recovery; preserve the host-lifetime peer id and private RoomTransport boundary.
- [ ] 3.2 When fresh desired room demand finds the retained peer `disconnected`, ensure exactly one replacement before pending joins wait for readiness. Concurrent Chat/World joins and repeated demand SHALL share it.
- [ ] 3.3 Fence every old peer open/error/close callback and delayed restart timer so it cannot join current rooms, settle current pending work, or replace a newer peer.
- [ ] 3.4 Preserve room-local leave semantics; cancel restart/timer work on dispose and settle every owned pending join exactly once without adding an unbounded retry loop or connecting watchdog.

## 4. Internal Supersession Cancellation

- [ ] 4.1 Replace the ordinary message-only supersession failure with one machine-classified internal cancellation across Runtime operation settlement; keep newest-wins generation and provisional Session/World aborts.
- [ ] 4.2 Make initial join, identity refresh, host recovery, and manual Refresh settle their own cancelled work without `Room.OnErrorEvent`, generic error Toast, false success, stale input retention, or stuck join/request/button loading.
- [ ] 4.3 Ensure only the winning attempt can commit/publish/retain current identity, same-id `name`/`avatar` projection, and outcome across every attached same-domain page; stale completion cannot clear or overwrite the winner.
- [ ] 4.4 Preserve existing user feedback for every genuine provider, protocol, persistence, Runtime, and join failure. Do not identify cancellation through message-string matching or add a second error/pending/Toast owner.

## 5. Fragment-Insensitive Page Routing

- [ ] 5.1 Define one canonical document-navigation identity that excludes only URL fragment while retaining scheme, host, port, path, and query; derive routing only from trusted extension sender/tab context.
- [ ] 5.2 Route provider responses to the exact trusted tab without `tabs.query()` on a fragment-bearing href, and keep Offscreen relay equality fragment-insensitive while preserving wrong-tab, recycled-id, real-navigation, namespace, direction, and source rejection.
- [ ] 5.3 Prove direct startup with `#fragment`, mounted `hashchange`, and hash change during the initial coordinator/Runtime handshake each mount or retain exactly one control/page lease/logical presence with zero join/leave.
- [ ] 5.4 Preserve existing content bootstrap structure: no pre-App fallback UI, no origin-wide broadcast, no fragment-specific reconnect/remount, and no browser-specific business branch.

## 6. Bounded ClientLease Recovery And Feedback

- [ ] 6.1 Bind one overall 15,000ms deadline to each current ClientLease startup/recovery generation and one hard deadline no greater than 5,000ms or the remaining budget to every register/attach attempt; a pending call SHALL reject locally and cannot extend the generation.
- [ ] 6.2 Single-flight overlapping watchdog, generation, host-id, page-lease, Port-loss, and response-loss recovery signals. A repeated signal SHALL join the current owner without parallel register/attach sequences, deadline reset, or feedback restart.
- [ ] 6.3 Retire correlation and cancel local ownership for every expired, detached, aborted, or superseded RPC. Fence late resolve/reject work so it cannot publish HostPhase, replace snapshots, start watchdogs, settle a current task, or release the winning lease.
- [ ] 6.4 Preserve immediate Runtime readiness truth and publish the current owner-scoped `Connecting` entry when every Refresh/recovery starts, including healthy retained-Runtime attachment. Dismiss only that owner on ready or replace it with unavailable inside the original overall budget; stale settlement cannot alter newer feedback.
- [ ] 6.5 On successful manual Refresh, finish the accepted 300ms request-loading dwell and dismiss only that request's generic `Connecting` entry instead of publishing `Ready to chat`; retain request-local error Toasts, button cleanup, stable IDs, unrelated entries, and the original Toaster structure/visuals.
- [ ] 6.6 Keep the current owner's Toast `loading` interval and the existing mounted Refresh control strictly aligned across direct/automatic connection or join, recovery, manual Refresh, and the accepted minimum dwell: loading means disabled plus rotating; success dismissal or error replacement ends both in the same transition. Recompute ordinary retry eligibility, fence stale owners from newer control/feedback state, and add no pre-App control.

## 7. Combined Regression Matrix

- [ ] 7.1 Add explicit parent fail-first controls proving successful Refresh currently turns `Connecting` into `Ready to chat` and direct connection Toast loading does not project the required disabled rotating Refresh control. Candidate pass-after SHALL prove Toast/control loading interval equality, manual/direct parity, active Connecting, ID-scoped success dismissal without any success descriptor, terminal-error retry state, no-leave retry, joined reconnect preservation, request single-flight, cleanup, and stale fences. In the same final child, restore the existing Header regression contract that online groups are stably ordered by descending `users.length`, preserving source order for equal counts without moving sorting into Runtime or World transport.
- [ ] 7.2 Add Artico lifecycle matrix coverage for empty/non-empty demand, ready/connecting/disconnected peer state, concurrent Chat/World joins, exactly one replacement, old callback/timer isolation, leave, and dispose.
- [ ] 7.3 Add same-domain supersession races for two-page avatar update, avatar/manual Refresh overlap, avatar/host recovery overlap, winner success/failure ordering, same-id `name`/`avatar` projection convergence and idempotence, stale superseded-attempt projection fencing, zero lifecycle notices/cancellation Toast, and genuine-error controls.
- [ ] 7.4 Add an explicit parent fail-first for both-late A discovery plus historical SESSION after B commit, then candidate pass-after across discovery/SESSION before, split across, and both after commit. Prove exact notice projections A `[A joined, B joined]`, B `[B joined]`, converged membership, and no duplicate/reconnect/reload/host-replacement notice.
- [ ] 7.5 Add later-during-provisional, equal/older timestamp, missing/invalid time with no receiver-local fallback, mutated same-presence `user.id`/time rejection, true later return, exact v3/v3 exchange, v1/v2/v3 namespace isolation, and SystemNotice local-only/no-wire/no-history controls.
- [ ] 7.6 Add a parent fail-first proving a direct `https://www.v2ex.com/t/1230408#reply6`-shape URL does not mount, then candidate fragment routing controls for direct hash, mounted hashchange, in-flight hash change, multiple same-origin tabs, changed path/query navigation, recycled tab id, and forged/stale provider response. This existing cumulative requirement is mandatory and cannot be omitted because newer smoke regressions were routed later.
- [ ] 7.7 Add deterministic ClientLease fail-before/pass-after controls for healthy retained-host refresh with active then dismissed Connecting, direct/automatic connection button disable/rotation without a click, forever-pending and rejected register/attach, host replacement, Port/response loss, two overlapping recovery signals, late completion after timeout/detach/supersession, and Connecting/control to ready/unavailable terminal settlement.
- [ ] 7.8 Run focused and full tests, type/format/lint checks, strict OpenSpec validation, production Chrome MV3/Firefox MV2 builds, and only the exact-bound focused browser flows routed by Planner. Do not expand this repair into the full release matrix unless a failure requires it.
- [ ] 7.9 Prove direct and cumulative scope: no public ChatRoom expansion, MessageStore/database change, unrelated UI surface or panel-structure change, Toast renderer/visual change, alternate bootstrap UI, World payload change, provider retry/watchdog, background wake redesign, dependency/workflow/WXT change, release-version edit, compatibility path, origin-wide response broadcast, or v2 active namespace residue. UI source changes remain limited to the required Refresh control state projection and the existing Header stable online-count ordering regression.

## 8. Review And Release

- [ ] 8.1 Freeze one clean cumulative immutable source exact with exact/tree/parent/patch identities, focused commits if used, direct/cumulative path inventory, zero unintended refs, and exact-bound evidence.
- [ ] 8.2 Route fresh Reviewer and QA in parallel only after the final exact exists. Both SHALL review/test the complete six-repair matrix; prior a602 or partial-head verdicts do not transfer.
- [ ] 8.3 After both final PASS, synchronize only that exact to the Owner checkout without touching `.pnpm-store/`. Owner verifies six scenarios in one acceptance: failed-join manual Refresh and direct/automatic connection loading both show Connecting and disable/rotate Refresh until the same owner terminates, with successful manual retry dismissing its entry without a success Toast; disconnected-peer retry; multi-page avatar update without supersession Toast; exact A-before-B notice projections; direct fragment-URL startup; and retained-Runtime refresh with bounded active-to-terminal Connecting.
- [ ] 8.4 Publish only after Owner acceptance by verified normal fast-forward and stop on remote drift. Do not modify `master`, tags, package/app version, release metadata, or release notes in this change.
