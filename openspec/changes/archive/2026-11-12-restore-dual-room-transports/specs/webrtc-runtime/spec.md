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

### Requirement: Both providers preserve target shape and native send behavior

The private `RoomTransport.send(roomId, payload, target?)` capability SHALL preserve one provider-neutral target shape across Artico and Trystero: omission requests one provider-native room broadcast, a string selects that provider peer id, an array supplies those provider peer ids under native provider semantics, and `[]` selects no recipients.

WebChat SHALL NOT enumerate provider peers, inspect DataChannels, cache readiness, wait, queue, retry, record delivery state, or replay an old operation after a later readiness transition. Successful settlement SHALL NOT assert remote receipt.

Trystero SHALL delegate omission to its native active-peer broadcast and explicit targets to its native action. The delivered Artico adapter SHALL use registry `@rtco/client@0.3.6` with its repository-owned pnpm patch and directly invoke `room.send(payload, target)`. WebChat SHALL NOT implement Artico ready-only/attempt-all behavior, catch its readiness error string, or add an adapter fan-out layer. The patched package SHALL skip selected pending Calls, attempt every selected ready Call in provider order, and preserve the first ready-Call failure identity.

Initial Session, Text, Reaction, every World full snapshot, and the eligible zero-provider-call World retry SHALL retain omitted-target broadcast. History inventory/response and Session/World current-state catch-up SHALL retain their existing explicit business targets. No fixed post-join wait or application-owned broadcast target array SHALL return.

#### Scenario: Trystero retains native active-peer sending

- **GIVEN** Trystero knows one active peer and one pending or inactive peer
- **WHEN** an omitted or explicit-target producer sends
- **THEN** its native action SHALL preserve Trystero's active-peer semantics
- **AND** WebChat SHALL add no readiness cache, wait, queue, retry, or later replay

#### Scenario: Artico 0.3.6 delegates directly

- **GIVEN** Artico is selected with registry `@rtco/client@0.3.6`
- **WHEN** the adapter sends with an omitted, string, array, or empty-array target
- **THEN** it SHALL invoke `room.send(payload, target)` exactly once without enumerating Calls or reading readiness
- **AND** the patched package SHALL skip selected pending Calls, attempt selected ready Calls in order, and reject with the first ready-Call failure only after those attempts

#### Scenario: Empty target preserves no-recipient behavior

- **GIVEN** the target is `[]`
- **WHEN** the selected adapter sends
- **THEN** it SHALL settle without a selected recipient, wait, retry, queue, acknowledgement, outbox, status, or remote-delivery claim

#### Scenario: WebChat does not replay after readiness changes

- **GIVEN** a provider did not deliver an operation because a peer was pending, inactive, missing, or failed during native send
- **WHEN** that peer later becomes ready
- **THEN** WebChat SHALL NOT replay the old Text, Reaction, Session, World, or Artico stream operation solely because readiness changed
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

### Requirement: Delivery uses registry Artico 0.3.6 with a pnpm-native patch

The current WebChat delivery SHALL resolve registry `@rtco/client@0.3.6`. pnpm's native patch metadata SHALL map that exact package to the repository patch file and lockfile patch hash. Delivery SHALL NOT resolve from a personal fork, branch name, moving tag, local path, workspace link, Git subdirectory, uncommitted build, custom patch runner, vendored package, manual Artico build, or other mutable reference.

Immutable integration commit `0deb0f0f` MAY remain provenance for the repaired behavior encoded in the pnpm patch, but it SHALL NOT remain a Git delivery dependency or create a wait for an upstream release or Artico preview authorization. The three ready-only/attempt-all controls SHALL execute and pass; every other provider and selector control SHALL remain active. Those controls are sufficient patch-effect evidence, and no additional installed-dist proof gate SHALL be required.

Any later repaired official Artico version SHALL require explicit Owner authorization. That future change SHALL use one exact registry version, intentionally remove or regenerate the patch metadata, rerun complete gates, and receive fresh coding review. Artico server-only PR #40 and Vercel preview authorization SHALL NOT be treated as current WebChat browser-client gates.

#### Scenario: Current delivery resolves and patches registry 0.3.6

- **GIVEN** the dual-provider candidate is built for delivery
- **WHEN** its dependency, pnpm workspace configuration, patch file, and lockfile are inspected
- **THEN** `@rtco/client` SHALL resolve to registry version `0.3.6`
- **AND** pnpm SHALL apply the repository patch through its canonical metadata and lockfile hash
- **AND** no fork, Git subdirectory, workspace link, local path, moving ref, custom runner, vendor copy, or manual build SHALL remain

#### Scenario: Repaired controls are active

- **GIVEN** registry Artico 0.3.6 is installed with the repository pnpm patch
- **WHEN** the Artico provider tests run
- **THEN** the three pending-skip, selected-order, and first-ready-failure controls SHALL execute and pass
- **AND** lifecycle, signaling, ownership, omitted/string/array/empty targets, missing-room, error identity, selector, and Trystero controls SHALL remain active

#### Scenario: Later repaired-version adoption is separate

- **GIVEN** a repaired official Artico version becomes available
- **WHEN** the Owner authorizes WebChat to adopt it
- **THEN** the candidate SHALL use that exact registry package, intentionally remove or regenerate the patch, and pass the active controls, complete gates, and fresh coding review
- **AND** availability alone SHALL NOT change the current delivery dependency or block the current batch

### Requirement: Current documentation identifies both supported providers

Current English and Chinese README documentation SHALL identify Artico as the default WebRTC room transport and Trystero as a supported alternative using its default Nostr strategy. `AGENTS.md` and active architecture/provider assertions SHALL describe the two-provider composition without claiming Trystero is sole or implying runtime automatic fallback or a user-facing selector.

Archived historical change records MAY retain the provider truth of their own exacts. The current manifest, lockfile, provider directories, composition, tests, English README, Chinese README, and active agent/architecture guidance SHALL agree on the supported provider set and default.

#### Scenario: Current documentation matches composition

- **WHEN** current source, manifest, lockfile, English/Chinese README, agent guidance, and active architecture assertions are inspected
- **THEN** each SHALL preserve Artico and Trystero support, identify Artico as default where a default is stated, and make no sole-Trystero, automatic-fallback, runtime-switch, or user-setting claim

## MODIFIED Requirements

### Requirement: Provider capability is private behind WireDomain

The Runtime SHALL define one private `RoomTransportExtern` injected only into `WireDomain`. It SHALL express provider-neutral capabilities for stable local peer identity, room join/leave, optional-target provider-native send, transport-confirmed inbound source, peer join/leave, room close/error, and deterministic dispose. `RoomTransport` MAY remain only as the concrete implementation shape behind that Extern; it SHALL NOT be a public application port, protocol export, or capability imported by UI, application Domains, or non-Wire Runtime Domains.

Concrete Artico implementation symbols and imports SHALL appear only in `src/runtime/transports/artico/`, its provider-specific tests, and the explicit `src/runtime/RoomTransportProvider.ts` composition helper. Concrete Trystero implementation symbols and imports SHALL have the same boundary under `src/runtime/transports/trystero/`. Package manifests, the lockfile, and current documentation MAY name both supported providers, but provider-neutral Runtime/Domain boundaries SHALL expose no Artico or Trystero type or import.

Each provider directory SHALL name its implementation `RoomTransport.ts` and its provider-specific test `RoomTransport.test.ts`. It SHALL NOT repeat its directory context in `ArticoRoomTransport*` or `TrysteroRoomTransport*` filenames. The composition helper MAY distinguish same-named exports with local import aliases.

`WireDomain` SHALL remain the sole anti-corruption boundary: it validates trusted room/source identity, codec/schema/size limits, ordering and queue bounds, then emits typed Runtime Events; outbound typed Domain intent is encoded and sent only through its Effect and `RoomTransportExtern`. The former imperative `WireExtern` route and every direct concrete/provider call from another Domain SHALL remain absent.

The root shared provider contract SHALL run against both implementations and preserve stable identity, join/leave, trusted inbound source, omitted provider-native broadcast, explicit string/array targets including `[]`, room-level failure, peer join/leave, close/error, and deterministic dispose without delivery acknowledgement. Provider-specific controls SHALL own Artico pending-skip, selected-order, attempt-all, and first-failure behavior without leaking it into the provider-neutral adapter contract.

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
- **THEN** both SHALL satisfy the same identity, lifecycle, trusted-source, target-shape, event/failure, and dispose meanings without provider-specific leakage into the harness
- **AND** provider-native fan-out differences SHALL remain provider-specific and accurately represented by active controls

## REMOVED Requirements

### Requirement: Trystero is the sole supported room transport

**Reason**: The Owner now requires Artico and Trystero to remain supported, with Artico selected by default.

**Migration**: Restore Artico under its own provider directory, add the single build-time selection constant and composition helper, retain Trystero, and run the shared root contract against both.

### Requirement: Room-wide product intent uses Trystero native broadcast

**Reason**: Room-wide intent remains omitted-target provider-native broadcast, but it is no longer Trystero-specific.

**Migration**: Both providers preserve the same optional target shape while executing their native send behavior. The existing room-wide versus request-specific producer classification and no-ACK/no-retry boundaries remain unchanged.

### Requirement: Trystero activation converges through targeted current-state catch-up

**Reason**: Current-state catch-up remains required for either provider when a peer becomes ready after prior room-wide publication.

**Migration**: Retain the existing provider-neutral `onPeerJoin` targeted Session/World catch-up, generic queue fences, and no fixed wait; provider-specific activation remains inside each adapter.
