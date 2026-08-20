## Why

Session and History currently describe one physical peer relationship through different authority paths: Session publishes its initial identity room-wide, while History starts only after Session binding. That coupling can leave an already observed peer outside the initial Session audience and prevents History from using the admitted connection that already authenticates its transport source.

## What Changes

- Replace initial room-wide Session publication and its baseline/missed-peer catch-up ownership with one target-only Session send per admitted peer connection and direction.
- Start Session and History independently from the same admitted `(roomId, sourcePeerId)` relationship; neither protocol waits for the other before starting its own work.
- Let an eligible page-zero History Pull from the trusted current room/generation create source-owned provider work without requiring a Session binding, Wire source-membership query, or Presence identity; let only matching continuous pages advance it under the existing paging/replay/resource/terminal fences, and retain exact requester/source ownership plus the existing valid late-page boundary for Push.
- Remove the repeated SESSION, TEXT/REACTION, and World message-kind/room checks from the internal Session/World apply Commands after their sole typed Effects and Wire's room-selected schema have already completed that routing. Retain every stateful binding, identity, clock, attempt, paging, source-ownership, and asynchronous room-generation fence.
- Preserve target-only History Pull/Push pagination, one synchronization per direction and generation, all current History bounds, and the public Session and History wire shapes.
- Preserve room-wide Text, Reaction, and World publication behavior; this change removes only initial Session from the room-wide producer inventory.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Use one admitted peer-connection callback to start independent target-only Session and History work.

## Impact

- Production: Runtime Connection peer-join handling, Session publication, History requester/provider admission, and the three internal typed message-application paths.
- Tests: deterministic multi-peer controls for pairwise Session and History starts, empty rooms, later joins, and mutation-sensitive proof that routing remains at the Effects/Wire schema boundary while stateful guards remain intact.
- Unchanged: public peer schemas and message shapes, History paging/cutoff/budgets, MessageStore/Delivery persistence, Presence identity semantics, Text/Reaction/World publication, transport providers, dependencies, UI, and storage format.
