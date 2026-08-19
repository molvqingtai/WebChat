## Why

Session and History currently describe one physical peer relationship through different authority paths: Session publishes its initial identity room-wide, while History starts only after Session binding. That coupling can leave an already observed peer outside the initial Session audience and prevents History from using the admitted connection that already authenticates its transport source.

## What Changes

- Replace initial room-wide Session publication and its baseline/missed-peer catch-up ownership with one target-only Session send per admitted peer connection and direction.
- Start Session and History independently from the same admitted `(roomId, sourcePeerId)` relationship; neither protocol waits for the other before starting its own work.
- Let every protocol-valid History Pull from the trusted current room/generation create its source-owned provider work without requiring a Session binding, Wire source-membership query, or Presence identity; retain exact requester/source ownership for Push and its existing valid late-page boundary.
- Preserve target-only History Pull/Push pagination, one synchronization per direction and generation, all current History bounds, and the public Session and History wire shapes.
- Preserve room-wide Text, Reaction, and World publication behavior; this change removes only initial Session from the room-wide producer inventory.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Use one admitted peer-connection callback to start independent target-only Session and History work.

## Impact

- Production: Runtime Connection peer-join handling, Session publication, and History requester/provider admission.
- Tests: deterministic multi-peer controls for pairwise Session and History starts, empty rooms, and later joins.
- Unchanged: public peer schemas and message shapes, History paging/cutoff/budgets, MessageStore/Delivery persistence, Presence identity semantics, Text/Reaction/World publication, transport providers, dependencies, UI, and storage format.
