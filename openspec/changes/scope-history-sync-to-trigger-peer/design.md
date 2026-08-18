## Context

An accepted remote Session with `sourcePeerId = B` is the sole trigger and lifecycle owner for one outgoing requester on the local client. The requester allocates a fresh `syncId`, freezes the local 30-day inventory, and later collects provider responses by source. The reverse direction is independent: B accepts the local Session and creates its own requester.

The current target allocation breaks that otherwise pairwise ownership. `StartRequesterCommand({ sourcePeerId: B })` fills `expectedProviders` from every current Session. `QueueInventoryPageCommand` then intersects that array with the current Wire peer set and sends each inventory page to all survivors. With established A and B, the arrival of C can make A's C-owned requester query B again and B's C-owned requester query A again. If several Sessions commit together, each source-owned requester can repeat the same all-peer target set.

## Goals / Non-Goals

**Goals:**

- Preserve exactly one outgoing requester per accepted source incarnation and make that request target the same source only.
- Preserve the symmetric A-to-B and B-to-A pull/push model without electing an authoritative peer.
- Continue recovering the union available across the room as each distinct peer relationship is accepted.
- Make sequential and batched multi-peer admission linear in new peer relationships rather than repeated all-peer rounds.
- Retain all current History identity, terminal, timeout, supplier, queue, response, late-page, persistence, and feedback boundaries.

**Non-Goals:**

- Selecting one authoritative/random peer for the whole room or accepting incomplete single-source history.
- Adding a room-scoped aggregator, peer-selection policy, retry, delayed fan-out, digest, Bloom filter, Merkle tree, cursor, ACK, outbox, or delivery status.
- Changing `HistoryMessagesPull`/`HistoryMessagesPush`, schemas, namespace, page shape, cutoff, ordering, or capacity.
- Changing Session membership, provider transport behavior, MessageStore, Delivery, Text projection, Toast copy, or UI.

## Decisions

### 1. Trigger owner and sole recipient are the same source

For `StartRequesterCommand({ domain, sourcePeerId })`, the requester keeps the existing source-scoped identity and stores no `expectedProviders` or settled-provider routing array. Inventory chunk sends derive the exact target directly as `[attempt.sourcePeerId]`. Loading settlement is source-local and idempotent; it does not require an array to determine whether the sole provider has settled.

`QueueInventoryPageCommand` retains its current liveness revalidation against the Wire peer set. If the triggering source is no longer current/available, the requester follows the existing source-local no-target finish path. It must not substitute another peer or broaden the request.

### 2. Symmetry comes from independent Session acceptance

When A and B accept each other's Sessions, A independently pulls from B and B independently pulls from A. Each side then acts as provider for the other's request and pushes only records absent from that requester's inventory. No new coordination message is required.

When C later joins an established A/B room, Session acceptance creates A-to-C, C-to-A, B-to-C, and C-to-B requester/provider relationships as those bindings become current. It does not create another A-to-B or B-to-A request. If B and C become visible to A in one commit, A creates one B-targeted requester and one C-targeted requester; neither requester targets both.

Each direction is one logical exchange: the requester streams every Pull chunk with the same `syncId` and the provider waits for the final `done: true` chunk before computing one exact difference; the provider then streams every Push chunk with that same `syncId`. A generic internal Wire `requestId` correlates only each local chunk-send settlement so queue/cancellation ownership can advance. It is not a peer-visible History request, response acknowledgement, or per-chunk round trip. The public `page` field remains the continuous chunk index and is not renamed.

### 3. Existing one-shot connection ownership remains authoritative

The current `(domain, sourcePeerId, direction)` binding, fresh `syncId`, terminal bit, unique local token, source replacement cleanup, and dormant-successor settlement remain unchanged. Repeated Session, page attachment, timeout, completion, or late page cannot create another requester within the same source incarnation.

A true replacement source clears the prior source connection's binding only through the existing lifecycle and starts one new requester targeted to that replacement source after required old physical settlement. This is a new connection exchange, not a retry and not a reason to query other peers.

### 4. Response and convergence semantics do not change

The provider still receives the requester's complete paged inventory, freezes its own 30-day snapshot, and sends missing records only to the requesting source. The requester still accepts valid provider pages under the exact attempt identity and converges through bounded Delivery plus `insert-if-absent` message identity.

Duplicate records held by several peers remain harmless: each pairwise exchange may offer them, and persistence retains one canonical record. Late valid pages for an already-associated attempt retain their existing acceptance boundary after loading settlement. No protocol or persistence migration is needed.

### 5. Regression evidence must distinguish trigger and target scope

Implementation controls must make an all-current-sessions mutation fail. Requester State must contain no `expectedProviders` or settled-provider arrays. With B and C current, a B-triggered requester must physically send only target `[B]`; a C-triggered requester must send only `[C]`. Sequential C admission must produce zero new A-to-B/B-to-A logical Pull, and batch B/C admission must produce exactly one source-owned requester per source with distinct `syncId` values and direct singleton targets. Controls must also prove multiple chunks retain one logical `syncId`, produce no peer ACK or Pull/Push alternation, and advance only after local chunk-send settlement.

Existing two-peer bidirectional pull/push, terminal restart rejection, source departure, replacement-after-settlement, timeout, late valid pages, loading ownership, supplier bounds, protocol validation, response targeting, and identity-deduplicated insertion remain required regression controls.

## Risks / Trade-offs

- [One established peer is not queried again when C joins] -> This is intentional. The A/B connection already consumed its one-shot synchronization; C contributes its own current store through the new A/C and B/C exchanges.
- [A peer acquires additional history after its pairwise snapshot] -> Live traffic continues normally, and history acquired from C reaches other active peers through their own C exchanges. There is no periodic global reconciliation contract; a future new connection observes then-current storage.
- [A source departs before inventory sends] -> Existing current-peer intersection and source-local finish apply; no fallback peer or retry is introduced.
- [Several new sources still cause concurrent work] -> Existing four-active, 32-admitted, and 8KiB bounds remain the sole admission controls, now without duplicated cross-target requests.

## Migration Plan

1. Change requester target allocation from all current Session sources to the triggering `sourcePeerId` singleton.
2. Add mutation-sensitive sequential/batch multi-peer controls and retain the complete current History suite.
3. Run focused/full tests, typecheck, lint, format, browser builds, strict OpenSpec validation, Doctor, architecture gates, and exact hosted CI.
4. Obtain one fresh cumulative coding review. With the Owner's standing waiver for this batch, current gates and no live hold authorize the ordinary `develop` merge; no master promotion, release, or deploy is included.
