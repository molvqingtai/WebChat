> **Coding status (2026-08-19):** Source/test exact `7a23b9c8929f69c51b74e2dad0e3a1419a0fca17` passed focused History 14/14, full 924/924, all local gates, hosted run `32233932311` attempt 3 setup/linter/tests/build 4/4, and fresh cumulative CODE FINAL PASS `0/0/0`. Attempts 1 and 2 were canceled only after the external Chrome-for-Testing install reached its 10-minute limit; the exact source did not change between attempts.

## 1. Freeze Pairwise History Ownership

- [x] 1.1 Record the current mismatch between one source-owned trigger and all-current-session `expectedProviders` targeting.
- [x] 1.2 Define the outgoing requester target as the triggering `sourcePeerId` singleton derived directly from attempt identity, delete provider-routing arrays, and preserve independent reverse-direction synchronization.
- [x] 1.3 Define pages as chunks of one logical Pull and one logical Push under one `syncId`, with internal per-chunk `requestId` limited to local send settlement and no peer round trip.
- [x] 1.4 Preserve current protocol, snapshot, paging, timeout, terminal, supplier, Delivery, loading, late-page, replacement, persistence, and projection boundaries.

## 2. Implement The Minimal Runtime Repair

- [x] 2.1 Remove `expectedProviders`, settled-provider arrays, and all-Session snapshot logic; derive each inventory chunk target directly as `[attempt.sourcePeerId]`, with no room-wide target, fallback, or new aggregate State.
- [x] 2.2 Retain current Wire-peer liveness intersection and source-local finish when that sole source is unavailable.
- [x] 2.3 Preserve provider response targeting, bidirectional one-shot ownership, terminal/replacement cleanup, and every existing History resource bound.

## 3. Add Mutation-Sensitive Controls

- [x] 3.1 Prove with deterministic connected Runtime instances that A-to-B and B-to-A requesters remain independent and each produces one Pull followed by one Push only to the remote source.
- [x] 3.2 Prove sequential C admission creates only A-to-C/B-to-C and C-to-A/C-to-B work, with zero restarted A-to-B/B-to-A inventory.
- [x] 3.3 Prove batched B/C admission creates distinct `syncId` owners with direct singleton `[B]` and `[C]` targets and no provider-routing arrays; restoring all-current-Session allocation must fail.
- [x] 3.4 Prove multi-chunk Pull and Push each retain one logical `syncId`, never alternate or wait on a peer chunk response, and use generic internal `requestId` only for local send settlement/cancellation progression.
- [x] 3.5 Prove repeated Session, source departure, terminal timeout/failure, late valid page, and true replacement retain current one-shot and cleanup behavior without fallback or retry.
- [x] 3.6 Run the complete existing History/Connection/Delivery/protocol controls and prove public protocol/schema, MessageStore, UI/Text projection, transport/provider, and unrelated source blobs remain unchanged.
- [x] 3.7 Prove a non-owner Push carrying the owner's exact `syncId` performs zero lane, record, Delivery, feedback, loading, or terminal mutation, while the owner's same page still applies and completes normally.

## 4. Delivery Gates

- [x] 4.1 Pass focused History 14/14, full 924/924, typecheck, lint, format, Chrome/Firefox builds and packs, strict affected/all OpenSpec validation, status, Doctor, architecture validation, diff/identity, and exact hosted run `32233932311` attempt 3 4/4.
- [x] 4.2 Freeze immutable source/test exact `7a23b9c8929f69c51b74e2dad0e3a1419a0fca17` and obtain fresh cumulative CODE FINAL PASS `0/0/0`; no docs review seat is required.
- [x] 4.3 Update canonical OpenSpec/task/status truth after coding PASS. No separate Owner acceptance is required for this batch.
- [ ] 4.4 Keep PR #146 Draft until tasks #1355, #1418, #1419, and #1420 all have coding PASS, exact CI, applicable canonical docs/status, and no other live hold; only then use the ordinary target-branch Ready/merge flow.
- [ ] 4.5 Do not merge to `master`, release, deploy, modify production data, or couple this repair to the Artico/Trystero transport workstreams.
