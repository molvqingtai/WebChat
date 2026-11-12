> **Final coding status (2026-08-20):** Follow-up exact `69c6a8a46af4efac02815dbd2902b24e7cc1e687` keeps registry `@rtco/client@0.3.6`, applies the reviewed repair through pnpm's native patch mechanism, leaves the production adapter on direct `room.send(payload, target)`, and restores all three ready-only/attempt-all controls. Hosted CI `32330416985` and fresh cumulative CODE FINAL PASS `0/0/0` report `c9a7ce60` are complete. No additional patch-effect proof gate is required.

## 1. Product Authority

- [x] 1.1 Define exactly two supported Runtime-private providers, with Artico as the build-time default and Trystero retained as the default-Nostr alternative.
- [x] 1.2 Freeze one constants-owned provider selection value, one Runtime composition helper, exactly one instantiated provider per host, and no runtime switch, user setting, automatic fallback, or simultaneous connection.
- [x] 1.3 Define the shared omitted/string/array/empty target shape, direct provider-native execution, and the absence of WebChat readiness emulation, queue, retry, or later replay.
- [x] 1.4 Restore Artico's per-room ownership, owned `wss://web-chat.io` signaling, and scoped recovery without leaking Artico into provider-neutral boundaries or making its repaired upstream behavior a current delivery prerequisite.
- [x] 1.5 Preserve Trystero 0.25.3 Nostr composition, lifecycle fencing, native broadcast, and provider-local peer-connect error silence.
- [x] 1.6 Freeze immutable fork use to repaired-version build verification only and require registry `@rtco/client@0.3.6` for current delivery; a later repaired version requires new Owner authorization.
- [x] 1.7 Require English/Chinese README and current agent/architecture guidance to identify both providers and Artico as default.
- [x] 1.8 Pass docs format, affected strict validation, all-change strict validation, change status, OpenSpec Doctor, and clean-diff checks on one docs-only candidate.
- [x] 1.9 Publish the immutable PM authority exact and hand its parent/tree/scope/gate evidence to Planner for prerequisite and source routing; do not route Inspector for docs review.

## 2. Parallel Workstreams and Verification Inputs

- [x] 2.1 Complete Artico PR #41 in place with ready-only `Room.send` and per-peer `Room.addStream` fan-out, retained ready-Call failure isolation, no queue/late replay, immutable production/test exacts, and independent coding review.
- [x] 2.2 Complete the Trystero peer-connect silence and production console cleanup implementation from authority `a0551702`, including immutable source/test exact, full gates, and independent coding review.
- [x] 2.3 Build one immutable Owner-fork Artico integration commit containing the completed PR #41 client behavior and retained client fixes; record its full commit/tree and package provenance.

## 3. Dual-Provider Implementation

- [x] 3.1 Restore `src/runtime/transports/artico/RoomTransport.ts` and its contextual `RoomTransport.test.ts` from the last accepted provider implementation; move the reviewed Trystero implementation/test to the same contextual names under `transports/trystero/`. Reconcile only current RoomTransport/lifecycle/error contracts and add no `ArticoRoomTransport*` or `TrysteroRoomTransport*` filename.
- [x] 3.2 Add the `'artico' | 'trystero'` constant to `src/constants/config.ts`, default it to `artico`, add `src/runtime/RoomTransportProvider.ts`, and make `host.ts` create exactly one selected adapter through that helper.
- [x] 3.3 Restore the Artico dependency temporarily at the exact immutable fork integration commit and regenerate the lockfile without a branch, tag, path, workspace, or moving ref.
- [x] 3.4 Preserve Artico per-room peer identity, `wss://web-chat.io`, 10-second close recovery, demand repair, owner fencing, and provider-scoped errors; do not duplicate upstream readiness logic or classify its error string in WebChat.
- [x] 3.5 Preserve Trystero 0.25.3 default Nostr, join/leave/dispose fencing, shared-peer lifecycle, matching peer-connect silence, and non-matching generic error ownership.
- [x] 3.6 Update `README.md`, `README_zh.md`, `AGENTS.md`, active architecture/provider assertions, manifest, lockfile, and structural rules to one consistent two-provider/default-Artico truth without changing archived history.
- [x] 3.7 Add no provider setting/UI, environment selector, runtime switch, fallback, negotiation, simultaneous connection, public provider type, protocol field, persistence change, queue, retry, ACK, outbox, or delivery status.

## 4. Evidence and Acceptance

- [x] 4.1 Run the root shared RoomTransport contract against Artico and Trystero for identity, lifecycle, trusted source, omitted/string/array/empty targets, provider events/failures, and dispose without falsely asserting native fan-out parity.
- [x] 4.2 Prove default Artico constructs exactly once with zero Trystero side effects, and a test-owned Trystero selection constructs exactly once with zero Artico side effects.
- [x] 4.3 Prove Artico provider-specific ownership/signaling/recovery/direct-send behavior and Trystero provider-specific Nostr/lifecycle/error-silence behavior without cross-provider leakage; structurally require contextual `RoomTransport*` filenames and reject redundant provider-prefixed names.
- [x] 4.4 Prove all room-wide producers remain omitted-target, all History/catch-up sends retain exact targets, provider-unsent operations receive no WebChat late replay, and existing queue/generation/owner/no-retry boundaries do not regress.
- [x] 4.5 Pass focused/full tests, format, lint, typecheck, Chrome/Firefox builds, pack, strict OpenSpec/status/Doctor, architecture, scope, identity, lockfile, and hosted CI gates on one immutable Draft verification exact.
- [x] 4.6 Obtain fresh independent cumulative CODE FINAL PASS `0/0/0` on fork-backed Draft exact `1080dece`; no separate Owner acceptance is required. Do not merge it to `develop`.

## 5. Registry Dependency and Delivery

- [x] 5.1 Restore registry `@rtco/client@0.3.6`, regenerate the lockfile, and remove the temporary Git-subdirectory workspace exclusion; retain no fork, moving ref, local path, or workspace dependency.
- [x] 5.2 For the original unpatched 0.3.6 delivery, remove WebChat compatibility `readyPeers`/per-peer fan-out, retain direct `room.send(payload, target)`, make the fake match unguarded/abort-first behavior, and explicitly skip exactly three unavailable ready-only/attempt-all controls.
- [x] 5.3 Pass focused/full/static/build/pack/OpenSpec/Archify gates, hosted CI `32247303999`, and fresh cumulative CODE FINAL PASS `0/0/0` on exact `e526b870`.
- [x] 5.4 Update canonical task/status truth to the reviewed 0.3.6 exact and current Owner decision.
- [x] 5.5 After the four-item batch has exact CI, reviews, applicable docs/status, and no live hold, perform its ordinary protected merge to `develop`; no separate Owner acceptance is required.
- [ ] 5.6 If the Owner later authorizes a repaired official Artico version, replace 0.3.6 with that exact registry version, intentionally remove or regenerate the native patch metadata, rerun the active controls and complete gates, and obtain fresh coding review.
- [x] 5.7 Record the separate Owner authorization for direct `develop` to `master` promotion after the corrected batch reaches `develop`, without adding another build/review/acceptance stage; release, deploy, signaling-server change, and production writes remain unauthorized.

## 6. Native Artico Patch Follow-up

- [x] 6.1 Keep registry `@rtco/client@0.3.6` and generate `patches/@rtco__client@0.3.6.patch`, the canonical `pnpm-workspace.yaml` mapping, and lockfile patch hash only through pnpm native `patch`/`patch-commit`; add no custom runner, vendor copy, Git dependency, or manual release build.
- [x] 6.2 Keep the production adapter byte-unchanged on direct `room.send(payload, target)` and restore the three pending-skip, selected-order, and first-ready-failure controls.
- [x] 6.3 Pass focused 30/30, full 974, static/build/pack/OpenSpec/Archify gates, exact hosted CI `32330416985`, and fresh CODE FINAL PASS `0/0/0` on `69c6a8a4`.
- [x] 6.4 Synchronize canonical design/spec/task truth to the reviewed native-patch exact; per Owner rule, canonical docs require no independent review.
- [ ] 6.5 Keep Draft PR #151 frozen until explicit Ready/merge authority; do not perform master promotion, release, deploy, signaling-server change, or production action.
