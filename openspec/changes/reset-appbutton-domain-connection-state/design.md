## Context

See `proposal.md` for the product problem and `specs/webrtc-runtime/spec.md` for normative behavior.

The released Runtime already replaces the current domain's physical Chat peer through the existing application `leaveRoom()` / `joinRoom()` composition and the internal reconnect attempt. That attempt rotates physical identity and ultimately uses the normal room join and SESSION publication flow. Its session preparation, however, currently carries the domain's persisted remote observer ledger into the replacement. An observer entry can remain `ended` after a pending leave expires, and the SESSION receive guard rejects a valid same-generation message before it reaches the replacement member snapshot.

The complete last-tab release does clear the domain's committed/prepared sessions, observer ledger, pending leaves, and baseline, but it also retires local logical presence, updates World demand, removes the page lease after grace, and releases broader domain ownership. AppButton Refresh must reuse only the clean connection-state boundary, not impersonate final domain release.

## Goals / Non-Goals

**Goals:**

- Give manual Refresh one explicit full current-domain connection-destruction boundary before replacement preparation and inbound synchronization.
- Reuse the canonical connection attempt, Wire validation, SESSION processing, and commit flow after reset.
- Preserve the active local logical presence generation while preventing every remote connection/observation fact from crossing attempts.
- Keep cleanup, reset, attempt, and stale work causally fenced and domain-scoped.
- Make the regression fail on the released source for the diagnosed tombstone mechanism and pass only when the full contract holds.
- Make the shared SESSION classifier recover every legitimate same-presence physical replacement while retaining terminal rejection for genuinely stale work.

**Non-Goals:**

- Calling final domain release or changing last-page grace, durable logical-presence retirement, World demand, or page lease ownership.
- Adding a public reconnect/reset method, a new peer message, SESSION retry/reconciliation, a tombstone exception, or an observer expiry policy.
- Clearing persistent messages, user configuration, page-owned UI state, the World peer, or another domain.
- Refactoring unrelated connection recovery or presentation behavior.
- Treating last arrival, `sessionId` alone, or an untrusted sender assertion as logical-generation authority.

## Decisions

### 1. Manual reconnect destroys the complete current-domain connection aggregate

The accepted manual reconnect generation will first fence the prior current-domain generation and invoke one coordinated destruction transition across the existing domain owners. It removes the current domain's physical Chat transport owner and trusted membership, Connection attempts/generation-owned work and old readiness, all Session and observer state except the separately retained local logical seed, History requester/provider/supply/binding/feedback work, volatile Delivery/batch state, pending leaves, baselines, queues, callbacks, timers, and recovery work. Destruction settles before the replacement prepares or receives authoritative inbound SESSION data.

This is not a second state owner: Connection continues to sequence the operation; Wire/transport, Session, History, Delivery, and Lifecycle each clear or preserve only the facts they already own. The orchestration expresses one causal boundary across their existing CQRS transitions. Lifecycle retains the exact page lease and current reconnect request but contributes no prior readiness result. World is outside the destroyed aggregate.

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

### 4. Reset and publication are narrowly domain-scoped

The reset key is the exact current domain. World ownership and desired sites are not changed, and other domain records are not traversed or rewritten. Persistent messages remain in the existing origin database and page/user settings remain outside Runtime connection cleanup. Current same-domain pages keep their leases and receive the new committed Runtime snapshot through their existing subscription.

Structural and behavioral controls will capture protected identities before activation and compare them afterward: World physical identity and site snapshot, another domain's full Runtime/Chat/History/Delivery state, persistent message records, user configuration, page lease/identity/state, and the public/protocol source surfaces. Candidate-sensitive controls will also inspect the destroyed domain at the boundary before the new attempt to prove that no transport, trusted room, attempt/readiness, Session, History, Delivery, queue, timer, callback, or recovery fact remains.

### 5. Verification starts with the diagnosed four-member failure

The fail-before fixture will establish four real logical members under healthy transport, create the same remote `ended` observation that currently survives reconnect, and prove the released reconnect remains at three while the complete release/reopen control reaches four. The candidate assertion then requires one AppButton-equivalent manual reconnect to reach four.

Additional assertions will prove complete destruction across every enumerated connection-state family, new physical identity plus stable logical identity, one same-domain replacement shared by multiple pages, protected data/scope identity, stale work fencing, and unchanged public/wire source. The test inventory will enumerate every lifecycle entry that can deliver a SESSION for an existing `presenceId` and classify whether it intentionally retains the same live connection or requires an independent clean boundary. A healthy four-member setup is a control; changing only UI count or fixtures cannot satisfy the test.

### 6. Legitimate rebind uses current physical provenance, not arrival order

The common SESSION classifier will distinguish observer-stale state from truly stale input using evidence already present at the Runtime boundary. A legal correction must arrive from the currently trusted Chat room generation and currently admitted source, carry a new physical `sessionId` rather than the ended binding's id, and exactly match the observer's accepted `presenceId`, `user.id`, and `joinedAt`. No newer active binding or logical generation may conflict. The classifier then replaces only the old physical binding, marks the same logical observation active, cancels/fences matching old leave work, and lets existing snapshot/History flows converge.

A delayed frame from an old room/source/attempt, an exact replay of the ended physical `sessionId`, an identity/time mutation, or a presence already superseded by a newer accepted generation remains terminally rejected. This preserves the meaningful anti-replay boundary without treating an observer's fallible local five-second physical-loss inference as permanent proof that the remote logical generation ended. Because v5 has no peer `SESSION_END`, an `ended` observer created only from local PeerLeave expiry is corrected by current physical provenance; “truly stale” here means the physical/logical exclusions above, not that the local tombstone alone is infallible.

Alternative rejected: accept the last SESSION by arrival time. Delivery order is not logical causality and would allow delayed frames to overwrite current state.

Alternative rejected: accept any new `sessionId`. `sessionId` is sender data and becomes relevant only together with current trusted transport provenance, exact logical binding, and generation fences.

Alternative rejected: keep the global ended guard and repair only Refresh. Automatic recovery or another lifecycle path could still present the same current physical evidence against a stale observer record, leaving the underlying classifier inconsistent.

## Risks / Trade-offs

- [A late callback from the discarded generation mutates new state] -> Fence reset and replacement by the current reconnect operation/generation and test delayed SESSION, leave timer, cleanup, and terminal callbacks.
- [Over-broad cleanup behaves like final release] -> Retain local logical identity, page leases, World demand, and persistent/page data explicitly; compare protected identities before and after Refresh.
- [A partial reset removes Session state but leaves another connection owner alive] -> Assert every contract-listed transport, Wire, Connection, Session, History, Delivery, queue, timer, and recovery family is absent at replacement start and cannot affect commit.
- [Reset persistence fails] -> Keep the reconnect request failed/retryable without committing a mixed old/new snapshot; do not start the replacement until required cleanup settles.
- [No peer is currently ready to resend SESSION] -> Preserve existing canonical readiness/catch-up behavior; this change adds no new retry guarantee or protocol message.
- [Reactivating observer-stale state admits a replay] -> Require current trusted room/source provenance, a new physical binding, exact logical identity/time, no newer conflict, and controls for every excluded stale class.
- [A prior observer-local leave notice already exists] -> Restore the same logical generation without manufacturing a duplicate join; preserve immutable history and test membership/notices separately.

## Migration Plan

1. Freeze this docs-only change as a sole child of `develop@1119ce1045d0138e283ca417ffdab3e1b293c402` and obtain fresh independent docs Review.
2. On one clean source child, add the deterministic fail-before and protected-boundary controls before implementation.
3. Implement complete current-domain connection destruction and sequence the existing replacement attempt after settlement; remove every old reconnect carry-over behavior in the same candidate.
4. Repair the common SESSION classifier for current-provenance same-presence replacement and cover every lifecycle entry plus true stale replay controls in that same source candidate.
5. Run focused and full repository gates plus fresh exact-bound Inspector Review. Keep the change unmerged and undeployed unless later delivery authority explicitly includes those actions.

Rollback is source-only: revert the focused Runtime repair and its matching tests. There is no data, wire, schema, version, API, or peer migration.
