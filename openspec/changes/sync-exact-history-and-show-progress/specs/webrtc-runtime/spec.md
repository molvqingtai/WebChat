## ADDED Requirements

### Requirement: History synchronization owns truthful loading feedback

Each current incoming History synchronization SHALL own at most one loading Toast identity scoped to that exact domain, source, generation, and `syncId`. Receiving a request, sending a response, receiving an empty response page, and processing only records that already exist SHALL publish no History loading feedback. As soon as the first serial `insert-if-absent` result settles as an actual insertion of one canonical History record, the synchronization SHALL activate its Toast exactly once with loading kind, exact copy `Syncing message history...`, and no visible count. That activation SHALL project to every current page attached to the same domain, including a page that attaches while the owner remains active; no other domain SHALL receive it.

The Toast SHALL have no fixed duration or minimum dwell. After activation it SHALL remain loading until the final `done: true` response page completes local processing or the owning attempt is canceled. That terminal transition SHALL actively dismiss only the same synchronization's Toast from every current same-domain page without success copy or conversion. Later pages and replay SHALL not reactivate or extend it. An attempt that inserts no record SHALL never create it. Termination of one synchronization SHALL not dismiss another synchronization's or unrelated feature's Toast.

History feedback SHALL describe only the receiver's current local synchronization work. It SHALL NOT confirm or infer the remote peer's online, receipt, handler, or persistence state. A remote no-result, gap, timeout, departure, or cancellation SHALL create no History success or error Toast. A distinct real local failure MAY still use the existing generic error-feedback contract independently; History cancellation and loading dismissal SHALL not suppress, rewrite, or own that error.

#### Scenario: First actual insertion starts one loading Toast

- **WHEN** the first serial `insert-if-absent` result settles as `inserted` for a `syncId` that has not yet activated feedback
- **THEN** exactly one loading Toast owner with copy `Syncing message history...` and no count SHALL activate for that synchronization, project to every current same-domain page, and have no fixed expiry

#### Scenario: Empty and all-existing work stays silent

- **WHEN** a response page is empty or every attempted insert retains an existing canonical record because of replay, live delivery, another peer, or another same-domain page
- **THEN** that page SHALL create no History loading Toast and SHALL not mark the `syncId` as having displayed one

#### Scenario: Completion actively dismisses only its owner

- **GIVEN** one History loading Toast is active
- **WHEN** that `syncId`'s final `done: true` response page finishes local processing
- **THEN** the application SHALL immediately dismiss only that synchronization's Toast with no success conversion, count, duration wait, or effect on another Toast

#### Scenario: Cancellation cannot leave loading stuck

- **GIVEN** one History loading Toast is active
- **WHEN** its attempt is canceled by transport departure, timeout, invalid order, invalid replay, local processing failure, generation replacement, or lifecycle cleanup
- **THEN** the application SHALL immediately dismiss only that Toast, publish no History-specific success or error, and ignore any late terminal work from the canceled owner

#### Scenario: Later pages do not repeat feedback

- **GIVEN** one `syncId` has already activated its History loading Toast
- **WHEN** later pages insert more records or an identical page replays
- **THEN** no second History Toast SHALL publish and the existing owner SHALL remain unchanged until that synchronization terminates

#### Scenario: Same-domain pages share the current loading owner

- **GIVEN** a History loading owner is active for one domain
- **WHEN** another page of that domain is already attached or attaches before the owner terminates
- **THEN** that page SHALL project the same loading copy and terminal dismissal, while pages of every other domain remain unchanged

## MODIFIED Requirements

### Requirement: Runtime Chat session lifecycle

The headless Runtime SHALL bind each Chat source to a session identity and logical generation. A join SHALL send strict `session {sessionId, user, presenceId, joinedAt}` before live text, reaction, or History traffic. `joinedAt` SHALL be allocated and persisted by Session with a new local logical generation, projected unchanged to wire, and remain unchanged with its `presenceId` across physical session replacement. It SHALL NOT be synthesized from receiver observation, discovery order, `baselinePeerIds`, or `clock.now()`. A bound `sessionId` SHALL not change its `user.id`; an accepted `presenceId` SHALL not change its bound `user.id` or `joinedAt`; live event `userId` SHALL match the transport-bound session user. `name` and `avatar` SHALL remain mutable projection fields: a SESSION for the same accepted identity binding SHALL update that current projection across attached pages without changing logical membership or notices. A new physical incarnation SHALL retire the old source binding and both directional History attempt states, then SHALL start exactly one fresh outgoing inventory synchronization with a new `syncId` for the replacement without running it concurrently with unsettled old source work. Reconnect of the same logical generation SHALL not become a new observer join.

#### Scenario: Session binding and replacement

- **WHEN** a source joins Chat, republishes a bound logical generation, sends changed `user.id` or logical time for an accepted generation, or reconnects with a new physical incarnation
- **THEN** the Runtime SHALL require the session message first, reject a `user.id` change for the same `sessionId`, reject a `user.id` or `joinedAt` change for the same accepted `presenceId`, reject live events whose `userId` does not match the bound user, retire the old source binding and History attempt states for a new incarnation, and start exactly one fresh inventory synchronization with a new `syncId`

#### Scenario: Same logical presence refreshes its user projection

- **GIVEN** a source and `presenceId` retain the same `user.id` and `joinedAt`
- **WHEN** a later accepted SESSION changes `name` or `avatar`, or repeats the current values
- **THEN** every attached same-domain page SHALL converge to the current projection idempotently without changing membership count, allocating a generation, emitting a chat/History event, or emitting a join/leave notice

#### Scenario: Future HLC does not advance Runtime clock

- **WHEN** the Runtime receives a wire event rejected because its HLC is more than five minutes ahead of the explicit receiver `now`
- **THEN** it SHALL reject the event, leave the central HLC clock unchanged, and continue processing later valid events

### Requirement: Headless Runtime owns history orchestration

`HistoryDomain` SHALL own the complete exact-difference synchronization around the application/page Domain's origin store. Each source MAY run one outgoing requester attempt and one incoming provider attempt with independent `syncId` values. A requester SHALL freeze its own cutoff at `requester wall clock - 180 days` (`HISTORY_WINDOW_DAYS = 180`), obtain one fixed snapshot of eligible canonical Chat record IDs, and stream that inventory as continuous request pages. A provider SHALL accept only request pages starting at zero, wait for the complete `done: true` inventory, freeze its own `provider wall clock - 180 days` cutoff and one eligible canonical Chat-record snapshot, treat the received IDs as a set, and stream only snapshot records absent from that set as continuous response pages in canonical recent-first order. A response exactly at the requester cutoff SHALL remain eligible; only an earlier response SHALL be rejected locally. The two cutoffs SHALL not be transmitted or required to match.

Each request and response phase SHALL accept no more than 10,000 entries and 8MiB of bounded canonical content in addition to the public per-frame limits; every non-final page SHALL contain at least one entry, so page count is bounded by the same entry budget. The one explicit empty phase representation SHALL be `page: 0, done: true` with an empty inventory or empty response. Page numbers SHALL be continuous within each phase. Each directional attempt SHALL retain the existing 10-second operational timeout scoped to its complete attempt identity. An identical replay of the current expected/already-applied page SHALL be idempotent; a changed replay, gap, out-of-order page, response before complete inventory, page after `done`, invalid source/session binding, or exceeded budget SHALL cancel only that attempt without partial page application. No History peer acknowledgement, cursor, body request, provider receipt, or remote-persistence state SHALL exist.

The provider SHALL stream response pages only after the full inventory is accepted, but SHALL not wait for or infer remote processing between pages; each local `room.send()` settlement remains only local acceptance. The receiver SHALL admit each response page atomically and process accepted pages through one bounded serial local queue. It SHALL construct each complete `ChatMessageRecord` from the page's `messages` and exact referenced `users`, then perform `insert-if-absent`; concurrent live, peer, or same-domain-page races SHALL therefore converge without overwrite. A final response page completes the requester attempt only after that page's complete local processing settles.

Attempt State SHALL be scoped by current domain, source, direction, generation, `syncId`, and unique local token. Transport departure, source replacement, timeout, local supplier failure, local processing failure, or lifecycle cleanup SHALL discard all attempt snapshots, pages, queues, and feedback ownership. Reconnect SHALL create a fresh `syncId`, re-read the current 180-day inventory, and recompute the difference; no cross-disconnect continuation, persisted cursor, fallback, or compatibility state SHALL exist. Any response record not yet inserted before cancellation therefore remains absent from the next inventory and is naturally eligible again.

The Runtime page contract SHALL retain explicit `{supplyId}` request/cancel ownership plus bounded resolve/reject settlement for each local snapshot query. Each selected page query SHALL receive an `AbortSignal` wired through its readonly IndexedDB transaction and subsequent projection/filter/sort work, and physical settlement SHALL precede failover, old-job release, or successor promotion. Supplier work SHALL remain serial per source, isolated across domains and sources, and admitted through one pipeline covering selection, snapshot projection, encode, send, and final release, with at most four active jobs, 32 admitted requests, and 8KiB of decoded request metadata. A replacement source arriving before old physical settlement SHALL occupy at most one dormant source-local successor inside those same bounds, use a fresh `syncId`, run no old attempt concurrently, and promote automatically only after old settlement.

#### Scenario: Frozen local history policy

- **WHEN** a directional History sync begins and its request inventory or missing-record response continues
- **THEN** the requester SHALL retain one fixed 180-day cutoff and ID snapshot through all request pages, the provider SHALL wait for the final inventory page and then retain one separate fixed 180-day cutoff and record snapshot through all response pages, the requester SHALL independently reject only response records earlier than its cutoff, and neither side SHALL transmit or compare cutoffs

#### Scenario: Scoped timeout ownership

- **WHEN** an old requester/provider timeout fires after a replacement domain, source generation, token, or `syncId` has started
- **THEN** the Runtime SHALL require the complete current attempt identity before canceling State or dismissing feedback, so the replacement attempt remains unchanged

#### Scenario: Supplier isolation across domains and sources

- **WHEN** a peer leaves domain A while domain B is waiting on a local snapshot supplier, or source A's supplier is hung while source B needs an inventory or provider snapshot
- **THEN** only the invalidated domain/source work SHALL be removed; eligible domain B and source B work SHALL continue within the bounded cross-source concurrency pool

#### Scenario: Physical cancellation settlement

- **WHEN** a selected page snapshot attempt reaches its five-second boundary and the Runtime cancels its `supplyId`
- **THEN** the page SHALL use the `AbortSignal` to abort its readonly IndexedDB transaction and gate subsequent projection/filter/sort work, and SHALL confirm only after all physical work exits; failover, old-job release, and successor promotion SHALL wait for that confirmation

#### Scenario: Bounded provider admission

- **WHEN** inventory/provider snapshot or response work is queued or active and cleanup, rejoin, or replacement occurs
- **THEN** started jobs SHALL remain counted until final settlement, dormant successors SHALL be included in the same global counts and removed without starting, and admission SHALL never exceed four active jobs, 32 requests, or 8KiB of decoded request metadata; excess work SHALL cancel source-locally without room reconnect

#### Scenario: Replacement request continues after prior settlement

- **WHEN** a replacement source needs a fresh History attempt while the prior source's local snapshot job is unsettled
- **THEN** the Runtime SHALL admit at most one dormant source-local successor within the global bounds, assign it a fresh `syncId`, SHALL NOT run it concurrently, and SHALL automatically start its fresh inventory after old physical settlement without reviving old attempt State

#### Scenario: One end-to-end concurrency boundary

- **WHEN** supplier selection, snapshot projection, filtering, encoding, or History page sending remains active for an admitted job
- **THEN** every stage SHALL retain the same job admission and no more than four jobs SHALL be active across the complete local supplier-to-send pipeline

#### Scenario: Completed provider releases its source slot

- **WHEN** a provider's final `done: true` response page settles locally and the same source immediately begins another domain's work
- **THEN** the completed provider SHALL release its source slot after that local send settlement without waiting for remote receipt, processing, persistence, or acknowledgement, and old timeout/token work SHALL have no authority over the newer attempt

#### Scenario: History application has no UI side effects

- **WHEN** valid missing History records reach an application/page Domain
- **THEN** records SHALL be inserted-if-absent without notifications, boolean unread-attention marks, or system notices; only the separately specified History loading Toast MAY reflect actual insertion and local attempt lifetime

### Requirement: Event sequence and un-ACK buffer

`DeliveryDomain` SHALL maintain a short-term per-domain event sequence and volatile inbound un-ACK delivery buffer bounded to 512 records and 8MiB. An event SHALL be cleared once at least one page acknowledges durable persistence. One `history-messages-response` page SHALL be admitted atomically or rejected as a whole when it would exceed either bound; rejection SHALL apply none of that page, SHALL cancel the local History attempt, and SHALL not emit a peer acknowledgement or ask the provider for another page. A page that reconnects within the same current domain lifecycle SHALL be re-sent unacknowledged inbound events by sequence. Events still unacknowledged when the domain's grace period ends SHALL be discarded. Loss of the buffer when the browser kills the Runtime is an accepted boundary. This local delivery ACK and buffer SHALL NOT become a History peer message, outbound outbox, remote delivery confirmation, or cross-disconnect History recovery mechanism.

#### Scenario: ACK clears buffer

- **WHEN** at least one page of the domain acknowledges durable storage or confirmed canonical existence of an event
- **THEN** the Runtime SHALL remove that event from the local un-ACK buffer without sending a History acknowledgement to any peer

#### Scenario: Reconnect resend

- **WHEN** a page reconnects within the grace period of the same current domain lifecycle
- **THEN** the Runtime SHALL re-deliver buffered events by sequence so the page can persist them idempotently without repeating per-`syncId` History feedback

#### Scenario: Grace-expiry discard

- **WHEN** the domain's five-second grace ends with unacknowledged events
- **THEN** the Runtime SHALL discard those events, cancel their local attempt ownership, dismiss any owned History loading Toast, and accept the documented loss boundary

#### Scenario: Atomic history batch admission

- **WHEN** a `history-messages-response` page would exceed 512 records or 8MiB in the volatile un-ACK buffer
- **THEN** the Runtime SHALL reject the whole page, preserve existing records, cancel only that History attempt, and SHALL send no peer acknowledgement or continuation request

### Requirement: Runtime facts have exactly one writable Domain owner

The shared Runtime SHALL split writable authority exactly by responsibility:

- `LifecycleDomain` SHALL uniquely own page leases, per-domain reference counts, the unified five-second grace phase/deadline, and domain-release identity.
- `ConnectionDomain` SHALL uniquely own join, leave, reconnect, recovery attempts, physical-acceptance phase, and current host/domain generation.
- `SessionDomain` SHALL uniquely own committed local/remote Chat sessions, the full committed session snapshot, session incarnation, and central id/HLC allocation State.
- `WorldDomain` SHALL uniquely own the active-domain registry, local World session/snapshot, remote per-source presence snapshots, and derived World presence.
- `HistoryDomain` SHALL uniquely own directional `syncId` attempts, fixed requester inventories, fixed provider snapshots, page progression/fingerprints, cutoffs, budgets, supply ids, serial response processing, timeout identities, and History loading ownership.
- `DeliveryDomain` SHALL uniquely own per-domain inbound sequence, volatile un-ACK buffer, byte/event admission, History response-page membership, replay, and local ACK completion.
- `WireDomain` SHALL uniquely own trusted room/source membership, provider-ready peer facts, per-room send serialization, per-source decode queues/drop bounds, immutable protocol translation, and provider callback translation.

The application/page Domain SHALL remain the unique owner of retained input, origin records, actual insert results, and UI projections. The comctx Server SHALL only construct the graph and adapt request/reply/subscription registration. Mutable Server maps, a catch-all `NetworkDomain`, generic lock controllers, and direct cross-Domain State imports/writes SHALL NOT own any fact listed above.

The Domain dependency graph SHALL be acyclic. Connection MAY consume Lifecycle, Wire, Session, World, and History; Session MAY consume Wire and Delivery; World MAY consume Wire; History MAY consume Wire, Delivery, and Session; Delivery MAY consume Lifecycle; Wire SHALL consume only the immutable public protocol and Runtime-private provider Extern. The resulting chain `Connection -> History -> Session -> Delivery -> Lifecycle`, together with the allowed edges toward Wire, SHALL remain acyclic. Session SHALL use Delivery only through one admit Command after Session-owned live source/user validation. History SHALL use Session only through a Query that verifies the current trusted `(room/domain, source)` binding before History-owned requester/provider transitions. A Domain SHALL consume another Domain only through its Queries, Commands, and Events.

#### Scenario: Owner matrix has no duplicate writer

- **WHEN** each lease, grace, connection generation, committed session/HLC, World presence, directional History attempt/snapshot/page, delivery sequence/buffer, and trusted wire/provider fact is traced
- **THEN** exactly one listed Domain SHALL define its writable State and transitions, while every other consumer uses that owner's CQRS surface

#### Scenario: Runtime graph remains acyclic

- **WHEN** Runtime Domain imports and `domain.getDomain(...)` dependencies are inspected
- **THEN** they SHALL follow the documented direction, contain no cycle, and expose no direct import or mutation of another Domain's State definition

#### Scenario: Server owns no network truth

- **WHEN** the comctx Server and host composition are inspected
- **THEN** they SHALL contain only graph construction, Extern injection, and request/reply/subscription adaptation, with no authoritative session, generation, presence, History, delivery, feedback, or trusted-room map
