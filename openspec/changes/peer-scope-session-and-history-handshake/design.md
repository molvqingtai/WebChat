## Context

Wire already records admitted sources per trusted room and fences queued work by room generation. Connection receives those peer-join/leave facts and owns the current domain connection generation. Session currently also snapshots baseline peers, performs one omitted-target initial publication, and catches up only peers observed after publication begins. History starts from accepted Session events and verifies inbound Pull through Session binding even though Wire has already authenticated the physical source.

This creates two different topologies for one physical relationship. In an established B/C room, joining A should create only A-B and A-C work. Instead, Session's initial broadcast audience depends on provider timing, and History cannot begin until Session has established a logical identity that is not needed to authenticate History transport.

This authority supersedes only the contrary initial-Session broadcast/catch-up clauses in `restore-targeted-room-sends`, `adopt-trystero-native-room-broadcast`, and `restore-dual-room-transports`, plus the Session-binding trigger/admission clauses in `sync-exact-history-and-show-progress` and `scope-history-sync-to-trigger-peer`. Their other completed transport, paging, resource, identity, and delivery requirements remain authoritative.

## Goals / Non-Goals

**Goals:**

- Give Session and History the same peer-scoped connection trigger while keeping their protocol state independent.
- Make each observed physical peer join call the current target Session and History entry points once.
- Preserve current queue, generation, cancellation, pagination, resource, and persistence behavior without adding a second lifecycle owner.

**Non-Goals:**

- Combining Session and History into one wire message, transaction, state machine, or success condition.
- Waiting for a room membership count, electing a coordinator, or adding a room-wide reconciliation phase.
- Adding ACK, retry, replay, outbox, delivery guarantee, capability negotiation, or compatibility wire variants.
- Changing Session, History Pull, or History Push public shapes; changing History cutoff, paging, budgets, or timeout.
- Changing Text, Reaction, World, Presence, UI, MessageStore, Delivery, or transport-provider semantics.

## Decisions

### 1. The existing peer-join callback is the common trigger

Connection already receives each Wire `onPeerJoin(roomId, sourcePeerId)` fact after Wire admits that source. The minimal change makes that existing handler invoke the current Session target-send path and the current History requester-start path for the same source. It adds no edge registry, pending-edge set, peer snapshot, or room-size decision.

Session and History keep their existing independent state. History owns its fresh `syncId`, Pull/Push progression, terminal state, and existing budgets. A Session success or failure does not start, authorize, settle, or cancel History, and a History success or failure does not do so for Session.

Alternative rejected: continue using Session binding as the History trigger. It serializes independent protocols, makes logical Presence identity an unnecessary History transport authority, and cannot guarantee that the two protocols cover the same physical edges.

### 2. Session uses one target send per edge and no receive echo

For A joining existing B and C, the provider invokes the existing peer-join callback for each connected counterpart. B and C each target-send their local Session to A and start their target History inventory; A's corresponding peer-join callbacks do the same toward B and C. Receiving a Session only validates and applies that remote binding/projection. It does not add another reply path.

The omitted-target initial Session send, baseline peer snapshot, and `missedPeerIds` catch-up are removed. Empty-room join commits locally with no peer send. A late peer creates only its new pairwise edges. Text and Reaction remain room-wide product broadcasts, and World keeps its existing publication/retry contract.

Alternative rejected: preserve initial broadcast and add targeted repair. The same peer may then receive two Session publications, while a provider's invocation-time audience still cannot prove exact edge coverage.

### 3. Protocol-valid History uses transport context, not logical identity

An eligible page-zero inbound History Pull that reaches Wire's typed accepted-message event has already passed the current trusted-room, room-generation, and public-schema checks and carries its transport `sourcePeerId`. It creates provider work directly under `(roomId, sourcePeerId, syncId)`. Matching continuous pages advance that attempt only under the existing page-order, replay, resource, bound-`syncId`, and terminal fences; a gap, changed replay, second `syncId`, post-done page, or terminal connection remains inert or rejected exactly as before. Neither admission path requires Session binding, Wire source-membership lookup, Session acceptance order, `sessionId`, `presenceId`, user identity, or Presence observation. The requester starts directly from the peer-join callback, not from Session binding/commit events.

Push retains its existing requester-attempt authority: its `syncId` must identify a current requester and its transport source must equal that requester's owning `sourcePeerId`. It adds no Session or membership lookup, so the existing valid late-page boundary after source departure or loading settlement remains unchanged.

History may continue consuming Session-owned local facts that are unrelated to remote-source authorization, such as the current local domain snapshot or shared logical clock, through explicit CQRS surfaces. It must not query a remote Session binding to admit, start, or replace History work.

Alternative rejected: replace Session binding with another source-membership guard. The protocol-valid accepted-message event already owns the room/generation/schema boundary and transport source; a second guard would add behavior without evidence and keep History coupled to unrelated lifecycle State.

### 4. Current History exchange and wire contracts remain intact

Each admitted direction still allocates one fresh `syncId`, sends continuous target-only Pull inventory pages, and receives continuous target-only Push pages under the current cutoff, paging, replay, timeout, supplier, Delivery, persistence, and terminal rules. Provider/requester attempts retain their distinct existing terminal fences: settling the local loading UI does not terminate an exact-owner requester's valid late Push collection. The public Session/Pull/Push structures remain byte-for-byte unchanged. No peer-visible combined handshake or acknowledgement is added.

### 5. Typed routing is not repeated inside internal apply Commands

Wire's room-selected schema remains the single peer-input validation boundary. The sole Session Effects then route SESSION versus TEXT/REACTION accepted values, and the sole World Effect routes the schema-selected World value. Their internal, non-exported apply Commands have no second production caller, so repeating the identical message-kind or World-room test there adds no distinct responsibility.

The implementation removes only these repeated checks: SESSION in `ApplySessionMessageCommand`, TEXT/REACTION in `ApplyLiveMessageCommand`, and `sites` plus World room identity in `ApplyPresenceCommand`. The Effects carry the narrowed types into those Commands.

This does not remove lifecycle or business validation. Wire still rechecks trusted room and captured generation after asynchronous decode because leave/reconnect/close can occur while decoding. Session still requires the current binding, matching user, valid HLC, and currently admitted source for lawful reactivation of an ended Presence. World still rejects same-session identity conflict. History still owns attempt/source, paging, replay, timeout, late-page, and resource rules. The local outbound Chat schema parse remains the first validation of a locally constructed value, and World peer-join/leave room tests remain the actual router because Connection currently sends each peer fact to both Session and World.

Alternative rejected: remove guards by pattern or because their names resemble protocol validation. A check is removed only when its sole caller already proves the same fact; checks with asynchronous lifecycle, routing, or state-machine responsibility remain.

## Risks / Trade-offs

- [Session and History complete in different orders] -> This is intentional; each protocol has independent state and terminal ownership.
- [Removing Session broadcast changes discovery timing] -> Pairwise target sends follow the provider's existing peer-join callbacks and do not require a complete room snapshot.

## Migration Plan

1. Replace initial Session broadcast/baseline catch-up with the current peer-join target-send path.
2. Invoke the current History requester from the same peer-join handler and let eligible Pull pages use their accepted-message room/source context directly, with no Session-binding or replacement membership guard.
3. Narrow the three internal apply Commands at their existing typed Effects and remove only their repeated kind/room checks, retaining all stateful and asynchronous lifecycle guards.
4. Add mutation-sensitive two-peer, three-peer, empty-room, typed-routing, and retained-stateful-guard controls while retaining all existing protocol/resource tests.
5. Freeze one source/test exact, run the repository's focused/full tests and complete gates, then obtain a fresh cumulative coding review.
6. Update canonical OpenSpec/status only after coding PASS. Merge, master promotion, release, and deploy require separate current authority.
