## Context

The application connection request owns `ConnectionRequestState` until `ChatRoom.joinRoom()` returns. The Runtime-backed adapter currently waits for callback registration, inbound replay, and replay persistence before it requests the Runtime join. After physical Chat and World acceptance and session projection, `RuntimeServer.joinChatRoom()` still waits for another active Presence save before returning its snapshot.

Task #422 added one uncommitted diagnostic test on `develop@d7fa3d386250aee22a740ca84e3cd29dadbbc724`, SHA-256 `256872c6688aedeb03859a75ac68ec331fb48bfe3ef0d12434a7aebde72dad27`. Two identical final-byte runs produced four intentional RED controls and one lifecycle PASS:

- an unresolved browser Presence tail yields one projected local user while page completion and loading remain pending;
- unresolved callback registration, replay, or replay persistence each yields zero users and no physical connection request while page completion and loading remain pending; and
- a reopen inside five seconds reuses the domain Chat peer and dedicated World owner, while a post-grace reopen creates a new domain Chat peer and obtains or reuses the World owner according to current site demand.

The evidence does not identify which of the three zero-user requests hangs in the field. It also does not prove that `pageId` metadata or provider callback re-registration is the repair.

Owner smoke on source exact `8c4905804b49669ad748ee3a55ac708a90bb3d46` then exposed a separate shell boundary. `content/index.tsx` awaits browser-sync/local configuration and MessageStore preparation, then the initial `ClientLease` registration, before creating the Shadow UI. Either catch path returns with no launcher or panel; the observed Runtime path logs `Shared runtime unavailable: Runtime control-plane request timed out`. Those terminals are valid dependency truth but incorrectly own whether the product surface mounts.

## Goals / Non-Goals

**Goals:**

- Make every current page connection attempt reach success, failure, or cancellation within a finite owned lifecycle.
- Preserve callback registration and replay durability before physical connection without permitting either to strand page loading.
- Let a committed connection and accepted current snapshot settle page success independently of active Presence persistence.
- Prevent a timed-out, released, or superseded attempt or persistence tail from blocking a later current generation.
- Mount the existing launcher and openable panel shell once before browser-sync/local configuration, MessageStore, or Runtime bootstrap can fail.
- Present any bootstrap terminal as one visible, accessible, retryable degraded state; ignite each dependency-backed Domain only after its prerequisite is ready and recover the same mounted shell in place.
- Preserve current same-domain grace, room reuse/release, local active-presence cleanup, and request-local stale fencing.

**Non-Goals:**

- No assumption about which callback/replay/IndexedDB request hangs in the field.
- No required `pageId` transport metadata, provider callback re-registration design, or Injector/Provider API change.
- No shortcut that connects before required callback registration and replay persistence finish.
- No additional peer message, public port, origin-database schema/version, message-history behavior, or release authority beyond the current active-presence and physical-departure model.
- No success feedback, decorated or replacement error copy, panel visual redesign, automatically opened panel, or second Runtime-readiness authority; structured diagnostic context remains internal while a genuine current-page failure keeps its original `error.message`.
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

Once the current Runtime generation has physically accepted the required Chat publication and World site contribution, committed the domain, and can return a snapshot containing the local session, page connection success SHALL settle from that committed fact. Any active Presence persistence remaining after commit SHALL continue under Runtime persistence ownership and SHALL not be awaited by the page join completion, reopen application loading, or reverse the committed snapshot solely because it is slow.

Active Presence persistence still requires a finite failure/timeout owner. Its per-domain queue SHALL release or supersede an unresolved predecessor so later current-generation persistence and final release are not permanently serialized behind it. A late old completion SHALL not overwrite, retire, or report success for a newer Presence generation. Failure SHALL use the existing Runtime error path; it SHALL not add or modify Toast behavior or create a second page request.

This decision applies only to active post-commit persistence. Final release SHALL retain one local release owner: it removes the private active-generation authority, releases the domain State, physically departs the domain Chat peer, and removes that domain's World contribution without an outbound lifecycle message. The dedicated World peer departs only after its final site is removed. No in-flight end, retryable end, end-send settlement, or settled-cleanup phase exists. A required local active-record cleanup failure remains a release failure and is not converted into success by this change, but physical departure SHALL wait on no peer end signal.

Alternative rejected: keep the page request attached to the Presence tail and merely add a longer loading duration. A non-settling Promise has no finite duration and continues to poison later domain work.

### 4. Page replacement and the five-second lifecycle remain connection truth

An ordinary page-context refresh while the authoritative physical tab binding remains SHALL start no grace, retain the current domain Chat peer plus dedicated World owner and contribution, and give the replacement page an independent connection attempt. A page returning during an actual five-second domain grace SHALL cancel that grace, reuse those same committed scoped peers, and independently settle from the current Runtime snapshot. Neither replacement SHALL inherit the prior page's pending operation or loading owner. After grace expires and release completes, a later page SHALL create one new domain Chat peer and SHALL reuse the dedicated World peer when another site retains it or create a new World peer when no site retains World demand.

The repair SHALL not start grace for an ordinary page-context refresh while the authoritative physical tab binding remains, change the grace duration, or weaken generation fencing and current local release ownership.

### 5. The contract is mechanism-neutral where evidence is incomplete

The implementation MAY use existing request IDs, generations, abort signals, deadlines, queue tokens, or smaller direct composition, provided it satisfies the terminal and stale-result behavior above with minimum human-readable code. It SHALL not add `pageId` business data, provider re-registration, callback fencing, a compatibility path, or another state owner merely because those were investigation hypotheses.

### 6. Bootstrap dependencies do not own the panel shell

Once the content script runs and receives the existing body anchor, it SHALL create one Shadow UI root, launcher, and openable panel shell before awaiting browser-sync/local configuration, MessageStore, or Runtime bootstrap results. Dependency `connecting`, deadline expiry, rejection, or unavailable MAY gate only the capabilities that need that dependency. It SHALL not return before shell mount, remove the launcher, blank an already mounted panel, or create another root/store on retry.

Each bootstrap generation SHALL own one finite result for every attempted dependency. Before a prerequisite is ready, the application SHALL not ignite its dependent Domain, automatic join, database read/write, callback, or other side effect. Independent shell controls remain usable. A genuine failure before the full application is ready and owned by the current page SHALL leave one visible generic unavailable state and one keyboard-operable, accessibly named Retry action inside the mounted shell, while the existing application error route presents exactly the original `error.message` with no prefix, suffix, wrapper, mapping, normalization, or replacement copy. A failure with no current affected page/live route or no user impact SHALL call `console.error(error)` directly. Runtime-only failure after the application is ready SHALL continue through the sole existing `ReadinessDomain`, generic feedback, and retry/reconnect behavior rather than create another Runtime state owner.

One Retry SHALL create one fresh bounded bootstrap generation, reuse already valid dependency results where safe, and fence every late result from the failed generation. If all required dependencies become ready, the same root SHALL ignite each dependent Domain exactly once and recover the normal UI without requiring a document reload. If Retry fails, its loading owner SHALL settle back to the same accessible unavailable state. Reload or genuine document replacement SHALL mount one fresh shell and start one fresh generation; old work remains fenced by the existing attempt rules.

The shell continuity rule changes no Runtime truth. Runtime `connecting | ready | unavailable`, `Connection failed`, ready dismissal, manual reconnect ownership, Chat/World prerequisites, and current local release remain authoritative after their dependencies are available. It adds no success feedback, second Toast/Readiness owner, decorated or replacement copy, structured diagnostic detail in user-facing text, or panel visual redesign.

### 7. Verification preserves RED sensitivity without shipping diagnostic bulk

Focused tests SHALL prove all four pending boundaries against application-observable users/loading/completion, not only internal calls. The repaired exact SHALL turn them into terminal outcomes while keeping the lifecycle control green. Existing tests SHOULD be extended where they express the same contract; the 481-line diagnostic trace is evidence, not a requirement to ship a parallel harness or production trace API.

## Risks / Trade-offs

- [An active Presence save can fail after page success] -> Keep that persistence under a bounded Runtime owner and surface its existing error independently; do not redefine the already committed connection or local release rules.
- [Timing out prerequisite work can leave partial callbacks] -> Require attempt-owned cleanup and stale-generation rejection before allowing a fresh attempt.
- [A finite deadline can reject a genuinely slow browser operation] -> Keep the deadline implementation-owned and deterministic, reuse existing cancellation/error semantics, and make retry/new-page admission fresh rather than permanently blocked.
- [Resetting a persistence tail can admit late old work] -> Fence late completion against the current Presence generation and prove later persistence/release remains authoritative.
- [Field zero-user evidence is not request-unique] -> Cover callback registration, replay, and replay persistence under the same terminal contract instead of guessing one provider bug.
- [Mounting before preparation can ignite code with missing dependencies] -> Keep the shell bootstrap-independent and gate each Domain/side effect until its own prerequisite is ready.
- [A late failed generation can overwrite recovered UI] -> Give bootstrap and Retry one current generation and ignore every superseded result without remounting the root.

## Migration Plan

1. Publish the shell-continuity authority as a docs-only child of repaired source exact `8c4905804b49669ad748ee3a55ac708a90bb3d46` on the existing single requirement branch and Draft PR.
2. Add the minimum parent-sensitive regressions for absent mount on storage-preparation and Runtime startup failure, dependency gating, in-place recovery, and generation fencing.
3. Mount the bootstrap-independent shell first, then ignite each dependency-backed Domain only after its prerequisite is ready and reuse the existing Runtime readiness/feedback authorities once available.
4. Run exact-bound source gates, fresh independent Review, CI, and nonblocking Chrome/Firefox behavior observation.
5. Request Owner authorization only for final merge; stop on branch, exact, or remote drift.

Rollback is code-only: revert the focused settlement repair while preserving this requirement history. No data migration, protocol compatibility, or user action is required.

## Open Questions

None. The unknown concrete zero-user field request is intentionally covered by one evidence-based terminal contract and does not require a product choice before implementation.
