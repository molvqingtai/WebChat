## Context

The authority parent is `docs/silence-trystero-peer-connect-error@a0551702931f8594fd02d5663997e3ec0c3f32e5`, whose sole parent is `develop@b49951189f25530153ee098aa08947fcde28b55f`. It preserves Trystero 0.25.3 as the current provider, makes one post-SDP peer-connect callback class provider-locally silent, and removes non-error production console output.

The completed `adopt-trystero-native-room-broadcast` authority made Trystero the sole provider and removed Artico, its selector, and all alternative-composition surfaces. This change explicitly supersedes only that sole-provider decision. Its provider-neutral send classification, removal of fixed post-join waits, targeted History/current-state catch-up, zero-recipient best effort, generic Wire queue fencing, and no-ACK/no-retry boundaries remain authoritative.

Artico PR #41 and its ready-only follow-up remain separate upstream work. They were combined in immutable integration commit `0deb0f0f` for repaired-version build verification. The Owner subsequently authorized WebChat to retain the registry dependency `@rtco/client@0.3.6` and apply that reviewed repair through pnpm's native patch mechanism. WebChat still delegates directly to the package and does not emulate ready-only/attempt-all behavior in its adapter. A repaired upstream release is not a current merge gate.

## Goals / Non-Goals

**Goals:**

- Keep Artico and Trystero as two complete, replaceable Runtime-private providers.
- Select Artico by default through one auditable build-time constant and one Runtime composition helper.
- Preserve one provider-neutral contract and keep application/Domain/protocol code provider-agnostic.
- Preserve direct provider-native sending without waits, application peer snapshots, queues, retries, or delivery claims.
- Restore Artico's established per-room ownership, owned signaling endpoint, and recovery behavior.
- Retain Trystero's Nostr strategy, provider-local peer-connect silence, and all current lifecycle fencing when Trystero is selected.
- Keep all fork, workspace, and local Artico dependencies out of the permanent `develop` dependency graph.

**Non-Goals:**

- No user-facing provider setting, runtime hot switch, environment selector, remote config, simultaneous provider connection, provider negotiation, or automatic failover.
- No abstraction above `RoomTransportExtern`, public provider type, provider identity in peer protocol, cross-provider room bridge, message translation, or shared physical peer.
- No send queue, retry, ACK, outbox, delivery status, readiness polling/cache, fixed grace, or remote-delivery guarantee.
- No Artico/Trystero dependency upgrade beyond the exact versions required to carry the authorized behavior.
- No change to Trystero's shared-peer retention or manual reconnect semantics in this change.

## Decisions

### 1. Two provider directories, one shared contract, one composition helper

The durable layout is:

```text
src/runtime/
  RoomTransport.ts
  RoomTransport.contract.test-utils.ts
  RoomTransportProvider.ts
  host.ts
  transports/
    artico/
      RoomTransport.ts
      RoomTransport.test.ts
    trystero/
      RoomTransport.ts
      RoomTransport.test.ts
```

`domain/runtime/externs/RoomTransport.ts` remains the private Domain injection port. The root concrete `RoomTransport.ts` shape and shared contract harness remain provider-neutral and are not duplicated inside provider directories.

Each provider directory supplies the distinguishing context, so its implementation and test use only `RoomTransport.ts` and `RoomTransport.test.ts`. `ArticoRoomTransport.ts`, `TrysteroRoomTransport.ts`, and matching prefixed test filenames are forbidden redundant names. The composition helper may alias the two same-named factory imports locally when it needs to distinguish them.

`RoomTransportProvider.ts` is the sole concrete provider-selection helper. It imports both factories, reads the one constant, and returns exactly one adapter. `host.ts` calls only that helper and never constructs a provider directly. No transport barrel, registry, plugin system, fallback chain, or second production composition route is added.

Provider-specific imports are permitted only in the provider's directory, its provider-specific tests, and `RoomTransportProvider.ts`. UI, application Domains, Runtime Domains other than Wire composition, protocol, persistence, page ports, comctx contracts, and public exports remain provider-neutral.

### 2. One build-time constant defaults to Artico

The configurable value belongs in `src/constants/config.ts` under the established constants policy:

```ts
export type RoomTransportProvider = 'artico' | 'trystero'
export const ROOM_TRANSPORT_PROVIDER: RoomTransportProvider = 'artico'
```

This is a source/build-time selection, not a runtime setting. A built extension creates one provider for its shared Runtime host and retains it until that host is disposed. Changing provider requires changing the constant, rebuilding, and restarting the extension.

Both provider source trees and dependencies remain supported and tested regardless of the selected default. The unselected provider must not instantiate, open signaling, join rooms, register global listeners, or perform cleanup in production startup.

### 3. Target shape is shared; send execution remains provider-native

The private capability remains:

```ts
send(roomId, payload, target?: string | string[]): Promise<void>
```

WebChat preserves the provider-neutral target shape:

| Target       | Meaning at provider invocation                         |
| ------------ | ------------------------------------------------------ |
| omitted      | one provider-native room broadcast                     |
| string       | that provider peer id                                  |
| string array | those provider peer ids, preserving provider semantics |
| empty array  | no recipients                                          |

WebChat does not enumerate provider peers, inspect DataChannels, cache readiness, queue, wait, retry, record delivery status, or replay after readiness changes. A successful return means only that the selected provider settled its native operation; it does not prove remote receipt.

For Trystero, omitted target remains its native action broadcast over `activePeerMap`; explicit targets remain native action targets. For Artico, the adapter directly calls `room.send(payload, target)` exactly once. The pnpm-patched 0.3.6 package skips selected pending Calls, visits selected ready Calls in provider order, attempts every selected ready Call, and rejects with the first ready-Call failure after the attempts finish. WebChat neither reproduces nor catches those package semantics. The three dependent controls execute; every lifecycle, target, empty-target, missing-room, signaling, ownership, error-identity, selector, and Trystero control remains active.

The complete room-wide versus request-specific producer classification remains unchanged: initial Session, Text, Reaction, World snapshot, and eligible zero-call World retry omit target; History inventory/response and Session/World catch-up retain explicit business targets. Fixed one-second waits and application-owned broadcast target arrays do not return.

### 4. Artico restores its scoped provider behavior

Each Artico World or Chat room retains one independent owner with its own Artico peer identity, Room, join settlement, restart owner, and generation fences. Different logical rooms do not share an Artico peer.

Every Artico peer generation explicitly receives the built-in `SocketSignaling` configured with `wss://web-chat.io` and the same current physical peer id. There is no implicit `0.artico.dev` default, endpoint list, environment selector, fallback host, custom signaling protocol, or insecure downgrade. The default Socket.IO path, WebSocket-only behavior, and identity query remain.

The established close-driven Artico restart cadence remains 10 seconds. Fresh demand repairs a retained disconnected owner through the same single restart path. Leave/dispose retires the current room and peer under existing owner fences. Artico errors remain scoped to the exact current room owner; no provider message/name/code classification is introduced.

The restored adapter delegates directly to registry Artico 0.3.6 with its repository-owned pnpm patch. It does not reproduce ready-only or attempt-all logic in WebChat, catch the exact `Connection is not established yet.` string, or add a readiness cache.

### 5. Trystero remains complete when selected

Trystero remains pinned to 0.25.3 and uses its default Nostr strategy. Its adapter retains current join/leave settlement, shared-peer ownership, active-room/generation fencing, native broadcast, targeted send, and deterministic dispose behavior.

The provider-local `could not connect to peer ` callback exception remains active whenever Trystero is selected: the adapter returns with no generic error, Toast, console output, or state. Non-matching join errors still reach the generic owner exactly once. Selecting Artico does not delete, weaken, or move these Trystero controls.

No product code attempts to fall back from Artico to Trystero after an Artico failure, or vice versa. A provider failure follows that provider's existing scoped error and recovery path.

### 6. Registry Artico 0.3.6 plus a pnpm-native patch is the delivery dependency

The final delivery candidate resolves `@rtco/client` from registry version `0.3.6`. pnpm's native `patch`/`patch-commit` workflow owns the repository patch file, the canonical `pnpm-workspace.yaml` `patchedDependencies` entry, and the lockfile patch hash. A branch name, tag controlled by a fork, workspace path, floating Git ref, personal fork dependency, uncommitted package, custom patch runner, vendored package, or release-time manual build is not acceptable delivery provenance.

Immutable integration commit `0deb0f0f` remains provenance for the repaired behavior encoded by `patches/@rtco__client@0.3.6.patch`; it is not a Git delivery dependency and creates no requirement to wait for an upstream release or Artico preview checks. The production adapter stays byte-unchanged at direct delegation. The three formerly skipped provider controls are the required patch-effect evidence and execute with the complete WebChat gates and fresh cumulative coding review; no additional installed-dist proof gate is required.

If the Owner later authorizes a repaired official Artico version, WebChat must replace 0.3.6 with that exact registry version, intentionally remove or regenerate the patch metadata, rerun the active controls and complete gates, and receive fresh coding review. Artico PR #40 and its Vercel authorization checks are not WebChat browser-client gates.

### 7. Documentation states the supported default truth

`README.md`, `README_zh.md`, `AGENTS.md`, and active architecture/provider assertions must stop claiming Trystero is the sole provider.

The English and Chinese README Built With sections must identify Artico as WebChat's default WebRTC room transport and Trystero as a supported alternative using its default Nostr strategy. They must not claim runtime automatic failover or a user-facing selector.

Historical archived OpenSpec records remain unchanged. Active completed changes may retain their historical exact statements, while this newer change explicitly supersedes the sole-provider product decision.

### 8. Evidence proves parity and non-instantiation

The root shared contract suite runs against both adapters and covers stable local identity, join/leave, inbound trusted source, omitted broadcast, string/array/empty targets, peer join/leave, close/error, and dispose. Provider-specific controls own Artico ready-only/attempt-all details; the adapter contract remains provider-neutral.

Provider-specific controls additionally prove:

- Artico per-room physical ownership, `wss://web-chat.io`, 10-second scoped recovery, direct 0.3.6 delegation, pending-Call skipping, selected-ready attempt-all order, first-ready-failure identity, and no error-string handling in WebChat;
- Trystero Nostr composition, join/leave fences, matching peer-connect silence, and non-matching error forwarding;
- the default constant selects and instantiates Artico exactly once while Trystero has zero construction/side effects;
- a test-only constant substitution selects Trystero exactly once while Artico has zero construction/side effects, without creating a production environment branch;
- source/dependency/layout/current-documentation scans retain both providers, require the contextual provider filenames, and reject redundant prefixed filenames or provider leakage outside authorized surfaces; and
- registry 0.3.6 plus pnpm-native patch provenance is explicit, and any later official-version switch remains Owner-authorized follow-up work.

## Risks / Trade-offs

- **Two providers can drift** -> Run one mutation-sensitive shared contract against both and keep provider-specific behavior in isolated suites.
- **The patch targets bundled Artico distribution output** -> Pin it to exact registry 0.3.6 through pnpm metadata and require intentional regeneration/review on every dependency version change.
- **A later official package supersedes the repair** -> Require explicit Owner authorization, intentional patch removal/regeneration, active controls, complete gates, and fresh coding review.
- **Both providers accidentally connect** -> Centralize selection in one helper and directly prove the unselected factory has zero construction and side effects.
- **Personal fork becomes permanent infrastructure** -> Deliver registry 0.3.6 and reject fork, workspace, local-path, or moving-ref dependencies from `develop`.
- **README overstates switching** -> Describe support and default only; do not advertise runtime failover or a user setting.

## Migration Plan

1. Freeze this PM-owned docs-only authority as a sole child of `a0551702931f8594fd02d5663997e3ec0c3f32e5`, validate it, and hand its immutable identity/gate evidence to Planner for prerequisite and source routing.
2. Complete and independently review Artico PR #41's in-place ready-only repair and the Trystero peer-connect/error-console implementation. Neither is merged by this authority.
3. Build one immutable Artico fork integration commit, then create the dual-provider WebChat source/test candidate with both reviewed workstreams and this authority in its ancestry.
4. Restore the Artico provider directory and dependency, add the single provider selector/default, retain Trystero, update current documentation, and run both shared/provider-specific controls plus full repository gates.
5. Use immutable integration commit `0deb0f0f` only for repaired-version build verification, then restore registry `@rtco/client@0.3.6` for the original delivery.
6. Remove WebChat compatibility fan-out/readiness logic, retain direct 0.3.6 delegation, and explicitly skip only the three tests unavailable in the unpatched registry package.
7. After the original 0.3.6 exact has complete gates, exact CI, fresh coding review, and canonical docs/status, clear the four-item batch and perform the ordinary protected merge to `develop`. No separate Owner acceptance is required.
8. After that batch reaches `develop`, the Owner has separately authorized direct `develop` to `master` promotion without another build/review/acceptance stage. Release and deploy remain unauthorized.
9. Under the later Owner-authorized follow-up, generate the repository patch only with pnpm native `patch`/`patch-commit`, keep the registry specifier at 0.3.6, restore the three controls, and publish a separate Draft candidate with exact CI and fresh coding review.
10. Treat any future repaired official Artico version as another separately Owner-authorized dependency change that intentionally removes or regenerates the patch.

Rollback is source-only: revert the dual-provider candidate and dependency changes. There is no protocol, schema, persistence, data, or server migration.

## Open Questions

None.
