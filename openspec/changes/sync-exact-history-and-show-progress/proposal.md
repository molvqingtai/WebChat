## Why

Every new peer session currently retransmits the provider's eligible history window even when the requester already stores the same records. The resulting duplicate wire, validation, and persistence work also makes the existing receipt-time Toast unable to distinguish real history insertion from an all-existing response.

WebChat needs one current-only History design that exchanges an exact paged message-ID inventory, transfers only missing records, and owns truthful loading feedback through the same synchronization lifecycle.

## What Changes

- **BREAKING** Replace `HistoryCursor`, `HistoryRequestMessage`, and `HistoryResponseMessage` with exactly two wire variants: paged `HistoryMessagesRequest` inventory pages and paged `HistoryMessagesResponse` missing-record pages.
- Freeze the requester's eligible message-ID inventory for one directional `syncId`; after the complete inventory arrives, freeze the provider's eligible history snapshot and stream only records whose IDs are absent from that inventory.
- Make request and response pages continuous, bounded, replay-safe, and current-connection-only. Establishing a connection and joining the room starts exactly one independent synchronization per direction. Success, cancellation, or failure is terminal for that connection; it never retries or resumes. A later connection starts a new synchronization with a fresh `syncId` and no prior progress.
- Remove the old cursor/full-window History state machine, message types, behavior tests, and every fallback, compatibility, capability-negotiation, or dual-protocol path. Advance the isolated peer protocol generation so old and new History shapes never share a room namespace.
- Keep receiver-side serial `insert-if-absent` as the final race boundary. Request receipt and response sending create no user feedback.
- Show one loading Toast per `syncId` only after at least one received History record is actually inserted. Project exact copy `Syncing message history...` with no count to every current same-domain Tab, including a Tab that attaches while the owner is active, and actively dismiss only that synchronization's Toast when the response completes or the attempt is canceled; use no fixed duration or success conversion.
- Preserve live text/reaction behavior, local record shape, storage schema, notifications, unread attention, system notices, generic error feedback, and the rule that message protocols never confirm or infer a remote peer's online, receipt, handling, or persistence state.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `peer-wire-protocol`: Replace the public History wire shapes, schemas, limits, pagination rules, and protocol-generation boundary with the exact-ID inventory contract.
- `webrtc-runtime`: Replace History orchestration end to end and bind one truthful, operation-owned loading Toast to actual insertion and local attempt completion.

## Impact

- Affected protocol: public History types/schemas, the Chat wire union, protocol limits, codec fixtures, and current Chat/World room generation.
- Affected Runtime/application behavior: History requester/provider state, local supplier projection, page delivery and persistence settlement, attempt cleanup, and same-domain History loading feedback.
- Affected verification: strict wire rejection, inventory/difference pagination, fixed snapshots, replay/order/caps, one synchronization per connection and direction, terminal same/different-`syncId` rejection, independent next-connection recomputation, concurrent insertion races, per-sync Toast ownership, completion/cancellation dismissal, and deletion of the old full-window path.
- Unchanged: dependencies, durable record/database shape, live messages, Session/World semantics, HLC/LWW rules, Room transport contract, local delivery ACK infrastructure, notifications, unread attention, system notices, and remote delivery guarantees.
