## Why

History synchronization can receive message batches without any visible acknowledgement. A user therefore cannot tell when WebChat is actively receiving message history.

## What Changes

- As soon as the application/page boundary receives a valid history-response batch containing at least one message, publish one generic loading Toast with exact copy `Syncing message history` and an exact `3000ms` duration.
- Do not wait for or inspect local insertion completion before publishing. Do not derive, propagate, aggregate, store, or display a message count for this feedback.
- Treat every nonempty response batch independently. A later batch uses the existing Toast surface behavior to cover the earlier visible Toast.
- Publish no Toast when a sync request starts, while waiting, when no response arrives, or when an existing completion response contains no messages. Do not manually dismiss the Toast or convert it to success when synchronization continues or ends.
- Preserve history pagination, persistence, acknowledgement, notifications, unread attention, system notices, protocol, and every other generic Toast source.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Add finite receipt-time feedback for each nonempty history-response batch.

## Impact

- Affected behavior: visible feedback as soon as a valid history-response batch containing messages reaches the application/page boundary.
- Affected implementation: the existing application/page history-response receipt boundary and generic Toast command only.
- Affected verification: nonempty receipt, empty completion, insertion independence, replay, rapid-batch, duration, copy, kind, and history-independence controls.
- Unchanged: synchronization initiation and completion UI, message-list behavior, notifications, unread attention, system notices, Runtime ownership, wire protocol, storage schema, public APIs, dependencies, and generic Toaster structure or styling.
