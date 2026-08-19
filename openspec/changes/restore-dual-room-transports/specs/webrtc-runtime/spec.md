## ADDED Requirements

### Requirement: Artico is the default and Trystero remains supported

Production SHALL retain exactly two supported Runtime-private room transport providers: Artico and pinned Trystero 0.25.3. Artico SHALL be the build-time default. `src/constants/config.ts` SHALL own the one `'artico' | 'trystero'` provider selection constant, and its shipped value SHALL be `'artico'`.

`src/runtime/RoomTransportProvider.ts` SHALL be the sole concrete provider-selection helper. It SHALL create exactly one adapter selected by that constant. `src/runtime/host.ts` SHALL obtain its transport only through that helper. The unselected provider SHALL perform zero construction, signaling, room joins, global listener registration, cleanup, or other startup side effects.

Production SHALL add no user setting, runtime hot switch, environment selector, remote configuration, simultaneous dual connection, automatic fallback, provider negotiation, or second composition route. Changing provider SHALL require a source/build change and host restart.

#### Scenario: Shipped build selects only Artico

- **GIVEN** the shipped provider constant is inspected
- **WHEN** one shared Runtime host starts
- **THEN** it SHALL construct exactly one Artico adapter and SHALL NOT construct or activate Trystero

#### Scenario: Trystero remains a complete alternative

- **GIVEN** a test-owned build-time substitution selects `trystero`
- **WHEN** one shared Runtime host starts
- **THEN** it SHALL construct exactly one Trystero adapter and SHALL NOT construct or activate Artico
- **AND** the substitution SHALL introduce no production environment branch, runtime setting, fallback, or simultaneous provider

#### Scenario: Provider failure does not switch provider

- **GIVEN** the selected provider reports a join, room, send, close, or signaling failure
- **WHEN** existing scoped error and recovery ownership handles it
- **THEN** WebChat SHALL NOT instantiate or fall back to the other provider

### Requirement: Both providers implement ready-only best-effort sending

The private `RoomTransport.send(roomId, payload, target?)` capability SHALL preserve one provider-neutral meaning across Artico and Trystero: omission is one provider-native broadcast to peers ready at invocation, a string selects that peer if ready, an array selects its ready members, and `[]` selects no recipients.

Pending, closing, closed, missing, or otherwise non-ready peers SHALL be skipped without waiting, throwing a readiness-only failure, queueing, retrying, recording delivery state, or replaying after a later readiness transition. A zero-ready-peer operation SHALL settle as a successful no-recipient best-effort send. Successful settlement SHALL NOT assert remote receipt.

Trystero SHALL delegate omission to its native active-peer broadcast and explicit targets to its native action. Artico SHALL delegate the same optional target to an upstream Room version whose fan-out checks `Call.ready`, attempts every selected ready Call despite another ready Call's failure, and skips non-ready Calls. WebChat SHALL NOT enumerate provider peers, inspect DataChannels, cache readiness, or classify Artico's readiness error string.

Initial Session, Text, Reaction, every World full snapshot, and the eligible zero-provider-call World retry SHALL retain omitted-target broadcast. History inventory/response and Session/World current-state catch-up SHALL retain their existing explicit business targets. No fixed post-join wait or application-owned broadcast target array SHALL return.

#### Scenario: Mixed readiness broadcasts to ready peers only

- **GIVEN** either provider knows one ready peer and one pending or closing peer
- **WHEN** an omitted-target room-wide producer sends
- **THEN** only the ready peer SHALL receive a provider send attempt, the non-ready peer SHALL produce no readiness error, and the operation SHALL add no queue or later replay

#### Scenario: Explicit targets preserve ready-only meaning

- **GIVEN** a string or array target contains ready, pending, closing, missing, or duplicate provider peer ids
- **WHEN** the selected adapter sends
- **THEN** it SHALL preserve the provider's explicit-target semantics while invoking only ready peers
- **AND** one ready peer's genuine send failure SHALL NOT prevent another selected ready peer from being attempted in Artico's Room fan-out

#### Scenario: Empty or zero-ready target settles without delivery claim

- **GIVEN** the target is `[]` or no selected peer is ready
- **WHEN** the selected adapter sends
- **THEN** it SHALL settle without a physical send, readiness error, wait, retry, queue, acknowledgement, outbox, status, or remote-delivery claim

#### Scenario: A later-ready peer receives no old operation

- **GIVEN** a peer was skipped because it was not ready at invocation
- **WHEN** that peer later becomes ready
- **THEN** neither provider nor WebChat SHALL replay the skipped Text, Reaction, Session, World, or Artico stream operation solely because readiness changed
- **AND** only existing targeted Session/World catch-up and History synchronization MAY provide their already-authorized convergence

### Requirement: Restored Artico uses scoped ownership and owned signaling

Each Artico World or Chat room SHALL own an independent physical Artico peer identity, Room, pending join, recovery owner, and generation fences. Logical rooms SHALL NOT share an Artico peer. Every initial or replacement peer SHALL receive one built-in `SocketSignaling` configured with exact URL `wss://web-chat.io` and that peer generation's exact id.

Production SHALL NOT use Artico's implicit signaling default, `0.artico.dev`, an environment selector, endpoint list, fallback host, insecure downgrade, custom signaling protocol, or shared cross-room Artico peer. The built-in default Socket.IO path, WebSocket-only transport, compatibility, and id query SHALL remain.

Close-driven Artico replacement SHALL retain the established 10-second cadence. Fresh demand for a retained disconnected owner SHALL use the same single scoped restart owner. Leave/dispose and stale callbacks SHALL remain fenced to their exact Room owner. WebChat SHALL retain no Artico error message/name/code classifier.

#### Scenario: Artico rooms have independent physical owners

- **GIVEN** World and two Chat domains are active under the Artico selection
- **WHEN** their transports are inspected
- **THEN** each SHALL own a distinct Artico peer identity and Room lifecycle, and recovery or disposal of one SHALL NOT replace another

#### Scenario: Every Artico generation uses the owned endpoint

- **GIVEN** an initial or replacement Artico room owner creates a peer
- **WHEN** its signaling client is composed
- **THEN** exactly one built-in client SHALL use `wss://web-chat.io` and the same current peer id, with no unconfigured or alternate signaling client

#### Scenario: Artico recovery remains scoped

- **GIVEN** a current Artico owner closes or retained demand finds it disconnected
- **WHEN** recovery becomes eligible
- **THEN** one owner-fenced replacement path SHALL run at the established 10-second close cadence or immediate demand repair boundary
- **AND** stale, retired, or disposed generations SHALL produce no current-room event or cross-room effect

### Requirement: Temporary Artico fork dependency cannot enter develop

During Draft implementation and verification, `@rtco/client` MAY resolve from one full immutable commit in the Owner's Artico fork that contains the completed PR #41 client behavior and retained client fixes. It SHALL NOT resolve from a branch name, moving tag, local path, workspace link, uncommitted build, or other mutable reference.

Before a WebChat merge to `develop`, the manifest and lockfile SHALL resolve `@rtco/client` from an exact official upstream release containing the reviewed ready-only and failure-isolation behavior plus the retained listener fix. The installed official package SHALL be directly proven equivalent for the required behavior, and all focused/full gates plus fresh coding review SHALL pass on that dependency replacement.

Artico server-only PR #40 SHALL NOT be treated as a browser client dependency requirement even if it is present in the temporary fork integration commit.

#### Scenario: Draft verification uses immutable fork evidence

- **GIVEN** upstream has not yet published the required client fixes
- **WHEN** the dual-provider candidate is built for automated gates or coding verification
- **THEN** its Git dependency SHALL name one full immutable fork commit and the lockfile SHALL resolve that exact commit

#### Scenario: Develop merge requires official package provenance

- **GIVEN** the dual-provider candidate is otherwise accepted
- **WHEN** it becomes eligible for a `develop` merge
- **THEN** no personal-fork, branch, local-path, or mutable Artico dependency SHALL remain
- **AND** the exact official package, regenerated lockfile, required installed behavior, full gates, and fresh coding review SHALL all be current on that head

### Requirement: Current documentation identifies both supported providers

Current English and Chinese README documentation SHALL identify Artico as the default WebRTC room transport and Trystero as a supported alternative using its default Nostr strategy. `AGENTS.md` and active architecture/provider assertions SHALL describe the two-provider composition without claiming Trystero is sole or implying runtime automatic fallback or a user-facing selector.

Archived historical change records MAY retain the provider truth of their own exacts. The current manifest, lockfile, provider directories, composition, tests, English README, Chinese README, and active agent/architecture guidance SHALL agree on the supported provider set and default.

#### Scenario: Current documentation matches composition

- **WHEN** current source, manifest, lockfile, English/Chinese README, agent guidance, and active architecture assertions are inspected
- **THEN** each SHALL preserve Artico and Trystero support, identify Artico as default where a default is stated, and make no sole-Trystero, automatic-fallback, runtime-switch, or user-setting claim

## MODIFIED Requirements

### Requirement: Provider capability is private behind WireDomain

The Runtime SHALL define one private `RoomTransportExtern` injected only into `WireDomain`. It SHALL express provider-neutral capabilities for stable local peer identity, room join/leave, optional-target ready-only send, transport-confirmed inbound source, peer join/leave, room close/error, and deterministic dispose. `RoomTransport` MAY remain only as the concrete implementation shape behind that Extern; it SHALL NOT be a public application port, protocol export, or capability imported by UI, application Domains, or non-Wire Runtime Domains.

Concrete Artico implementation symbols and imports SHALL appear only in `src/runtime/transports/artico/`, its provider-specific tests, and the explicit `src/runtime/RoomTransportProvider.ts` composition helper. Concrete Trystero implementation symbols and imports SHALL have the same boundary under `src/runtime/transports/trystero/`. Package manifests, the lockfile, and current documentation MAY name both supported providers, but provider-neutral Runtime/Domain boundaries SHALL expose no Artico or Trystero type or import.

Each provider directory SHALL name its implementation `RoomTransport.ts` and its provider-specific test `RoomTransport.test.ts`. It SHALL NOT repeat its directory context in `ArticoRoomTransport*` or `TrysteroRoomTransport*` filenames. The composition helper MAY distinguish same-named exports with local import aliases.

`WireDomain` SHALL remain the sole anti-corruption boundary: it validates trusted room/source identity, codec/schema/size limits, ordering and queue bounds, then emits typed Runtime Events; outbound typed Domain intent is encoded and sent only through its Effect and `RoomTransportExtern`. The former imperative `WireExtern` route and every direct concrete/provider call from another Domain SHALL remain absent.

The root shared provider contract SHALL run against both implementations and preserve stable identity, join/leave, trusted inbound source, omitted ready-peer broadcast, explicit string/array targets including `[]`, zero-ready settlement, room-level failure, peer join/leave, close/error, and deterministic dispose without delivery acknowledgement.

#### Scenario: Provider can be replaced without application change

- **WHEN** the build-time constant changes between `artico` and `trystero`
- **THEN** ChatRoom, application Domains, Runtime owner semantics, peer protocol, persistence, UI, and comctx contracts SHALL require no change
- **AND** only the provider-neutral composition helper SHALL select one already-conforming isolated adapter

#### Scenario: Artico does not leak

- **WHEN** imports, public exports, Domain Externs, protocol types, comctx contracts, persistence, UI, and composition are inspected
- **THEN** concrete provider symbols SHALL remain inside their respective provider directories/tests and `RoomTransportProvider.ts`
- **AND** each provider directory SHALL use only the contextual `RoomTransport.ts` and `RoomTransport.test.ts` names, with no provider-prefixed duplicate filename
- **AND** only `WireDomain` SHALL obtain the provider-neutral `RoomTransportExtern`

#### Scenario: Provider contract parity

- **WHEN** the root shared RoomTransport contract suite runs independently against Artico and Trystero
- **THEN** both SHALL satisfy the same identity, lifecycle, trusted-source, ready-only broadcast/target, zero-recipient, event/failure, and dispose meanings without provider-specific leakage into the harness

## REMOVED Requirements

### Requirement: Trystero is the sole supported room transport

**Reason**: The Owner now requires Artico and Trystero to remain supported, with Artico selected by default.

**Migration**: Restore Artico under its own provider directory, add the single build-time selection constant and composition helper, retain Trystero, and run the shared root contract against both.

### Requirement: Room-wide product intent uses Trystero native broadcast

**Reason**: Room-wide intent remains omitted-target provider-native broadcast, but it is no longer Trystero-specific.

**Migration**: Both providers implement the new ready-only best-effort requirement. The existing room-wide versus request-specific producer classification and no-ACK/no-retry boundaries remain unchanged.

### Requirement: Trystero activation converges through targeted current-state catch-up

**Reason**: Current-state catch-up remains required for either provider when a peer becomes ready after prior room-wide publication.

**Migration**: Retain the existing provider-neutral `onPeerJoin` targeted Session/World catch-up, generic queue fences, and no fixed wait; provider-specific activation remains inside each adapter.
