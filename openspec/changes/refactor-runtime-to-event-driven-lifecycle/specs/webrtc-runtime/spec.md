## ADDED Requirements

### Requirement: Runtime lifecycle is replaced by one event-driven authority

The Runtime lifecycle SHALL be implemented from one explicit event and state model. Chromium MV3 Page RPC, browser tab/navigation lifecycle, Offscreen provider callbacks, and browser host lifecycle SHALL enter the Background Service Worker's logical Runtime authority. Firefox MV2 SHALL deliver the corresponding events to its persistent Background Page/HTML authority. Commands SHALL express intent, Events SHALL record accepted facts, Queries SHALL read current state, and Effects or Extern adapters SHALL own external I/O without retaining a second copy of authoritative Runtime state.

The replacement SHALL NOT import, call, wrap, delegate to, preserve, or use the legacy Runtime lifecycle or its internal call order as control authority. The replacement and removal of the superseded implementation SHALL land in the same candidate exact. There SHALL be no reachable compatibility fallback, feature flag, dual architecture, dual read/write path, shadow owner, or transitional adapter.

Tests SHALL be derived from accepted events, current state, and externally observable transitions. They SHALL NOT use legacy helper order, legacy fixtures, or the old implementation itself as the behavioral oracle, except that the frozen old exact MAY serve as a fail-before demonstration of the contract gap.

#### Scenario: Candidate has one event-driven lifecycle

- **GIVEN** a source candidate claims the Runtime replacement
- **WHEN** its production reachability, state owners, adapters, and tests are inspected
- **THEN** exactly one event-driven lifecycle SHALL own Runtime behavior, the superseded lifecycle SHALL be absent or unreachable, and no compatibility or dual-path mechanism SHALL remain

#### Scenario: Tests do not preserve incidental old control flow

- **GIVEN** the target event/state contract defines an externally observable lifecycle result
- **WHEN** controls are written for that result
- **THEN** they SHALL drive the authoritative event inputs and assert current state or effects without requiring legacy helper identity, call ordering, wrapper delegation, or old fixture behavior

### Requirement: Browser targets have exact Runtime and transport owners

On Chromium MV3, the Background Service Worker SHALL solely own logical Chat and World Rooms, Sessions, page/domain registry, trusted bindings, Page callback ownership, provider callback projections, recovery, action admission, and release. The Offscreen document SHALL own only the WebRTC transport proxy and `RTCPeerConnection`; it SHALL own no logical Room, Session, Page callback, or domain lifecycle state.

On Firefox MV2, the persistent Background Page/HTML SHALL own both the logical Runtime and `RTCPeerConnection` in the same document. Firefox SHALL have no Offscreen document, Offscreen-fresh branch, or independent transport-host callback restart.

#### Scenario: Chromium Offscreen restart preserves logical ownership

- **GIVEN** the Chromium Background and its Page callback bindings remain current
- **WHEN** only the Offscreen document is replaced
- **THEN** only transport ownership SHALL be replaced, logical Runtime and Page callback ownership SHALL remain in Background, old transport generations SHALL become stale, and `onSessionsChange` SHALL not rebind solely because Offscreen was fresh

#### Scenario: Firefox has no Offscreen branch

- **GIVEN** Firefox MV2 loads its persistent Background document
- **WHEN** it creates or reuses a target peer connection
- **THEN** that same document SHALL own logical Runtime and WebRTC, with no Offscreen creation, probe, transport-host restart, or `ensureTransport` branch

### Requirement: Fresh Background restores exact browser truth

A fresh Chromium Background SHALL treat any session storage as provisional hints only. It SHALL validate tabs, URLs, navigation, sender identity, and page ownership against current browser facts before promoting an exact binding. It SHALL establish a new logical Runtime host identity without replaying an old action or trusting an old callback closure.

Page registration SHALL be the sole coordinator entry that starts or reuses Background and returns the current `RuntimeSnapshot`. `RuntimeSnapshot.hostId` and `RuntimeSnapshot.hostPhase` SHALL be the sole host identity and status authority. The coordinator SHALL NOT expose a separate `ensureHost` RPC, coordinator phase, or coordinator generation. A Page binding SHALL NOT retain a nominal generation that has no consumer; exact binding identity and the Sessions callback generation SHALL remain the currentness fences at their respective boundaries.

Recovery of all live domains SHALL remain a non-blocking side branch. The current Page action SHALL wait only for its own target-domain Chat, Session, or History readiness fence.

#### Scenario: Current action does not wait for unrelated recovery

- **GIVEN** Background fresh boot discovered several provisional live domains
- **WHEN** one exact Page RPC needs only its target domain
- **THEN** Background SHALL validate and restore that exact caller and target readiness without waiting for unrelated domains, while other provisional Pages and domains recover asynchronously

#### Scenario: Registration returns one host authority

- **GIVEN** a Page reaches a missing, fresh, or current Background
- **WHEN** it performs its ordinary registration
- **THEN** that registration SHALL start or reuse Background and return one current Runtime snapshot
- **AND** no separate host-start RPC, duplicate phase, constant coordinator generation, or write-only binding generation SHALL participate in readiness or replacement decisions

### Requirement: Background and Offscreen callback pairs restart transparently

Each existing Background/Offscreen provider method and callback SHALL remain a transparent one-to-one pair. When both endpoints are current, the existing pair SHALL remain current. When either endpoint is fresh, Background SHALL re-execute each affected existing registration method with a new callback; the Offscreen method SHALL atomically replace only its matching callback and return its matching current transport state in the same call. Background SHALL align returned current state before later events from that callback are accepted.

Abstract diagram names such as `onXXXA(callbackA)` and `onXXXXB(callbackB)` SHALL NOT require a new API or adapter. Callback restart SHALL add no callback sequencing protocol, ACK, queue, ledger, receipt, payload persistence, replay, or deadline protocol. An expired old callback payload SHALL be discarded.

The five Offscreen callback lanes SHALL share one Runtime-private transport admission epoch. Rebinding SHALL drain every join admitted by the preceding epoch, then perform the final empty-admission observation, complete current Room projection capture, and successor-epoch publication in one synchronous service operation with no `await` or re-entry point between those facts. A join from an expired facade SHALL fail its epoch check before physical provider join or commit. This epoch SHALL NOT enter an application-facing port, peer protocol, callback protocol, acknowledgement, queue, or compatibility path.

#### Scenario: All endpoint restart combinations converge

- **GIVEN** one of Background fresh + Offscreen surviving, Background surviving + Offscreen fresh, both fresh, or both current
- **WHEN** Runtime and transport readiness converge
- **THEN** each affected one-to-one callback pair SHALL either be retained when both endpoints are current or replaced with current-state return when an endpoint is fresh, and only later events on the current pair SHALL mutate Background state

#### Scenario: Old callback payload is not replayed

- **GIVEN** an Offscreen event targeted a callback closure owned by an expired Background generation
- **WHEN** a new Background restores its callback pairs
- **THEN** the old payload SHALL NOT be persisted, queued, replayed, acknowledged, or applied, and only a later event delivered through the new current callback MAY be processed

#### Scenario: Projection and admission epoch publish at one cut

- **GIVEN** a fresh Background rebinds while an old facade may still attempt a transport join
- **WHEN** all joins admitted before the rebind cut have settled
- **THEN** Offscreen SHALL synchronously observe no remaining old admission, capture the complete current Room projection, and publish the successor epoch as one operation
- **AND** any later old-epoch join SHALL fail before physical provider work or Room commit, while all pre-cut committed Rooms SHALL appear in the returned projection

### Requirement: World recovery is obligation-scoped and generation-fenced

Physical World peer membership SHALL be treated as a transport observation, not proof that a corresponding logical World recovery fact has been committed. `worldRecovery.members` MAY therefore contain fewer entries than the current physical peer map. Rebind SHALL validate every existing recovery entry by exact `sourcePeerId + sourceGeneration`; it SHALL NOT require physical and logical collections to have equal cardinality, infer missing World recovery from an adjacent ROOM obligation, or synthesize recovery for an uncommitted physical peer. A missing recovery snapshot SHALL fail closed only when an explicit obligation exists in that same recovery domain.

A duplicate join observation for an already-active World peer SHALL be idempotent and SHALL NOT advance its source generation. An explicit leave SHALL end that active membership; a later join with the same peer ID SHALL advance the generation and make recovery from the previous generation stale.

#### Scenario: Physical membership does not imply logical recovery

- **GIVEN** the surviving transport observes current World peers A and B, but only A has an owner-confirmed committed recovery entry
- **WHEN** a fresh logical Runtime rebinds to that transport
- **THEN** rebind SHALL validate and restore A, SHALL NOT invent recovery for B, and SHALL NOT reject merely because the physical and logical member counts differ

#### Scenario: Duplicate active join preserves committed recovery

- **GIVEN** an active World peer has a current committed recovery entry bound to its peer ID and generation
- **WHEN** the provider reports another join for that same peer without an intervening leave
- **THEN** the join SHALL retain the current generation and the committed recovery entry SHALL remain current

#### Scenario: Explicit leave and same-ID rejoin invalidate old recovery

- **GIVEN** a World recovery entry is bound to the current generation of an active peer
- **WHEN** that peer explicitly leaves and later joins again with the same peer ID
- **THEN** the new membership SHALL use the next generation and recovery bound to the old generation SHALL fail closed as stale

### Requirement: onSessionsChange is immediate initial load and exact rebind

A new Page SHALL call the existing `runtime.onSessionsChange(callback)` method as both subscription and initial load. After a fresh Background invalidates old callback IDs, it SHALL send `runtime:sessions-rebind` to each exact restored provisional Page, and each Page SHALL re-execute the same method with a new callback. An Offscreen-only replacement SHALL NOT trigger this rebind.

Background SHALL atomically replace the exact Page callback, linearize current full Sessions, immediately invoke the new callback with that full state, wait for the existing callback call to complete, and revalidate the exact binding. Only a still-current binding SHALL activate the callback for later ordered deltas. A failed callback call or binding drift SHALL retire the provisional binding. Other provisional Pages SHALL rebind asynchronously without blocking the current caller. The lifecycle SHALL add no separate initial-load query, snapshot RPC, or readiness ACK.

Inbound, Sessions, World, Runtime-error, and History-feedback callback delivery SHALL capture the exact listener or Sessions generation that it invokes. A rejected callback SHALL remove the Page only if that captured binding remains current. A rejection from an old callback that was replaced while pending SHALL NOT remove the replacement, its current Sessions generation, or action admission owned by that replacement.

#### Scenario: First bind immediately loads current Sessions

- **GIVEN** a new exact Page has no current Sessions callback
- **WHEN** it calls `runtime.onSessionsChange(callback)`
- **THEN** Background SHALL register that callback, immediately invoke it once with current full Sessions, complete and revalidate the exact binding, and only then activate later ordered deltas without a separate load request

#### Scenario: Fresh Background rebinds the exact caller

- **GIVEN** a current Page reaches a fresh Background with an expired old callback ID
- **WHEN** it receives `runtime:sessions-rebind` and re-executes `runtime.onSessionsChange(newCallback)`
- **THEN** Background SHALL replace that exact callback, immediately deliver current full Sessions, wait for call completion, revalidate the binding, activate the callback, and only then admit later ordered deltas and target-domain readiness

#### Scenario: Binding drift rejects activation

- **GIVEN** a Page callback bind or rebind is receiving current full Sessions
- **WHEN** tab, navigation, page owner, or exact binding identity changes before callback completion
- **THEN** Background SHALL not activate that callback or execute the pending action and SHALL retire the stale binding through the existing rejection/detach path

#### Scenario: Stale callback rejection preserves the replacement

- **GIVEN** an old Page callback invocation remains pending
- **WHEN** the same Page installs a current replacement and the old invocation later rejects
- **THEN** Background SHALL retain the exact replacement and its current Sessions generation
- **AND** only a rejection from the still-current captured binding MAY retire that Page

### Requirement: Accepted actions execute once after target-scoped readiness

Background SHALL validate exact sender tab, navigation, page owner, current callback state, and logical Runtime host identity before admitting a Page RPC. It SHALL wait only for the current action's target-domain readiness. Chromium SHALL command Offscreen to create or reuse the target `RTCPeerConnection`; Firefox SHALL do so directly. The command result SHALL carry exact handle/readiness and SHALL NOT be represented as an asynchronous provider event.

After readiness, the gateway SHALL accept and execute the original current RPC invocation exactly once. It SHALL NOT replay an accepted invocation. A caller timeout after admission SHALL remain an ambiguous result for explicit caller handling and SHALL NOT authorize automatic replay of a non-idempotent mutation.

#### Scenario: Accepted mutation is not replayed

- **GIVEN** a current exact RPC has passed binding, callback, transport, and target-domain readiness
- **WHEN** Background accepts it and the caller later times out before observing completion
- **THEN** the original action SHALL have at most one admitted execution, the gateway SHALL not replay it, and any later retry SHALL require a new explicit caller invocation

### Requirement: Release is fenced to the exact old generation

Tab close, navigation, URL change, or failed provisional callback registration SHALL remove the exact binding. When that leaves a domain with zero live Pages, Background SHALL create one five-second grace token bound to the exact logical Room and connection generation. A successor admission SHALL invalidate the old token. At the deadline, only a token that remains current while the domain remains zero-page SHALL release its exact old Room or connection handle. Late close work SHALL NOT close a successor connection.

#### Scenario: Successor admission defeats late release

- **GIVEN** a zero-page grace token owns an old Room and connection generation
- **WHEN** a successor Page is admitted before the deadline or a late close settles afterward
- **THEN** the old token SHALL be invalid, the successor Room SHALL remain current, and any release or late close SHALL target only the exact old handle

### Requirement: Steady-state recovery has no Page polling

The Page SHALL have no periodic Runtime recovery or health polling. Page RPC and Offscreen provider callback delivery SHALL remain authoritative wake entries for a suspended Chromium Background. Background's existing best-effort five-second reconcile MAY run only while that worker survives. The existing comctx five-second heartbeat SHALL mean only active injector `APPLY` provider readiness and SHALL NOT diagnose callback delivery, trigger reconcile, wait on reconcile, or create a Page wake loop.

This lifecycle SHALL add no extra heartbeat, Page timer, gateway replay, callback payload replay, ACK, queue, ledger, receipt, or outbox.

#### Scenario: Suspended Background waits for a real browser event

- **GIVEN** Chromium suspended the Background Service Worker and no Page RPC or Offscreen provider event occurs
- **WHEN** time passes
- **THEN** no Page periodic timer, heartbeat extension, or hidden recovery loop SHALL wake Background, and the next real Page RPC or Offscreen event SHALL be the authoritative recovery entry
