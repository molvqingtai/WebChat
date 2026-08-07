## Context

Each valid history-response batch reaches the application/page boundary and attempts canonical insert-if-absent persistence in the origin store. The insert result already distinguishes a newly accepted message from an existing same-id value. History application currently suppresses notifications, unread attention, and system notices, while the mounted generic Sonner surface already shows at most one Toast and supports a finite loading entry when a duration is supplied.

See `proposal.md` for the product motivation and `specs/webrtc-runtime/spec.md` for the observable contract.

## Goals / Non-Goals

**Goals:**

- Show one exact loading Toast for each history-response batch that actually adds at least one message.
- Derive `count` from canonical newly inserted results rather than response length or requested work.
- Give the Toast an exact `3000ms` presentation duration with no synchronization-owned ending action.
- Let a later qualifying batch use the existing one-visible-Toast behavior instead of accumulating, queueing, or coordinating batch feedback.
- Keep feedback downstream of persistence and independent from synchronization progress, completion, acknowledgement, and failure.

**Non-Goals:**

- Showing request-start, waiting, zero-result, whole-sync-total, success, failure, or completion feedback.
- Adding a synchronization progress state, accumulator, Toast lifecycle owner, manual dismissal command, terminal conversion, replay, or cross-tab feedback protocol.
- Changing notification, unread-attention, system-notice, history-window, pagination, budget, timeout, failover, persistence, acknowledgement, or message projection behavior.
- Changing the generic Toaster, Toast geometry, styling, stacking, dependency, Runtime graph, peer protocol, storage schema, or public API.

## Decisions

### 1. Canonical insertion defines the count

For one history-response batch, `count` is the number of messages whose canonical insert-if-absent result is newly inserted in the current origin store. Payload length is not evidence of a new message. Existing same-id replay, retained conflict winners, invalid or rejected values, and anything outside the applied batch contribute zero.

This keeps feedback on the same fact that makes the message available locally and requires no second record scan, inferred before/after list comparison, or persisted counter.

### 2. Feedback starts only after a positive batch result

After the batch's application work settles, a positive count publishes exactly `Pulled {count} new messages.` through the existing generic Toast capability with loading kind and `3000ms` duration. The exact template applies to every positive integer; no singular variant is introduced.

Request creation, provider discovery, waiting, an absent response, and a zero-new batch publish nothing. Toast rendering cannot delay or redefine persistence, acknowledgement, pagination, or the next batch.

### 3. The Toast has presentation time, not operation lifetime

The loading kind is the confirmed presentation. It does not mean the Toast owns an active synchronization request. No synchronization state updates, cancels, or converts this Toast. Its supplied `3000ms` duration is the only ordinary automatic ending rule; actual surface teardown retains its existing behavior.

### 4. Every batch remains independent

Each qualifying response batch may publish one Toast with that batch's own newly inserted count. No whole-sync accumulator, delayed completion publication, or batch-feedback queue is added. When another qualifying batch publishes while the earlier Toast is visible, the existing generic one-visible-Toast behavior covers the earlier presentation and the later Toast receives its own `3000ms` duration.

### 5. Existing history side-effect exclusions remain

History application still creates no notification, unread-attention mark, or system notice. A Toast is the sole new visible side effect and only for a positive canonical insertion result. Duplicate or replayed batches cannot produce feedback merely because their payload contains messages.

### 6. Controls cross the real result boundary

Deterministic controls shall apply batches through the production history-to-origin-store boundary. They cover mixed new/existing values, all-existing replay, rejected values, successive qualifying batches, exact copy/kind/duration, no request-start publication, no manual cancel or success conversion, and independence from history acknowledgement and continuation.

## Risks / Trade-offs

- [A synchronization may continue after the Toast appears] -> This is intentional per-batch acknowledgement; the Toast is not progress or completion state.
- [Several batches may arrive within three seconds] -> The later qualifying batch uses the existing one-visible-Toast behavior; no accumulator or queue is introduced.
- [A payload can contain many already stored messages] -> Count only canonical newly inserted results, so the copy reports actual local additions.
- [A qualifying Toast can cover unrelated feedback on the one-visible surface] -> Preserve the existing generic surface policy rather than adding a source-specific renderer or stack.
- [The Toast surface may be absent] -> Persistence and synchronization continue unchanged, and feedback is not replayed later.

## Open Questions

None.
