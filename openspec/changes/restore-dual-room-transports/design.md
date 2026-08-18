## Context

The authority parent is `docs/silence-trystero-peer-connect-error@a0551702931f8594fd02d5663997e3ec0c3f32e5`, whose sole parent is `develop@b49951189f25530153ee098aa08947fcde28b55f`. It preserves Trystero 0.25.3 as the current provider, makes one post-SDP peer-connect callback class provider-locally silent, and removes non-error production console output.

The completed `adopt-trystero-native-room-broadcast` authority made Trystero the sole provider and removed Artico, its selector, and all alternative-composition surfaces. This change explicitly supersedes only that sole-provider decision. Its provider-neutral send classification, removal of fixed post-join waits, targeted History/current-state catch-up, zero-recipient best effort, generic Wire queue fencing, and no-ACK/no-retry boundaries remain authoritative.

Artico PR #41 currently isolates each selected Call's failure so one throwing Call does not prevent later Calls from being attempted. The Owner has authorized completing that same PR in place: `Room.send` and the per-peer `Room.addStream` operation act only on Calls ready at invocation; pending Calls are skipped with no queue or later replay. `Peer.send` retains its defensive readiness check. That upstream repair is a prerequisite for selecting Artico by default here.

## Goals / Non-Goals

**Goals:**

- Keep Artico and Trystero as two complete, replaceable Runtime-private providers.
- Select Artico by default through one auditable build-time constant and one Runtime composition helper.
- Preserve one provider-neutral contract and keep application/Domain/protocol code provider-agnostic.
- Align both adapters on immediate ready-peer best-effort sending without waits, application peer snapshots, queues, retries, or delivery claims.
- Restore Artico's established per-room ownership, owned signaling endpoint, and recovery behavior.
- Retain Trystero's Nostr strategy, provider-local peer-connect silence, and all current lifecycle fencing when Trystero is selected.
- Keep temporary fork usage out of the permanent `develop` dependency graph.

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
      ArticoRoomTransport.ts
      ArticoRoomTransport.test.ts
    trystero/
      TrysteroRoomTransport.ts
      TrysteroRoomTransport.test.ts
```

`domain/runtime/externs/RoomTransport.ts` remains the private Domain injection port. The root concrete `RoomTransport.ts` shape and shared contract harness remain provider-neutral and are not duplicated inside provider directories.

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

### 3. Ready-only best-effort send semantics are shared

The private capability remains:

```ts
send(roomId, payload, target?: string | string[]): Promise<void>
```

The meanings are provider-neutral:

| Target       | Meaning at provider invocation                                       |
| ------------ | -------------------------------------------------------------------- |
| omitted      | one provider-native broadcast to every peer ready at that invocation |
| string       | that peer only if ready; otherwise no recipient                      |
| string array | the listed peers that are ready; preserve provider target semantics  |
| empty array  | no recipients                                                        |

Pending, closing, closed, missing, or otherwise non-ready peers are not delivery failures for this immediate operation. They are skipped without queueing, waiting, retrying, recording status, or replaying after readiness changes. A successful return means only that the provider accepted all physical calls it actually made; it does not prove remote receipt.

For Trystero, omitted target remains its native action broadcast over `activePeerMap`; explicit targets remain native action targets. For Artico, the adapter delegates the same optional target to the upstream Room whose completed PR #41 implementation filters Calls by `Call.ready` before invoking them and retains failure isolation among ready Calls. WebChat does not enumerate provider peers or inspect DataChannels in either adapter.

The complete room-wide versus request-specific producer classification remains unchanged: initial Session, Text, Reaction, World snapshot, and eligible zero-call World retry omit target; History inventory/response and Session/World catch-up retain explicit business targets. Fixed one-second waits and application-owned broadcast target arrays do not return.

### 4. Artico restores its scoped provider behavior

Each Artico World or Chat room retains one independent owner with its own Artico peer identity, Room, join settlement, restart owner, and generation fences. Different logical rooms do not share an Artico peer.

Every Artico peer generation explicitly receives the built-in `SocketSignaling` configured with `wss://web-chat.io` and the same current physical peer id. There is no implicit `0.artico.dev` default, endpoint list, environment selector, fallback host, custom signaling protocol, or insecure downgrade. The default Socket.IO path, WebSocket-only behavior, and identity query remain.

The established close-driven Artico restart cadence remains 10 seconds. Fresh demand repairs a retained disconnected owner through the same single restart path. Leave/dispose retires the current room and peer under existing owner fences. Artico errors remain scoped to the exact current room owner; no provider message/name/code classification is introduced.

The restored adapter uses the completed upstream ready-only Room fan-out. It does not reproduce that logic in WebChat, catch the exact `Connection is not established yet.` string, or add a second readiness cache.

### 5. Trystero remains complete when selected

Trystero remains pinned to 0.25.3 and uses its default Nostr strategy. Its adapter retains current join/leave settlement, shared-peer ownership, active-room/generation fencing, native broadcast, targeted send, and deterministic dispose behavior.

The provider-local `could not connect to peer ` callback exception remains active whenever Trystero is selected: the adapter returns with no generic error, Toast, console output, or state. Non-matching join errors still reach the generic owner exactly once. Selecting Artico does not delete, weaken, or move these Trystero controls.

No product code attempts to fall back from Artico to Trystero after an Artico failure, or vice versa. A provider failure follows that provider's existing scoped error and recovery path.

### 6. Fork dependency is acceptance-only

Source implementation may temporarily pin `@rtco/client` to a full immutable commit in `molvqingtai/artico` that combines the completed PR #41 with the retained Artico client fixes needed by WebChat. A branch name, tag controlled by the fork, workspace path, floating Git ref, or uncommitted package is not acceptable evidence.

That immutable fork dependency is permitted only for implementation, automated gates, and Owner acceptance on a Draft candidate. Before a WebChat merge to `develop`, upstream must publish an official `@rtco/client` version containing the required client behavior. The candidate must replace the Git dependency with that exact official version, regenerate the lockfile, prove the installed package contains the reviewed ready-only/failure-isolation behavior, rerun the complete gates, and receive a fresh coding review for the dependency-only replacement.

Artico PR #40 is server-only and is not a browser client dependency requirement. It may be present in the temporary fork integration exact, but the WebChat merge gate is defined by the official client package containing the client-side PR #41 readiness/failure-isolation change and the retained listener fix used by the restored adapter.

### 7. Documentation states the supported default truth

`README.md`, `README_zh.md`, `AGENTS.md`, and active architecture/provider assertions must stop claiming Trystero is the sole provider.

The English and Chinese README Built With sections must identify Artico as WebChat's default WebRTC room transport and Trystero as a supported alternative using its default Nostr strategy. They must not claim runtime automatic failover or a user-facing selector.

Historical archived OpenSpec records remain unchanged. Active completed changes may retain their historical exact statements, while this newer change explicitly supersedes the sole-provider product decision.

### 8. Evidence proves parity and non-instantiation

The root shared contract suite runs unchanged against both adapters and covers stable local identity, join/leave, inbound trusted source, omitted broadcast, string/array/empty targets, ready-only/no-recipient settlement, peer join/leave, close/error, and dispose.

Provider-specific controls additionally prove:

- Artico per-room physical ownership, `wss://web-chat.io`, 10-second scoped recovery, upstream ready-only behavior, and no error-string handling in WebChat;
- Trystero Nostr composition, join/leave fences, matching peer-connect silence, and non-matching error forwarding;
- the default constant selects and instantiates Artico exactly once while Trystero has zero construction/side effects;
- a test-only constant substitution selects Trystero exactly once while Artico has zero construction/side effects, without creating a production environment branch;
- source/dependency/layout/current-documentation scans retain both providers and reject provider leakage outside authorized surfaces; and
- the temporary fork-to-official dependency transition is explicit and immutable.

## Risks / Trade-offs

- **Two providers can drift** -> Run one mutation-sensitive shared contract against both and keep provider-specific behavior in isolated suites.
- **Default Artico reintroduces pending Call failures** -> Require the completed PR #41 ready-only fan-out before integration; do not reproduce its logic in WebChat.
- **Pending peers miss immediate sends** -> Accept the existing best-effort contract; Session/World catch-up and History remain the only established convergence paths.
- **Both providers accidentally connect** -> Centralize selection in one helper and directly prove the unselected factory has zero construction and side effects.
- **Personal fork becomes permanent infrastructure** -> Allow only a full commit for Draft acceptance and make an official upstream package a closed `develop` merge gate.
- **README overstates switching** -> Describe support and default only; do not advertise runtime failover or a user setting.

## Migration Plan

1. Freeze this PM-owned docs-only authority as a sole child of `a0551702931f8594fd02d5663997e3ec0c3f32e5`, validate it, and hand its immutable identity/gate evidence to Planner for prerequisite and source routing.
2. Complete and independently review Artico PR #41's in-place ready-only repair and the Trystero peer-connect/error-console implementation. Neither is merged by this authority.
3. Build one immutable Artico fork integration commit, then create the dual-provider WebChat source/test candidate with both reviewed workstreams and this authority in its ancestry.
4. Restore the Artico provider directory and dependency, add the single provider selector/default, retain Trystero, update current documentation, and run both shared/provider-specific controls plus full repository gates.
5. Use the immutable fork commit for Draft implementation and Owner acceptance only.
6. After upstream publishes the required Artico client fixes, replace the fork dependency with the exact official version, regenerate the lockfile, rerun full gates, and obtain fresh coding review.
7. Only after canonical task/status completion and Owner acceptance may an explicitly authorized merge to `develop` occur. Master promotion, release, deploy, signaling-server change, or production write requires separate authority.

Rollback is source-only: revert the dual-provider candidate and dependency changes. There is no protocol, schema, persistence, data, or server migration.

## Open Questions

None.
