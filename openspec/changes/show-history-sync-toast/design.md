## Context

Each valid history-response batch reaches the application/page boundary before its messages attempt canonical insert-if-absent persistence in the origin store. History application currently suppresses notifications, unread attention, and system notices, while the mounted generic Sonner surface already shows at most one Toast and supports a finite loading entry when a duration is supplied.

See `proposal.md` for the product motivation and `specs/webrtc-runtime/spec.md` for the observable contract.

## Goals / Non-Goals

**Goals:**

- Show one exact loading Toast as soon as each valid history-response batch containing at least one message is received.
- Use only the existing nonempty-batch fact and add no count propagation, aggregation, storage, or display.
- Give the Toast an exact `3000ms` presentation duration with no synchronization-owned ending action.
- Let a later nonempty batch use the existing one-visible-Toast behavior instead of accumulating, queueing, or coordinating batch feedback.
- Keep feedback independent from insertion completion, synchronization completion, acknowledgement, and failure.

**Non-Goals:**

- Showing request-start, waiting, empty-response, success, failure, or completion feedback.
- Adding a synchronization progress state, count, accumulator, Toast lifecycle owner, manual dismissal command, terminal conversion, replay, or cross-tab feedback protocol.
- Changing notification, unread-attention, system-notice, history-window, pagination, budget, timeout, failover, persistence, acknowledgement, or message projection behavior.
- Changing the generic Toaster, Toast geometry, styling, stacking, dependency, Runtime graph, peer protocol, storage schema, or public API.

## Decisions

### 1. Receipt of a nonempty batch defines the trigger

For one valid history-response batch at the application/page boundary, the existing fact that the batch contains at least one message is the complete feedback trigger. A nonempty accepted batch qualifies even if all of its messages are already stored locally or its later insertion work adds nothing.

The feature does not inspect insertion results or derive, propagate, aggregate, store, or display a count. An existing empty completion response contains no received message and therefore does not qualify.

### 2. Feedback starts when the batch is received

Receipt handling for a nonempty valid batch publishes exactly `Syncing message history` through the existing generic Toast capability with loading kind and `3000ms` duration. It does so without waiting for or inspecting insert-if-absent completion.

Request creation, provider discovery, waiting, an absent response, and an empty completion response publish nothing. A response rejected before the application/page receipt boundary also cannot publish. Toast rendering cannot delay or redefine persistence, acknowledgement, pagination, or the next batch.

### 3. The Toast has presentation time, not operation lifetime

The loading kind is the confirmed presentation. It does not mean the Toast owns an active synchronization request. No synchronization state updates, cancels, or converts this Toast. Its supplied `3000ms` duration is the only ordinary automatic ending rule; actual surface teardown retains its existing behavior.

### 4. Every batch remains independent

Each nonempty valid response batch may publish the same Toast once. No whole-sync accumulator, delayed completion publication, or batch-feedback queue is added. When another qualifying batch publishes while the earlier Toast is visible, the existing generic one-visible-Toast behavior covers the earlier presentation and the later Toast receives its own `3000ms` duration.

### 5. Existing history side-effect exclusions remain

History application still creates no notification, unread-attention mark, or system notice. A Toast is the sole new visible side effect and is driven by receipt of a nonempty valid history batch. Duplicate or replayed messages do not suppress it because this feedback communicates active history synchronization rather than newly inserted records.

### 6. Controls cross the real result boundary

Deterministic controls shall drive batches through the production history-response receipt boundary. They cover a nonempty batch while insertion remains unsettled, all-existing replay, an empty completion response, a response rejected before the boundary, successive nonempty batches, exact copy/kind/duration, no request-start publication, no manual cancel or success conversion, and independence from insertion, acknowledgement, and continuation.

## Risks / Trade-offs

- [Insertion or synchronization may continue after the Toast appears] -> This is intentional receipt-time feedback; the Toast does not own either lifecycle.
- [Several batches may arrive within three seconds] -> The later qualifying batch uses the existing one-visible-Toast behavior; no accumulator or queue is introduced.
- [A batch may contain only messages already stored locally] -> It still shows the Toast because the copy communicates active message-history synchronization and reports no addition count.
- [A qualifying Toast can cover unrelated feedback on the one-visible surface] -> Preserve the existing generic surface policy rather than adding a source-specific renderer or stack.
- [The Toast surface may be absent] -> Persistence and synchronization continue unchanged, and feedback is not replayed later.

## Open Questions

None.
