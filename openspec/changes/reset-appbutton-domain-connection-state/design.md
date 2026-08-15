## Context

See `proposal.md` for the product problem and `specs/webrtc-runtime/spec.md` for normative behavior.

The Runtime replaces the current Domain's physical Chat peer through the existing application `leaveRoom()` / `joinRoom()` composition and the internal reconnect attempt. That attempt rotates physical identity and ultimately uses the normal room join and SESSION publication flow. Its complete reset boundary retains the current Domain's logical presence while rejecting stale connection-generation facts.

The complete last-tab release does clear the domain's committed/prepared sessions, observer ledger, pending leaves, and baseline, but it also retires local logical presence, updates World demand, removes the page lease after grace, and releases broader domain ownership. AppButton Refresh must reuse only the clean connection-state boundary, not impersonate final domain release.

The same Runtime owns one dedicated singleton World peer. `WorldDomain` owns the active Domain registration registry and complete local presence snapshot, while Wire/transport and Connection own the physical World generation and its recovery. AppButton Refresh currently excludes that singleton. The final product action must instead perform a real World departure and canonical rejoin alongside the Domain replacement, without converting the World child into another UI request or removing the active registry.

## Goals / Non-Goals

**Goals:**

- Give manual Refresh one explicit full current-domain connection-destruction boundary before replacement preparation and inbound synchronization.
- Give the same accepted ready-state action one independently fenced full World connection-destruction boundary followed by canonical World join and full-snapshot publication.
- Start the Domain and World replacements concurrently while leaving the Domain request as the sole AppButton presentation and completion owner.
- Reuse the canonical connection attempt, Wire validation, SESSION processing, and commit flow after reset.
- Preserve the active local logical presence generation while preventing every remote connection/observation fact from crossing attempts.
- Preserve active World registrations and desired sites while preventing every prior World physical-generation, remote-presence, publication, queue, callback, timer, and recovery fact from crossing attempts.
- Keep cleanup, reset, attempt, and stale work causally fenced and domain-scoped.
- Make the regression fail on the released source for the diagnosed tombstone mechanism and pass only when the full contract holds.
- Make the shared SESSION classifier recover every legitimate same-presence physical replacement while retaining terminal rejection for genuinely stale work.

**Non-Goals:**

- Calling final Domain release or changing last-page grace, durable logical-presence retirement, active World demand/registrations, or page lease ownership.
- Adding a public reconnect/reset method, a new peer message, SESSION retry/reconciliation, a tombstone exception, or an observer expiry policy.
- Clearing persistent messages, user configuration, page-owned UI state, active World registrations, or another Domain's Chat state.
- Adding World loading, progress, completion, error, Toast, disabled-state, or another refresh control to the UI.
- Changing automatic World self-recovery, pre-ready AppButton Retry, initialization, page attach/reattach, host recovery, or unrelated connection behavior.
- Treating last arrival, `sessionId` alone, or an untrusted sender assertion as logical-generation authority.

## Decisions

### 1. One accepted AppButton action owns two independent clean replacements

In ready application state, one accepted AppButton Refresh starts the current-Domain replacement and singleton-World replacement without awaiting either child before starting the other. The two children have independent operation and generation fences. One child's success, failure, cancellation, or slow settlement neither grants authority to nor cancels the other.

The Domain child first fences the prior current-domain generation and invokes one coordinated destruction transition across the existing domain owners. It removes the current domain's physical Chat transport owner and trusted membership, Connection attempts/generation-owned work and old readiness, all Session and observer state except the separately retained local logical seed, History requester/provider/supply/binding/feedback work, volatile Delivery/batch state, pending leaves, baselines, queues, callbacks, timers, and recovery work. Destruction settles before the replacement prepares or receives authoritative inbound SESSION data.

This is not a second state owner: Connection continues to sequence the operation; Wire/transport, Session, History, Delivery, World, and Lifecycle each clear or preserve only the facts they already own. The orchestration expresses two causal boundaries across their existing CQRS transitions. Lifecycle retains the exact page lease and current reconnect request but contributes no prior readiness result. The World child is not folded into the Domain aggregate and cannot expand Domain cleanup into another Domain.

Alternative rejected: clear only Session or `ended` observer entries. Transport membership, Connection attempts/readiness, History/Delivery work, queues, timers, or stale callbacks could still survive a supposedly clean refresh, contradicting full domain-connection destruction.

Alternative rejected: ignore an `ended` observer when mode is reconnect. That repairs one guard while preserving the stale ledger and creates a refresh-specific protocol exception.

### 2. Preserve only the local active logical generation

Before removing current-domain connection state, Session retains the exact active local `{presenceId, joinedAt, user, site}` needed to authorize the new physical attempt. The replacement allocates a new physical `peerId` and `sessionId`, re-publishes the retained logical presence, and builds every remote binding from messages accepted by the new attempt. No remote observer or member record is retained alongside this local seed.

Alternative rejected: allocate a new `presenceId`/`joinedAt`. Manual Refresh is physical recovery, not a logical departure and return; changing the logical generation would create false notices and break the existing presence contract.

Alternative rejected: preserve the entire durable presence record. That record includes the remote observer ledger responsible for the defect. Only the local active identity is an allowed seed.

### 3. Reuse canonical join and commit after reset

Once destruction settlement is acknowledged, the current reconnect request starts the existing current-domain replacement attempt. Normal scoped transport join, SESSION publication/receive validation, attempt-owned inbound processing, new History work, new volatile Delivery state, and atomic commit remain authoritative. The implementation will not introduce a special member fetch, forced replay, delayed tombstone expiry, or parallel synchronization path.

This keeps old peers compatible and ensures a valid existing SESSION is sufficient to rebuild membership. Existing operation IDs and generation checks fence delayed cleanup or callbacks so prior work cannot mutate or settle the new attempt.

Alternative rejected: call the complete last-tab release implementation and immediately rejoin. Full release owns durable retirement, World site removal, page lease/grace, and queued demand semantics that Refresh must preserve.

### 4. Domain and World reset boundaries preserve only their intended durable truth

The Domain reset key is the exact current Domain. Other Domain records are not traversed or rewritten. Persistent messages remain in the existing origin database and page/user settings remain outside Runtime connection cleanup. Current same-domain pages keep their leases and receive the new committed Runtime snapshot through their existing subscription.

The World reset targets only the singleton World connection. It preserves `WorldDomain`'s committed active registrations, user/site values, and resulting desired full local presence, while destroying the prior World physical transport owner/peer and trusted membership, room members, remote presence projection, connection/recovery generation, pending or staged connection-scoped publication, send/decode queue, timer, callback, and stale completion authority. Physical leave/disposal settles before the replacement joins. The canonical World join then establishes a fresh physical generation and publishes exactly one current full snapshot. Manual refresh does not stage a Domain removal, publish an artificial empty-registry snapshot, or change World demand.

Structural and behavioral controls will capture protected facts before activation and compare them afterward: active World registrations and desired sites, another Domain's full Runtime/Chat/History/Delivery state, persistent message records, user configuration, page lease/identity/state, and the public/protocol source surfaces. Candidate-sensitive controls will inspect each destroyed connection at its pre-replacement boundary to prove that no old transport, trusted room, attempt/readiness, remote projection, queue, timer, callback, or recovery fact remains.

### 5. Domain owns presentation; World remains a background child

The existing Domain reconnect request remains the only AppButton presentation owner. Its current availability query controls whether the ready-state action can be activated; its current request controls the disabled state, spinning icon, accessible label, completion, and error presentation. Domain settlement restores the button without waiting for World. The World child emits no AppButton loading, progress, disabled state, completion, error, or Toast and cannot alter the Domain result. Internal World failure remains available to Runtime diagnostics and its existing automatic recovery owner but is not projected as manual-refresh UI.

If automatic World recovery or a prior manual World replacement is already in flight, the manual child joins that one current World operation rather than starting a second World destruction/rejoin. An overlapping AppButton activation after the Domain button becomes available still starts its newly accepted Domain replacement. The pre-ready AppButton slot continues to run only the existing initialization Retry path; it does not manually refresh World.

### 6. Verification covers both clean replacements

The fail-before fixture will establish four real logical members under healthy transport, create the same remote `ended` observation that currently survives reconnect, and prove the released reconnect remains at three while the complete release/reopen control reaches four. The candidate assertion then requires one AppButton-equivalent manual reconnect to reach four.

Additional assertions will prove complete destruction across every enumerated Domain and World connection-state family, new physical identities plus stable logical/registration truth, one same-domain replacement shared by multiple pages, one coalesced World replacement, stop-before-start provider order, fresh full World publication, UI/result independence, protected data/scope identity, stale work fencing, and unchanged public/wire source. The test inventory will enumerate every lifecycle entry that can deliver a SESSION for an existing `presenceId` and classify whether it intentionally retains the same live connection or requires an independent clean boundary. A healthy four-member Domain and populated World list are controls; changing only UI counts or fixtures cannot satisfy the test.

### 7. Legitimate rebind uses current physical provenance, not arrival order

The common SESSION classifier will distinguish observer-stale state from truly stale input using evidence already present at the Runtime boundary. A legal correction must arrive from the currently trusted Chat room generation and currently admitted source, carry a new physical `sessionId` rather than the ended binding's id, and exactly match the observer's accepted `presenceId`, `user.id`, and `joinedAt`. No newer active binding or logical generation may conflict. The classifier then replaces only the old physical binding, marks the same logical observation active, cancels/fences matching old leave work, and lets existing snapshot/History flows converge.

This decision explicitly modifies the existing v5 `Session classifies logical presence across physical lifecycles` requirement. Its five-second expiry still removes the presence from displayed membership and records the observer-local leave, but the prior absolute sentence that any later SESSION for that expired generation can never restore membership is replaced by the strict current-provenance classifier above. No sibling requirement or refresh-only exception remains to compete with that authority.

A delayed frame from an old room/source/attempt, an exact replay of the ended physical `sessionId`, an identity/time mutation, or a presence already superseded by a newer accepted generation remains terminally rejected. This preserves the meaningful anti-replay boundary without treating an observer's fallible local five-second physical-loss inference as permanent proof that the remote logical generation ended. Because v5 has no peer `SESSION_END`, an `ended` observer created only from local PeerLeave expiry is corrected by current physical provenance; “truly stale” here means the physical/logical exclusions above, not that the local tombstone alone is infallible.

Alternative rejected: accept the last SESSION by arrival time. Delivery order is not logical causality and would allow delayed frames to overwrite current state.

Alternative rejected: accept any new `sessionId`. `sessionId` is sender data and becomes relevant only together with current trusted transport provenance, exact logical binding, and generation fences.

Alternative rejected: keep the global ended guard and repair only Refresh. Automatic recovery or another lifecycle path could still present the same current physical evidence against a stale observer record, leaving the underlying classifier inconsistent.

## Risks / Trade-offs

- [A late callback from the discarded generation mutates new state] -> Fence reset and replacement by the current reconnect operation/generation and test delayed SESSION, leave timer, cleanup, and terminal callbacks.
- [Over-broad cleanup behaves like final release] -> Retain local logical identity, page leases, World demand, and persistent/page data explicitly; compare protected identities before and after Refresh.
- [A partial reset removes Session state but leaves another connection owner alive] -> Assert every contract-listed transport, Wire, Connection, Session, History, Delivery, queue, timer, and recovery family is absent at replacement start and cannot affect commit.
- [World rejoin starts before the old owner settles] -> Require provider-observable stop-before-start ordering and fence old room events, publications, queues, timers, and completions from the new generation.
- [World cleanup removes active sites or emits a false empty snapshot] -> Preserve the committed registration registry and demand outside physical cleanup, then publish only the current full snapshot after the replacement joins.
- [A slow or failed World child keeps the AppButton busy or changes the Domain result] -> Bind every UI and manual result projection only to the Domain child and test both settlement orders and both one-sided failures.
- [Manual activation overlaps automatic recovery or a prior click] -> Keep one shared in-flight World replacement and make every later manual child join it until complete.
- [Reset persistence fails] -> Keep the reconnect request failed/retryable without committing a mixed old/new snapshot; do not start the replacement until required cleanup settles.
- [No peer is currently ready to resend SESSION] -> Preserve existing canonical readiness/catch-up behavior; this change adds no new retry guarantee or protocol message.
- [Reactivating observer-stale state admits a replay] -> Require current trusted room/source provenance, a new physical binding, exact logical identity/time, no newer conflict, and controls for every excluded stale class.
- [A prior observer-local leave notice already exists] -> Restore the same logical generation without manufacturing a duplicate join; preserve immutable history and test membership/notices separately.

## Migration Plan

1. Freeze this contract revision as a sole child of current `develop` and obtain fresh independent docs Review.
2. On one clean source child, add deterministic controls for paired activation, real World stop-before-start replacement, full republish, UI/result independence, and overlap coalescing alongside the retained Domain reset controls.
3. Add the independently fenced World reset/rejoin to the existing ready-state AppButton manual-refresh composition; preserve the existing Domain reset and common SESSION classifier.
4. Finish source, test, comment, task-truth, and documentation changes before running the exact focused/full repository gates and fresh exact-bound Inspector Review.
5. Keep the change unmerged and undeployed unless later delivery authority explicitly includes those actions.

Rollback is source-only: revert the focused Runtime repair and its matching tests. There is no data, wire, schema, version, API, or peer migration.
