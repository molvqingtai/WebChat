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

A first inbound History Pull that reaches Wire's typed accepted-message event has already passed the current trusted-room, room-generation, and public-schema checks and carries its transport `sourcePeerId`. It creates provider work directly under `(roomId, sourcePeerId, syncId)`. It does not require Session binding, Wire source-membership lookup, Session acceptance order, `sessionId`, `presenceId`, user identity, or Presence observation. The requester starts directly from the peer-join callback, not from Session binding/commit events.

Push retains its existing requester-attempt authority: its `syncId` must identify a current requester and its transport source must equal that requester's owning `sourcePeerId`. It adds no Session or membership lookup, so the existing valid late-page boundary after source departure or loading settlement remains unchanged.

History may continue consuming Session-owned local facts that are unrelated to remote-source authorization, such as the current local domain snapshot or shared logical clock, through explicit CQRS surfaces. It must not query a remote Session binding to admit, start, or replace History work.

Alternative rejected: replace Session binding with another source-membership guard. The protocol-valid accepted-message event already owns the room/generation/schema boundary and transport source; a second guard would add behavior without evidence and keep History coupled to unrelated lifecycle State.

### 4. Current History exchange and wire contracts remain intact

Each admitted direction still allocates one fresh `syncId`, sends continuous target-only Pull inventory pages, receives continuous target-only Push pages, and terminalizes once under the current timeout, cutoff, paging, supplier, Delivery, and persistence rules. The public Session/Pull/Push structures remain byte-for-byte unchanged. No peer-visible combined handshake or acknowledgement is added.

## Risks / Trade-offs

- [Session and History complete in different orders] -> This is intentional; each protocol has independent state and terminal ownership.
- [Removing Session broadcast changes discovery timing] -> Pairwise target sends follow the provider's existing peer-join callbacks and do not require a complete room snapshot.

## Migration Plan

1. Replace initial Session broadcast/baseline catch-up with the current peer-join target-send path.
2. Invoke the current History requester from the same peer-join handler and let protocol-valid Pull use its accepted-message room/source context directly, with no Session-binding or replacement membership guard.
3. Add mutation-sensitive two-peer, three-peer, and empty-room controls while retaining all existing protocol/resource tests.
4. Freeze one source/test exact, run the repository's focused/full tests and complete gates, then obtain a fresh cumulative coding review.
5. Update canonical OpenSpec/status only after coding PASS. Merge, master promotion, release, and deploy require separate current authority.
