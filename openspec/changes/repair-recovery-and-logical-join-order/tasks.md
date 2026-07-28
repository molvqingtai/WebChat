## 1. Authority And Baseline

- [ ] 1.1 Freeze source baseline `a602149522c7038f29e13307bb925a48ed3848d7`, docs ancestor `740373298711002548cbe6eecb3c63dcb045db74`, current v2 protocol bytes/namespaces, Session observation classification, Artico peer lifecycle, supersession flow, and a602 Refresh behavior before source edits.
- [ ] 1.2 Create source work only as a clean detached sole child of this docs exact; keep the Owner checkout, untracked `.pnpm-store/`, remote refs, PRs, CI, `master`, tags, and release metadata untouched.
- [ ] 1.3 Treat a602 Reviewer/QA facts and task #253 as non-transferable partial history. No intermediate implementation head may receive final gate or publication authority.

## 2. Protocol V3 And Logical Join Time

- [ ] 2.1 Add required strict safe non-negative `joinedAt` to `SessionMessage` only; keep `ChatSession`, SESSION_END, ChatMessage/history/reaction, World payload, codec algorithm, and limits unchanged.
- [ ] 2.2 Project the persisted local logical-generation time into every SESSION and bind the first accepted remote `{presenceId,user,joinedAt}`; drop a same-generation user/time mutation without changing membership or notices.
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
- [ ] 4.3 Ensure only the winning attempt can commit/publish/retain current identity and outcome; stale completion cannot clear or overwrite the winner.
- [ ] 4.4 Preserve existing user feedback for every genuine provider, protocol, persistence, Runtime, and join failure. Do not identify cancellation through message-string matching or add a second error/pending/Toast owner.

## 5. Fragment-Insensitive Page Routing

- [ ] 5.1 Define one canonical document-navigation identity that excludes only URL fragment while retaining scheme, host, port, path, and query; derive routing only from trusted extension sender/tab context.
- [ ] 5.2 Route provider responses to the exact trusted tab without `tabs.query()` on a fragment-bearing href, and keep Offscreen relay equality fragment-insensitive while preserving wrong-tab, recycled-id, real-navigation, namespace, direction, and source rejection.
- [ ] 5.3 Prove direct startup with `#fragment`, mounted `hashchange`, and hash change during the initial coordinator/Runtime handshake each mount or retain exactly one control/page lease/logical presence with zero join/leave.
- [ ] 5.4 Preserve existing content bootstrap structure: no pre-App fallback UI, no origin-wide broadcast, no fragment-specific reconnect/remount, and no browser-specific business branch.

## 6. Combined Regression Matrix

- [ ] 6.1 Add parent fail-before and candidate pass-after coverage for terminal failed-join Refresh success/failure, no-leave retry, joined reconnect preservation, initial/recovery single-flight, request-local cleanup, and stale fences.
- [ ] 6.2 Add Artico lifecycle matrix coverage for empty/non-empty demand, ready/connecting/disconnected peer state, concurrent Chat/World joins, exactly one replacement, old callback/timer isolation, leave, and dispose.
- [ ] 6.3 Add same-domain supersession races for two-page avatar update, avatar/manual Refresh overlap, avatar/host recovery overlap, winner success/failure ordering, current identity retention, zero cancellation Toast, and genuine-error controls.
- [ ] 6.4 Add deterministic A-before-B coverage that delays both discovery and SESSION until after B commit; prove B keeps only B's self notice, A records B once, membership converges, and duplicate/reconnect/reload/host replacement add no notice.
- [ ] 6.5 Add later-during-provisional, equal/older timestamp, mutated same-presence time, true later return, exact v3/v3 exchange, and v1/v2/v3 namespace-isolation controls.
- [ ] 6.6 Add fragment routing controls for direct hash, mounted hashchange, in-flight hash change, multiple same-origin tabs, changed path/query navigation, recycled tab id, and forged/stale provider response.
- [ ] 6.7 Run focused and full tests, type/format/lint checks, strict OpenSpec validation, production Chrome MV3/Firefox MV2 builds, and only the exact-bound focused browser flows routed by Planner. Do not expand this repair into the full release matrix unless a failure requires it.
- [ ] 6.8 Prove direct and cumulative scope: no public ChatRoom expansion, MessageStore/database/UI/Toaster/panel/alternate-bootstrap change, World payload change, watchdog, unbounded retry, dependency/workflow/WXT change, release-version edit, compatibility path, origin-wide response broadcast, or v2 active namespace residue.

## 7. Review And Release

- [ ] 7.1 Freeze one clean cumulative immutable source exact with exact/tree/parent/patch identities, focused commits if used, direct/cumulative path inventory, zero unintended refs, and exact-bound evidence.
- [ ] 7.2 Route fresh Reviewer and QA in parallel only after the final exact exists. Both SHALL review/test the complete five-repair matrix; prior a602 or partial-head verdicts do not transfer.
- [ ] 7.3 After both final PASS, synchronize only that exact to the Owner checkout without touching `.pnpm-store/`. Owner verifies failed-join Refresh, disconnected-peer retry, multi-page avatar update without supersession Toast, A-before-B notice order, and direct fragment-URL startup in one acceptance.
- [ ] 7.4 Publish only after Owner acceptance by verified normal fast-forward and stop on remote drift. Do not modify `master`, tags, package/app version, release metadata, or release notes in this change.
