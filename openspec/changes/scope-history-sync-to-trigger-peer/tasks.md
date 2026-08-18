## 1. Freeze Pairwise History Ownership

- [x] 1.1 Record the current mismatch between one source-owned trigger and all-current-session `expectedProviders` targeting.
- [x] 1.2 Define the outgoing requester target as the triggering `sourcePeerId` singleton derived directly from attempt identity, delete provider-routing arrays, and preserve independent reverse-direction synchronization.
- [x] 1.3 Define pages as chunks of one logical Pull and one logical Push under one `syncId`, with internal per-chunk `requestId` limited to local send settlement and no peer round trip.
- [x] 1.4 Preserve current protocol, snapshot, paging, timeout, terminal, supplier, Delivery, loading, late-page, replacement, persistence, and projection boundaries.

## 2. Implement The Minimal Runtime Repair

- [ ] 2.1 Remove `expectedProviders`, settled-provider arrays, and all-Session snapshot logic; derive each inventory chunk target directly as `[attempt.sourcePeerId]`, with no room-wide target, fallback, or new aggregate State.
- [ ] 2.2 Retain current Wire-peer liveness intersection and source-local finish when that sole source is unavailable.
- [ ] 2.3 Preserve provider response targeting, bidirectional one-shot ownership, terminal/replacement cleanup, and every existing History resource bound.

## 3. Add Mutation-Sensitive Controls

- [ ] 3.1 Prove two-peer A-to-B and B-to-A requesters remain independent and each targets only the remote source.
- [ ] 3.2 Prove sequential C admission creates only A-to-C/B-to-C and C-to-A/C-to-B work, with zero restarted A-to-B/B-to-A inventory.
- [ ] 3.3 Prove batched B/C admission creates distinct `syncId` owners with direct singleton `[B]` and `[C]` targets and no provider-routing arrays; restoring all-current-Session allocation must fail.
- [ ] 3.4 Prove multi-chunk Pull and Push each retain one logical `syncId`, never alternate or wait on a peer chunk response, and use generic internal `requestId` only for local send settlement/cancellation progression.
- [ ] 3.5 Prove repeated Session, source departure, terminal timeout/failure, late valid page, and true replacement retain current one-shot and cleanup behavior without fallback or retry.
- [ ] 3.6 Run the complete existing History/Connection/Delivery/protocol controls and prove public protocol/schema, MessageStore, UI/Text projection, transport/provider, and unrelated source blobs remain unchanged.

## 4. Delivery Gates

- [ ] 4.1 Pass focused and full tests, typecheck, lint, format, Chrome/Firefox builds, strict affected/all OpenSpec validation, status, Doctor, architecture validation, diff/identity, and exact hosted CI.
- [ ] 4.2 Freeze one immutable source/test exact and obtain one fresh cumulative coding review; do not route a docs review seat.
- [ ] 4.3 After coding PASS, exact CI, PM canonical docs/status completion, and no live hold, use the ordinary Ready/`develop` merge flow without a separate Owner acceptance gate.
- [ ] 4.4 Do not merge to `master`, release, deploy, modify production data, or couple this repair to the Artico/Trystero transport workstreams.
