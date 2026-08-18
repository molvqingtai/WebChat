## 1. Product Authority

- [x] 1.1 Define exactly two supported Runtime-private providers, with Artico as the build-time default and Trystero retained as the default-Nostr alternative.
- [x] 1.2 Freeze one constants-owned provider selection value, one Runtime composition helper, exactly one instantiated provider per host, and no runtime switch, user setting, automatic fallback, or simultaneous connection.
- [x] 1.3 Define shared ready-only best-effort send meanings for omitted/string/array/empty targets, including zero-recipient success and no queue, retry, or later replay.
- [x] 1.4 Restore Artico's per-room ownership, owned `wss://web-chat.io` signaling, scoped recovery, and upstream PR #41 prerequisite without leaking Artico into provider-neutral boundaries.
- [x] 1.5 Preserve Trystero 0.25.3 Nostr composition, lifecycle fencing, native broadcast, and provider-local peer-connect error silence.
- [x] 1.6 Freeze immutable fork use to Draft implementation/acceptance and require an official upstream client release before any `develop` merge.
- [x] 1.7 Require English/Chinese README and current agent/architecture guidance to identify both providers and Artico as default.
- [x] 1.8 Pass docs format, affected strict validation, all-change strict validation, change status, OpenSpec Doctor, and clean-diff checks on one docs-only candidate.
- [x] 1.9 Publish the immutable PM authority exact and hand its parent/tree/scope/gate evidence to Planner for prerequisite and source routing; do not route Inspector for docs review.

## 2. Prerequisites

- [ ] 2.1 Complete Artico PR #41 in place with ready-only `Room.send` and per-peer `Room.addStream` fan-out, retained ready-Call failure isolation, no queue/late replay, immutable production/test exacts, and independent coding review.
- [ ] 2.2 Complete the Trystero peer-connect silence and production console cleanup implementation from authority `a0551702`, including immutable source/test exact, full gates, and independent coding review.
- [ ] 2.3 Build one immutable Owner-fork Artico integration commit containing the completed PR #41 client behavior and retained client fixes; record its full commit/tree and package provenance.

## 3. Dual-Provider Implementation

- [ ] 3.1 Restore `src/runtime/transports/artico/RoomTransport.ts` and its contextual `RoomTransport.test.ts` from the last accepted provider implementation; move the reviewed Trystero implementation/test to the same contextual names under `transports/trystero/`. Reconcile only current RoomTransport/lifecycle/error contracts and add no `ArticoRoomTransport*` or `TrysteroRoomTransport*` filename.
- [ ] 3.2 Add the `'artico' | 'trystero'` constant to `src/constants/config.ts`, default it to `artico`, add `src/runtime/RoomTransportProvider.ts`, and make `host.ts` create exactly one selected adapter through that helper.
- [ ] 3.3 Restore the Artico dependency temporarily at the exact immutable fork integration commit and regenerate the lockfile without a branch, tag, path, workspace, or moving ref.
- [ ] 3.4 Preserve Artico per-room peer identity, `wss://web-chat.io`, 10-second close recovery, demand repair, owner fencing, and provider-scoped errors; do not duplicate upstream readiness logic or classify its error string in WebChat.
- [ ] 3.5 Preserve Trystero 0.25.3 default Nostr, join/leave/dispose fencing, shared-peer lifecycle, matching peer-connect silence, and non-matching generic error ownership.
- [ ] 3.6 Update `README.md`, `README_zh.md`, `AGENTS.md`, active architecture/provider assertions, manifest, lockfile, and structural rules to one consistent two-provider/default-Artico truth without changing archived history.
- [ ] 3.7 Add no provider setting/UI, environment selector, runtime switch, fallback, negotiation, simultaneous connection, public provider type, protocol field, persistence change, queue, retry, ACK, outbox, or delivery status.

## 4. Evidence and Acceptance

- [ ] 4.1 Run the root shared RoomTransport contract unchanged against Artico and Trystero, covering identity, lifecycle, trusted source, omitted/string/array/empty targets, mixed readiness, zero recipients, provider events/failures, and dispose.
- [ ] 4.2 Prove default Artico constructs exactly once with zero Trystero side effects, and a test-owned Trystero selection constructs exactly once with zero Artico side effects.
- [ ] 4.3 Prove Artico provider-specific ownership/signaling/recovery/readiness behavior and Trystero provider-specific Nostr/lifecycle/error-silence behavior without cross-provider leakage; structurally require contextual `RoomTransport*` filenames and reject redundant provider-prefixed names.
- [ ] 4.4 Prove all room-wide producers remain omitted-target, all History/catch-up sends retain exact targets, skipped peers receive no late replay, and existing queue/generation/owner/no-retry boundaries do not regress.
- [ ] 4.5 Pass focused/full tests, format, lint, typecheck, Chrome/Firefox builds, pack, strict OpenSpec/status/Doctor, architecture, scope, identity, lockfile, and hosted CI gates on one immutable Draft acceptance exact.
- [ ] 4.6 Obtain fresh independent coding review, then Owner acceptance of the immutable fork-backed Draft candidate. Do not merge it to `develop`.

## 5. Official Dependency and Delivery

- [ ] 5.1 After upstream publishes an official `@rtco/client` containing the reviewed PR #41 ready-only/failure-isolation behavior and retained listener fix, replace the fork dependency with that exact official version and regenerate the lockfile.
- [ ] 5.2 Directly prove the installed official package retains the required behavior, rerun all focused/full gates and hosted CI, and obtain fresh coding review for the final immutable dependency replacement exact.
- [ ] 5.3 Update canonical task/status truth and obtain Owner acceptance on the official-package exact before any explicitly authorized merge to `develop`.
- [ ] 5.4 Do not infer master promotion, release, deploy, signaling-server change, or production-write authority from `develop` acceptance or merge.
