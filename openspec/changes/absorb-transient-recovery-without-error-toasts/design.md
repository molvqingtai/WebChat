## Context

WebChat spans Content pages, a browser Background, and a physical Runtime that owns Chat and World Rooms. Chrome and Edge place that Runtime in an Offscreen document so a normal MV3 Background idle/restart does not end Room work. Firefox keeps it in the persistent Background. A full extension reload is different: the old Content endpoint cannot join the new extension generation, so the old document remains non-ready until it refreshes, navigates, closes, or is otherwise superseded.

Connection lifecycle is controlled only by structural facts: current page and Runtime generations, current Room ownership, current Presence revision, and live request continuations. Error text, name, type, constructor, code, and value never determine retry, readiness, cancellation, or settlement.

## Goals / Non-Goals

**Goals:**

- Keep raw relay and probe traffic available across Background startup without waiting for business-state reconstruction.
- Preserve healthy physical Runtime and Room work across normal Chrome and Edge MV3 Background idle/restart.
- Keep an old document non-ready and boundedly polling after a full extension reload until its own lifecycle ends.
- Give every current page, Chat attempt, World attempt, whole publication, release, send, and error one generation-scoped in-memory owner.
- Clean only a Room handle created but not committed by the failing or canceled attempt.
- Publish each latest full Presence revision through one World owner and one explicit logical-recipient array call, and complete a live domain release even when no page binding remains.
- Surface every distinct real local failure as a fresh original-message toast on every current affected page.
- Keep local send acceptance, native selected-array first-error interruption, and History no-result semantics explicit.

**Non-Goals:**

- Persisting lifecycle owners, retry outcomes, delivery cursors, outboxes, per-target attempts, cleanup journals, or compare-and-swap state.
- Classifying lifecycle from error content or suppressing, merging, updating, throttling, normalizing, or rewriting genuine errors.
- Automatically refreshing pages or adding programmatic injection, permissions, manifest paths, user-facing retry UI, status surfaces, or settings.
- Changing canonical message data, ordering, Room trust, Runtime networking protocols, dependencies, or remote delivery guarantees.

## Decisions

### 1. Transport remains available before business bootstrap

Content, Runtime, and tab listeners install synchronously before any awaited work. Trusted raw relay and probe responses forward or settle immediately. Business envelopes retain their exact sender and resume exactly once after the current Background reconstructs the minimum facts it needs from the event, current tabs, and the physical Runtime probe. A stale sender, page, navigation, or target is dropped and its old in-memory owner is canceled.

### 2. Browser Background and physical Runtime have separate lifecycles

A normal Chrome or Edge MV3 Background idle/restart preserves the Offscreen Runtime, healthy Rooms, and in-flight Runtime owners. Firefox uses its persistent Background Runtime. A missing or replaced physical Runtime identity invalidates the old Runtime generation, marks affected pages non-ready, pauses sends, and cancels old page, domain, Room, and publication owners. One current Background in-memory single-flight creates or adopts the replacement host. The Background fans invalidation only to live pages it currently knows; other pages rejoin through their next live register or watchdog event.

### 3. Full extension reload keeps the old document non-ready

After a full extension reload, the old Content document does not automatically recover into the new extension generation. While that document remains current, its existing watchdog performs ordinary control-plane polls at a bounded cadence. Every real failed send or timeout is a new Content-local failure and therefore a fresh original-message toast. Refresh, navigation, close, or supersession cancels the polling owner and invalidates late results. The extension never refreshes or reinjects the page automatically.

### 4. Page readiness is exact and repairable

A page owner is keyed by page, navigation, and Runtime generation. It owns the attach lease, the complete callback set, and the current snapshot. The page is ready only when those facts, its domain Chat, the host World, and the latest Presence revision are all current. An attach or repair failure leaves only that page non-ready, surfaces the failure, waits boundedly, and retries while the same page owner remains current.

### 5. Each Room attempt owns only its uncommitted handle

Chat and World recovery use one live in-memory attempt at a time. A join attempt lasts at most ten seconds and records only an optional handle that it created. Chat commits only after join and current Session publication; World enters its sole Presence publication owner after join. For the direct post-join continuation, the call site sleeps one second, re-checks its exact attempt, and only then derives current logical recipients; it does not snapshot recipients before sleeping. Successful commit transfers an attempt-created handle out of attempt cleanup. Failure or cancellation performs one idempotent leave only for an attempt-created, uncommitted handle; a reused or committed Room is never left by attempt cleanup. A cleanup throw is another real failure, but cleanup does not gain a second owner or journal and cancellation still completes. A current Room close enters the same recovery path, while a close from an older generation is dropped.

### 6. World publication has one array request and preserves continuation

Every World publication enters one current owner that freezes the latest full Presence revision and one distinct logical-recipient array. A non-empty revision makes exactly one `room.send(body, peerIds)` call; an empty array makes zero provider calls and settles as successful no-recipient work. A return records local acceptance. A provider throw rejects the one send with the original Error and may interrupt later array targets inside Artico; WebChat does not catch per target, continue later targets itself, or retain per-target accepted/failed results. The revision then follows its existing whole-publication failure settlement and does not require remote acceptance or acknowledgement.

Runtime, Room, or World-owner loss cancels the publication owner. A Presence-revision supersession is different: it stops only the older revision, preserves the Room and original ready or release continuation, and immediately enters the latest revision through the same owner. An already invoked old provider call settles against no current publication slot and is never replayed. Stale close events never invalidate the current physical Runtime.

A valid World demand is either a current page binding or an exact live domain-release continuation. Therefore the last-page release can publish the latest Presence after its page binding is gone. With no live page, a real publication failure is diagnostic. Only a release publication preflight failure that performed zero provider calls retains the same whole-publication request and reissues it at the existing bounded cadence; a provider throw is never retried. The sole successful return is the original continuation.

### 7. Domain and host release use live next-step state

A domain release has one Runtime-local owner and one in-memory next step: leave Chat, remove the domain contribution, publish the latest full Presence through the sole World publication owner, then complete. A preflight failure that made zero provider calls keeps the same step, is surfaced when an affected page is current, and retries boundedly while the owner remains current. A provider-invoked failure settles through the publication's existing failure path and is not retried. A last-page release reaches completion through its release continuation rather than requiring a page binding. Explicit reconnect starts a new domain generation only after the current release completes.

Host disposal similarly advances one in-memory step at a time through idempotent Room leaves and host destruction. Resource absence counts as completion. Background-only release state is not restored after worker loss; the next current event reconciles current tabs and physical Runtime facts.

### 8. Send results and remote no-result outcomes are distinct

Preflight validates the trusted Room, wire payload, encoding, and explicit targets before any provider send. An explicit string or non-empty array is delegated in one `room.send()` call, while an empty array makes no provider call. `room.send()` returning means local acceptance and does not promise remote acknowledgement or delivery. A throw rejects that one call with the original Error and is never retried after provider invocation. For an array, Artico's first selected target throw may interrupt later targets; WebChat adds no per-target loop, containment, result aggregation, retry, or acknowledgement.

A History request may wait for a response only after local acceptance. No response, no retained History, peer departure, or response expiry is a no-result outcome, not an error, toast, acknowledgement, or reason to resend.

### 9. Every distinct real local failure is visible once per event

A current local throw, rejection, or operation-owned deadline has one failure owner. It creates a fresh event identifier with the original message, subsystem, operation, and exact scope. Every current affected page displays that event once, and transport duplicates of the same event are deduplicated within each current Content generation. A later failed attempt is a different event and creates another fresh toast; toasts are not reused, merged, updated, throttled, normalized, or rewritten.

Runtime, Background, and Room errors route only to a current affected page generation. When no such page or route exists, the failure is diagnostic. A failure in error delivery is also diagnostic and never recursively creates another toast. Toast presentation never controls ready, retry, cancellation, or settlement.

Cancellation, supersession, normal leave, stale completion, hostile transport input, and remote no-result outcomes are not product errors.

## Risks / Trade-offs

- [An old document remains open after full reload] -> It stays non-ready and continues bounded polling; every real failed poll remains visible until the document ends.
- [The last page starts domain release] -> Its live release continuation remains valid World demand, so Presence and release can settle without a page binding.
- [A selected publication target throws] -> The one array call rejects with the original Error and may interrupt later Artico targets; WebChat does not retry or continue them through a second loop.
- [No affected page exists for a Runtime failure] -> The failure is diagnostic because there is no valid user-visible destination.
- [The physical Runtime disappears] -> Old generation work is canceled and current callers recover from physical facts without retrying an already called target for the same revision.

## Open Questions

None.
