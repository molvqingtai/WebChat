## Context

The authority base is `develop@0a8a6fa8b3b29a550e238da9f20542e4b6fa4416`. The current product first introduced explicit room-wide target arrays and fixed post-join waits to avoid an Artico failure mode: an untargeted Artico room send could enumerate a signaling-known Call whose local DataChannel was not open, synchronously throw, and interrupt later Calls.

That rationale does not apply to the sole selected provider. In pinned `trystero@0.25.3`, an omitted-target action sends only to ids in `activePeerMap`. A peer is inserted there only after handshake activation, immediately before `onPeerJoin`; registering the handler also replays already-active peers. Native broadcast therefore means "all peers Trystero currently considers active", not "every signaling-known peer".

This is still best-effort transport acceptance. If no peer is active when a room-wide Text, Reaction, Session, or World fact is broadcast, the provider call may make zero remote deliveries and still resolve. A later peer receives current Session and World state through the existing targeted `onPeerJoin` catch-up. A Text or Reaction missed during a reconnect window is recovered only through later History synchronization. This change adds no delivery guarantee.

This authority supersedes the current behavior in `restore-targeted-room-sends`, the Artico provider/signaling requirements, and the Artico half of recovery-cadence authority. Other retained parts of those changes remain authoritative. Historical completed or archived change records remain evidence for their own exacts, not current product support.

## Goals / Non-Goals

**Goals:**

- Express room-wide product intent directly as Trystero native broadcast.
- Retain explicit targets wherever the recipient is part of the business request.
- Remove fixed join timing and the special target-recomputation machinery it created.
- Remove Artico completely from current production, dependency, test, documentation, and structure surfaces.
- Establish one durable provider directory convention without adding a selection abstraction for a single provider.

**Non-Goals:**

- No acknowledgement, outbox, replay, delivery status, provider-call retry, per-peer retry, or remote-delivery guarantee.
- No readiness probing, `readyPeers` cache, DataChannel inspection, application-owned broadcast recipient filtering, or fixed grace period.
- No change to Session/World membership meaning, History request identity/provider snapshot/pagination/settlement, peer protocol, persistence, local projection, Toast routing, or browser lifecycle.
- No transport registry, barrel, runtime selector, compatibility facade, or retained Artico fallback.

## Decisions

### 1. Provider layout has one contract and one concrete provider

The stable concrete contract and shared provider test harness remain at Runtime root:

```text
src/runtime/
  RoomTransport.ts
  RoomTransport.contract.test-utils.ts
  host.ts
  transports/
    trystero/
      TrysteroRoomTransport.ts
      TrysteroRoomTransport.test.ts
```

`domain/runtime/externs/RoomTransport.ts` remains the Domain injection port. Runtime's concrete `RoomTransport.ts` remains the provider implementation shape behind that port. Neither belongs to a provider directory.

`runtime/host.ts` directly imports and constructs Trystero. There is no `TransportProvider`, provider selector, `transports/index.ts`, registry, or second composition path. A future provider, if separately authorized, must occupy its own sibling directory and satisfy the same root shared contract; this change does not prebuild that choice.

Current source, tests, dependencies, lockfile, README/current documentation, and active structural assertions contain no supported Artico implementation or alternative. Archived historical OpenSpec records may retain Artico evidence because changing them would rewrite prior facts.

### 2. Room-wide intent broadcasts; request-specific intent remains targeted

The low-level capability remains:

```ts
send(roomId, payload, target?: string | string[]): Promise<void>
```

Its meanings remain complete: omission is native room broadcast, a string is one peer, an array is that selected subset, and `[]` is no recipients. The Trystero adapter delegates omission as its native broadcast target and does not enumerate peers itself.

Product send classification is closed:

| Producer                                | Provider target                         |
| --------------------------------------- | --------------------------------------- |
| Initial Session publication             | omitted, native broadcast               |
| Text/Reaction                           | omitted, native broadcast               |
| World full snapshot                     | omitted, native broadcast               |
| World zero-call whole-publication retry | omitted, native broadcast               |
| History inventory-request page          | request-start `expectedProviders` array |
| History response                        | existing requester peer                 |
| Session/World current-state catch-up    | existing joined/reconnected peer        |

Room-wide producers do not read, filter, de-duplicate, or self-exclude Session or World peer ids before sending. Business membership remains owned because it drives presence, History correlation, release, and catch-up; it is not a broadcast recipient cache.

The World retry remains the existing whole-publication retry only when preflight failed before any provider invocation. It retries the same publication intent, now as another native broadcast to the peers active at that later invocation. Once any provider call is made, its failure is never retried. No per-peer attempt state is introduced.

### 3. Trystero activation plus targeted catch-up replaces fixed waiting

Join success immediately continues through the existing owner checks and publication sequence. Domain initial Session then World publication has no one-second sleep. World recovery/replacement publication has no one-second sleep. A never-invoked serialized queue head resumed after join has no special grace or after-sleep recipient recomputation.

Trystero broadcasts only to peers active at invocation. A peer that activates after an initial Session or World broadcast triggers the existing `onPeerJoin` path, which sends that peer the current Session/World state explicitly. Catch-up remains generation- and owner-fenced so stale joins cannot publish current state.

Generic Wire queue behavior remains. A never-invoked head can still pause until its trusted Room is available and resume once under the existing queue identity, request, Room generation, and owner fences. Removing `targetPeerIdsOwner: 'session'`, `RoomWideSendResumeRequestedEvent`, and `ResumeRoomWideSendCommand` removes only the special room-wide target recomputation branch. It does not authorize bypassing queue order, replaying an invoked send, or accepting a stale completion.

### 4. Zero active peers is a successful no-recipient broadcast

An admitted room-wide send may reach a joined Trystero room with zero active peers. The native action then has no remote target and resolves successfully. WebChat does not convert this into an Error, wait, retry, target array, or delivery state.

Protocol-valid local Text projection retains its existing contract and is not rolled back by zero remote recipients or later transport failure. A later peer can recover retained messages through History. Session and World current state converge through targeted catch-up. This is the accepted trade-off of retaining no ACK, outbox, or provider-call retry.

### 5. Tests prove semantic boundaries instead of elapsed heuristics

Remove controls whose only contract is five explicit room-wide arrays, peer-id filtering/de-duplication/self-exclusion for broadcasts, pre/post-sleep membership changes, 999/1000ms timing, or the special room-wide resume event/command.

Replacement controls must prove:

- all four room-wide producer classes omit the target, including World's eligible zero-call retry;
- History inventory/response and Session/World catch-up retain exact targets;
- zero active peers resolves without inventing a target or provider-call retry;
- a peer activated after initial publication receives targeted current Session/World catch-up;
- generic queue order, never-invoked resume, generation/owner fencing, stale cancellation, and already-invoked no-retry behavior remain;
- provider layout, sole host composition, shared root contract, and complete Artico/source/dependency/current-doc residue removal.

Controls should be mutation-sensitive: restoring a room-wide target array, a fixed one-second delay, the special recompute path, an Artico alternative, or broadening History/catch-up to broadcast must fail.

## Risks / Trade-offs

- **Broadcast occurs with no active peer** -> Treat it as successful best effort; later History and targeted state catch-up provide the existing convergence paths.
- **A peer activates immediately after broadcast** -> Send only current Session/World catch-up to that peer; do not duplicate room-wide publication or invent Text/Reaction replay.
- **History is accidentally broadened** -> Keep request-start `expectedProviders` and requester identities explicit and mutation-test both directions.
- **Removing the special resume path weakens fencing** -> Preserve generic queue identity, Room generation, owner revalidation, and stale cancellation; remove only recipient recomputation and fixed waiting.
- **Single-provider cleanup leaves hidden Artico support** -> Scan production, tests, package manifests, lockfile, README/current docs, imports, composition, and structural rules; allow mentions only in archived historical records.
- **Provider organization grows a registry prematurely** -> Require direct host composition and forbid barrels/selectors while only Trystero is supported.

## Migration Plan

1. Freeze this docs-only authority as the sole child of `develop@0a8a6fa8b3b29a550e238da9f20542e4b6fa4416`, validate it, and obtain fresh independent docs review.
2. From the reviewed exact, inventory the current broadcast/targeted producers, join waits, special Wire resume path, provider files/imports/dependencies, current documentation, and affected controls before source edits.
3. Produce one cumulative source/test candidate implementing the closed classification and layout, carrying this authority unchanged except truthful task checkbox updates.
4. Run focused mutation-sensitive controls plus repository format, lint, typecheck, full test, Chrome/Firefox build, pack, strict OpenSpec/status, and cleanliness gates. Freeze and push one immutable exact.
5. Obtain fresh cumulative source review, then hand the reviewed exact to the Owner for product acceptance. Keep the PR Draft; do not mark Ready, merge, release, deploy, or write production data without separate authority.

Rollback is source-only. Revert the cumulative candidate; there is no schema, persistence, protocol, deployment, or data migration.

## Open Questions

None.
