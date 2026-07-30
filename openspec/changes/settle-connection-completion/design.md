## Context

The application connection request owns `ConnectionRequestState` until `ChatRoom.joinRoom()` returns. The Runtime-backed adapter currently waits for callback registration, inbound replay, and replay persistence before it requests the Runtime join. After physical Chat and World acceptance and session projection, `RuntimeServer.joinChatRoom()` still waits for another active Presence save before returning its snapshot.

Task #422 added one uncommitted diagnostic test on `develop@d7fa3d386250aee22a740ca84e3cd29dadbbc724`, SHA-256 `256872c6688aedeb03859a75ac68ec331fb48bfe3ef0d12434a7aebde72dad27`. Two identical final-byte runs produced four intentional RED controls and one lifecycle PASS:

- an unresolved browser Presence tail yields one projected local user while page completion and loading remain pending;
- unresolved callback registration, replay, or replay persistence each yields zero users and no physical connection request while page completion and loading remain pending; and
- a reopen inside five seconds reuses the physical Chat and World rooms, while a post-grace reopen joins new rooms after release.

The evidence does not identify which of the three zero-user requests hangs in the field. It also does not prove that `pageId` metadata or provider callback re-registration is the repair.

## Goals / Non-Goals

**Goals:**

- Make every current page connection attempt reach success, failure, or cancellation within a finite owned lifecycle.
- Preserve callback registration and replay durability before physical connection without permitting either to strand page loading.
- Let a committed connection and accepted current snapshot settle page success independently of active Presence persistence.
- Prevent a timed-out, released, or superseded attempt or persistence tail from blocking a later current generation.
- Preserve current same-domain grace, room reuse/release, final-retirement durability, and request-local stale fencing.

**Non-Goals:**

- No assumption about which callback/replay/IndexedDB request hangs in the field.
- No required `pageId` transport metadata, provider callback re-registration design, or Injector/Provider API change.
- No shortcut that connects before required callback registration and replay persistence finish.
- No change to peer wire, public ports, schema/version, message history semantics, active/final Presence record shapes, or release ordering.
- No Toast text, duration, success feedback, readiness, panel, or bootstrap change.
- No permanent production trace surface unless implementation evidence proves it necessary.

## Decisions

### 1. One page attempt owns every pre-connection wait and terminal result

One accepted application connection request SHALL map to one current page/host generation attempt. That attempt SHALL own a finite deadline and cancellation boundary across callback registration, replay loading, replay persistence, Runtime join, and current snapshot acceptance.

Success, failure, and cancellation SHALL settle only the matching application request. A late result from a released, timed-out, or superseded attempt SHALL not clear a newer request, apply a stale snapshot, publish a stale callback, or start a physical join. The existing application failure and cancellation paths remain the user-visible terminal surfaces; no second loading or result owner is added.

Alternative rejected: add a Toast timeout or unconditional dismissal. Presentation does not own `ConnectionRequestState` and cannot release a pending adapter or Runtime request.

### 2. Callback registration and replay remain prerequisites but become disposable

Callback registration, inbound replay, and replay-record persistence SHALL still complete before `RuntimeServer.joinChatRoom()` is requested. This preserves the established no-gap ordering between live callbacks, retained inbound records, and the initial Runtime snapshot.

If one prerequisite reaches the attempt deadline, rejects, or loses its page/host generation, the adapter SHALL fail or cancel the matching attempt, dispose every partial registration/resource it owns, abort persistence where the existing Database boundary supports it, and permit the next attempt to create fresh prerequisite work. A still-pending old promise SHALL not remain the admission gate for a new page or retry. Late completion SHALL be ignored by the current generation.

Alternative rejected: accept the snapshot before replay. The trace proves where the pending state occurs, not that replay ordering is unnecessary.

### 3. Post-commit active Presence persistence does not own page success

Once the current Runtime generation has physically accepted the required Chat and World publications, committed the domain, and can return a snapshot containing the local session, page connection success SHALL settle from that committed fact. Any active Presence persistence remaining after commit SHALL continue under Runtime persistence ownership and SHALL not be awaited by the page join completion, reopen application loading, or reverse the committed snapshot solely because it is slow.

Active Presence persistence still requires a finite failure/timeout owner. Its per-domain queue SHALL release or supersede an unresolved predecessor so later current-generation persistence and final release are not permanently serialized behind it. A late old completion SHALL not overwrite, retire, or report success for a newer Presence generation. Failure SHALL use the existing Runtime error path; it SHALL not add or modify Toast behavior or create a second page request.

This decision applies only to active post-commit persistence. Final release SHALL retain the existing durable retirement, SESSION_END settlement, cleanup, and physical departure ordering. A final-retirement failure remains a release failure and is not converted into success by this change.

Alternative rejected: keep the page request attached to the Presence tail and merely add a longer loading duration. A non-settling Promise has no finite duration and continues to poison later domain work.

### 4. Page replacement and the five-second lifecycle remain connection truth

An ordinary page-context refresh while the authoritative physical tab binding remains SHALL start no grace, retain the current physical Chat and World rooms, and give the replacement page an independent connection attempt. A page returning during an actual five-second domain grace SHALL cancel that grace, reuse the same committed physical rooms, and independently settle from the current Runtime snapshot. Neither replacement SHALL inherit the prior page's pending operation or loading owner. After grace expires and release completes, a later page SHALL create new physical rooms through the existing join path.

The repair SHALL not start grace for an ordinary page-context refresh while the authoritative physical tab binding remains, change the grace duration, or weaken generation fencing and durable final release.

### 5. The contract is mechanism-neutral where evidence is incomplete

The implementation MAY use existing request IDs, generations, abort signals, deadlines, queue tokens, or smaller direct composition, provided it satisfies the terminal and stale-result behavior above with minimum human-readable code. It SHALL not add `pageId` business data, provider re-registration, callback fencing, a compatibility path, or another state owner merely because those were investigation hypotheses.

### 6. Verification preserves RED sensitivity without shipping diagnostic bulk

Focused tests SHALL prove all four pending boundaries against application-observable users/loading/completion, not only internal calls. The repaired exact SHALL turn them into terminal outcomes while keeping the lifecycle control green. Existing tests SHOULD be extended where they express the same contract; the 481-line diagnostic trace is evidence, not a requirement to ship a parallel harness or production trace API.

## Risks / Trade-offs

- [An active Presence save can fail after page success] -> Keep that persistence under a bounded Runtime owner and surface its existing error independently; do not redefine the already committed connection or final-retirement rules.
- [Timing out prerequisite work can leave partial callbacks] -> Require attempt-owned cleanup and stale-generation rejection before allowing a fresh attempt.
- [A finite deadline can reject a genuinely slow browser operation] -> Keep the deadline implementation-owned and deterministic, reuse existing cancellation/error semantics, and make retry/new-page admission fresh rather than permanently blocked.
- [Resetting a persistence tail can admit late old work] -> Fence late completion against the current Presence generation and prove later persistence/release remains authoritative.
- [Field zero-user evidence is not request-unique] -> Cover callback registration, replay, and replay persistence under the same terminal contract instead of guessing one provider bug.

## Migration Plan

1. Publish this OpenSpec authority as a docs-only child of `develop@d7fa3d386250aee22a740ca84e3cd29dadbbc724` on the single requirement branch and open or reuse its single Draft PR.
2. Adapt the task #422 RED controls into the minimum focused regressions, preserving the four application signatures and lifecycle control without committing unnecessary diagnostic tracing.
3. Implement attempt-owned prerequisite settlement and independent post-commit active Presence persistence on the same branch.
4. Run exact-bound source gates, fresh independent Review, CI, and nonblocking Chrome/Firefox behavior observation.
5. Request Owner authorization only for final merge; stop on branch, exact, or remote drift.

Rollback is code-only: revert the focused settlement repair while preserving this requirement history. No data migration, protocol compatibility, or user action is required.

## Open Questions

None. The unknown concrete zero-user field request is intentionally covered by one evidence-based terminal contract and does not require a product choice before implementation.
