## ADDED Requirements

### Requirement: Trystero is the sole supported room transport

Production SHALL contain exactly one supported room transport provider: pinned `trystero@0.25.3`. `src/runtime/RoomTransport.ts` and `src/runtime/RoomTransport.contract.test-utils.ts` SHALL remain at the Runtime root. The concrete Trystero implementation and provider-specific tests SHALL live under `src/runtime/transports/trystero/`. `src/runtime/host.ts` SHALL be the sole production composition point and SHALL import Trystero directly.

Production SHALL contain no Artico implementation, import, dependency, lock resolution, provider selector, alternative composition, compatibility path, supported-provider README/current-documentation claim, provider test, or active structural rule. Archived historical change records MAY retain Artico names and evidence for their own immutable exacts. There SHALL be no transport barrel, registry, or duplicated provider-local RoomTransport contract/shared harness.

`domain/runtime/externs/RoomTransport.ts` SHALL remain the private Domain injection port. The optional-target send capability and provider-neutral Runtime/Domain boundaries SHALL remain available without exposing Trystero types to UI, application Domains, protocol, persistence, or comctx contracts.

#### Scenario: Runtime layout has one provider

- **WHEN** Runtime source, imports, tests, package manifests, lockfile, current documentation, and structural rules are inspected
- **THEN** only `src/runtime/transports/trystero/` SHALL contain the concrete provider and its provider-specific tests, while the contract/shared harness remain at Runtime root and `host.ts` is the only production composition point
- **AND** no Artico implementation, dependency, selector, alternative composition, or current supported-provider claim SHALL remain

#### Scenario: A future provider requires a separate decision

- **WHEN** the current provider boundary is inspected
- **THEN** it SHALL expose the complete provider-neutral RoomTransport capability without a prebuilt barrel, registry, selector, compatibility facade, or second provider path

### Requirement: Room-wide product intent uses Trystero native broadcast

The private `RoomTransport.send(roomId, payload, target?)` capability SHALL preserve its complete optional-target meanings: omission is native room broadcast, a string is one peer, an array is the selected subset, and `[]` is no recipients. The Trystero adapter SHALL delegate omission as native broadcast without enumerating, filtering, de-duplicating, or self-excluding application peer ids.

Initial Session publication, ordinary Text and Reaction, every World full snapshot, and the existing eligible World whole-publication retry SHALL omit the target and use native room broadcast. History inventory-request pages SHALL retain the request-start `expectedProviders` array. History responses SHALL retain the requester target. Session and World current-state catch-up SHALL retain the peer that joined or reconnected after the prior publication.

The World retry SHALL remain eligible only after preflight fails before any provider invocation. It SHALL retry the same whole-publication intent as native broadcast to peers active at the later invocation. WebChat SHALL never retry after a provider call, create per-peer attempt state, add an acknowledgement/outbox/delivery status, or infer remote delivery from a successful return.

#### Scenario: Room-wide producers omit targets

- **GIVEN** initial Session, Text, Reaction, a World full snapshot, or an eligible zero-provider-call World retry
- **WHEN** the producer reaches the provider boundary
- **THEN** it SHALL make one omitted-target native broadcast and SHALL NOT derive a Session/World peer-id array or filter, de-duplicate, or self-exclude application membership for that send

#### Scenario: Request-specific sends remain targeted

- **GIVEN** a History inventory page, History response, Session catch-up, or World catch-up
- **WHEN** it reaches the provider boundary
- **THEN** History inventory SHALL target its request-start `expectedProviders`, the response SHALL target its requester, and catch-up SHALL target its existing joined/reconnected peer
- **AND** none of those sends SHALL be broadened to native room broadcast

#### Scenario: Zero active peers is successful best effort

- **GIVEN** a joined Trystero room has zero peers in its current active-peer set
- **WHEN** an admitted room-wide producer performs native broadcast
- **THEN** the send MAY make zero remote deliveries and SHALL settle without inventing targets, waiting for a peer, or adding a retry, acknowledgement, outbox, or delivery status
- **AND** protocol-valid local Text projection SHALL retain its existing behavior while later message convergence remains limited to existing History synchronization

#### Scenario: World never retries an invoked provider send

- **GIVEN** one World publication has invoked native broadcast or failed before invocation
- **WHEN** its current owner settles the result
- **THEN** an invoked send SHALL never be retried, while only the existing zero-provider-call preflight failure MAY retry the same whole-publication intent as a later native broadcast

### Requirement: Trystero activation converges through targeted current-state catch-up

Trystero native broadcast SHALL address only peers active at provider invocation. A peer that becomes active after an initial Session or World publication SHALL enter through the existing `onPeerJoin` path and receive the current Session and World state through explicit peer-targeted catch-up. Installing the provider callback SHALL preserve Trystero's replay of already-active peers.

Join success SHALL continue immediately through existing request, Room, generation, and owner checks. Domain initial Session then World publication, World recovery/replacement publication, and a never-invoked queue head resumed after join SHALL have no fixed one-second sleep, 999/1000ms boundary, after-sleep membership snapshot, or special room-wide target recomputation.

Generic serialized-send queueing and its queue identity, request, trusted Room, generation, owner, cancellation, and stale-completion fences SHALL remain. The implementation SHALL remove `targetPeerIdsOwner: 'session'`, `RoomWideSendResumeRequestedEvent`, `ResumeRoomWideSendCommand`, and only their special recomputation path. An already invoked provider send SHALL never be replayed.

#### Scenario: Later-active peer receives targeted state

- **GIVEN** initial Session or World native broadcast settles before one remote peer becomes active
- **WHEN** Trystero reports that peer through `onPeerJoin` while the same Room and owners remain current
- **THEN** the Runtime SHALL send that peer the current Session and World state through their existing explicit catch-up targets without repeating a room-wide publication

#### Scenario: Join continuation has no fixed grace

- **GIVEN** a current Domain or World join succeeds and still owns its continuation
- **WHEN** its initial or recovery publication becomes otherwise admissible
- **THEN** it SHALL proceed without `sleep(1000)`, a 999/1000ms gate, peer-id filtering, or after-sleep target recomputation
- **AND** existing request, Room, generation, owner, and cancellation checks SHALL still prevent stale publication

#### Scenario: Generic queue resume remains fenced

- **GIVEN** a serialized send head has not invoked the provider because its trusted Room was unavailable
- **WHEN** the current Room becomes available
- **THEN** the generic queue SHALL resume that head once in order under its existing queue identity, request, Room generation, and owner fences
- **AND** it SHALL use the original send intent without a fixed wait or special room-wide target-owner event/command, while stale or already-invoked work SHALL not send again

## MODIFIED Requirements

### Requirement: Provider capability is private behind WireDomain

The Runtime SHALL define one private `RoomTransportExtern` injected only into `WireDomain`. It SHALL express provider-neutral capabilities for stable local peer identity, room join/leave, optional-target send, transport-confirmed inbound source, peer join/leave, room close/error, and deterministic dispose. `RoomTransport` MAY remain only as the concrete implementation shape behind that Extern; it SHALL NOT be a public application port, protocol export, or capability imported by UI, application Domains, or non-Wire Runtime Domains.

Concrete Trystero implementation symbols and imports SHALL appear only in `src/runtime/transports/trystero/`, its provider-specific tests, and the explicit `src/runtime/host.ts` composition root. Package manifests, the lockfile, and current documentation MAY name pinned `trystero@0.25.3` as the sole supported provider, but provider-neutral Runtime/Domain boundaries SHALL expose no Trystero type or import. `WireDomain` SHALL remain the sole anti-corruption boundary: it validates trusted room/source identity, codec/schema/size limits, ordering and queue bounds, then emits typed Runtime Events; outbound typed Domain intent is encoded and sent only through its Effect and `RoomTransportExtern`. The former imperative `WireExtern` route and every direct concrete/provider call from another Domain SHALL remain absent.

Provider contract coverage SHALL preserve stable peer identity, join/leave, trusted inbound source, native broadcast, explicit string/array targets including `[]`, room-level failure, peer join/leave, close, error, and deterministic dispose without adding delivery acknowledgement. The shared harness SHALL remain provider-neutral at Runtime root and SHALL run against the sole Trystero implementation.

#### Scenario: Provider can be replaced without application change

- **WHEN** a future separately authorized provider implementation satisfies the private provider contract
- **THEN** ChatRoom, application Domains, Runtime owner semantics, peer protocol, persistence, and UI SHALL require no change; only its isolated provider directory and the sole host composition SHALL differ

#### Scenario: Artico does not leak

- **WHEN** imports, public exports, Domain Externs, protocol types, comctx contracts, and composition are inspected
- **THEN** concrete Trystero implementation symbols and imports SHALL remain inside its provider directory, provider-specific tests, and `host.ts`, while manifests, lockfile, and current documentation MAY name the pinned sole provider and only `WireDomain` SHALL obtain the provider-neutral `RoomTransportExtern`
- **AND** Artico symbols and dependencies SHALL be absent from current production, tests, composition, package resolution, and supported-provider documentation

#### Scenario: Provider contract parity

- **WHEN** the root shared RoomTransport contract suite runs against the sole Trystero implementation
- **THEN** it SHALL cover stable identity, join/leave, trusted inbound source, native broadcast, explicit targets and empty targets, provider events/failures, and deterministic dispose without delivery acknowledgement or provider-specific leakage into the shared harness

## REMOVED Requirements

### Requirement: Physical sends isolate per-target readiness transitions

**Reason**: The sole Trystero provider broadcasts only to its current active-peer set. WebChat no longer owns an Artico-specific snapshot/attempt-all layer or any per-target readiness transition behavior.

**Migration**: Room-wide product intent uses one native Trystero broadcast. History and current-state catch-up retain their explicit recipients. Generic queue/generation fencing remains, with no ACK, outbox, delivery status, or provider-call retry.

### Requirement: Artico room demand repairs a retained disconnected peer

**Reason**: Artico is no longer a supported provider and its retained-peer/restart lifecycle is removed with the implementation and dependency.

**Migration**: Trystero owns its provider lifecycle behind the unchanged RoomTransport capability. Runtime request, Room, generation, owner, leave, cancellation, error, and dispose fences remain provider-neutral.

### Requirement: Browser Artico peers use the single owned signaling endpoint

**Reason**: Artico and its Socket.IO signaling endpoint are removed from the product.

**Migration**: The sole Trystero provider retains its pinned Nostr strategy configuration. This change adds no endpoint selector, fallback provider, deployment, or signaling-server migration.
