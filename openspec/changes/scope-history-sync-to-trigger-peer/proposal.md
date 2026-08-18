## Why

History synchronization is intended to be one symmetric requester/provider exchange per accepted peer connection. The current requester is correctly triggered and owned by one new `sourcePeerId`, but it snapshots every current Session into `expectedProviders`. When a third peer joins, that new source-owned requester can query peers whose connection-scoped synchronization already completed. A batch of new Sessions can therefore create repeated all-peer inventory rounds instead of one exchange per new peer relationship.

The duplicate rounds do not improve the intended history union: every newly accepted peer already triggers its own requester on each side, and response records converge through message identity. They add inventory encoding, network frames, local history queries, duplicate response processing, loading owners, and timeout work for established peer pairs.

## What Changes

- Bind every outgoing History requester to exactly the same `sourcePeerId` whose accepted Session triggered and owns it.
- Delete the requester's `expectedProviders`/settled-provider routing arrays and derive its sole physical target directly from the attempt's `sourcePeerId`.
- Preserve one logical Pull followed by one logical Push per direction. Their continuous pages are chunks under the same `syncId`, not separate History requests or per-chunk peer round trips.
- Preserve symmetric behavior: both ends independently pull from the newly accepted remote source, and each provider pushes only the records missing from that requester's inventory.
- Ensure a newly joined peer starts only its new pairwise exchanges; it does not restart History between already-established peers.
- Preserve current exact-difference protocol, 30-day snapshots, pagination, fixed 10-second timeout, late valid response collection, message-identity convergence, supplier/admission bounds, source replacement, and cleanup semantics.

## Capabilities

### Modified Capabilities

- `webrtc-runtime`: Scope each connection-triggered History requester to its triggering peer instead of all current peers.

## Impact

- Production: `src/domain/runtime/History.ts` requester routing/settlement State and target allocation only.
- Tests: History/Connection controls for sequential and batched multi-peer Session admission, singleton targets, no established-pair restart, replacement, and retained bidirectional behavior.
- Unchanged: public protocol and schemas, MessageStore/Delivery, UI and loading copy, transport/provider behavior, local Text projection, persistence, room membership, and every current History resource/lifecycle bound.
