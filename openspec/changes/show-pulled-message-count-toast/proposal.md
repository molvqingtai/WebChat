## Why

History synchronization can add messages to the current origin store without any visible acknowledgement. A user therefore cannot distinguish a batch that actually pulled new messages from a batch that contained only records already stored locally.

## What Changes

- After each history-response batch settles its canonical insert-if-absent work, count only the messages that the batch newly added to the origin store.
- When that count is greater than zero, publish one generic loading Toast with exact copy `Pulled {count} new messages.` and an exact `3000ms` duration.
- Treat every response batch independently. Do not accumulate a whole-sync count; a later batch uses the existing Toast surface behavior to cover the earlier visible Toast.
- Publish no Toast when a sync request starts, when a batch adds zero messages, or when no response arrives. Do not manually dismiss the Toast or convert it to success when synchronization continues or ends.
- Preserve history pagination, persistence, acknowledgement, notifications, unread attention, system notices, protocol, and every other generic Toast source.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Add finite per-batch feedback for history messages that were actually added to the current origin store.

## Impact

- Affected behavior: visible feedback after application of a history-response batch with at least one newly stored message.
- Affected implementation: the existing application/page history-application boundary and generic Toast command only.
- Affected verification: positive, zero-new, duplicate/conflict, rejected, rapid-batch, duration, copy, kind, and history-independence controls.
- Unchanged: synchronization initiation and completion UI, message-list behavior, notifications, unread attention, system notices, Runtime ownership, wire protocol, storage schema, public APIs, dependencies, and generic Toaster structure or styling.
