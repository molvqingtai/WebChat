## MODIFIED Requirements

### Requirement: Headless Runtime owns history orchestration

`HistoryDomain` SHALL own the complete exact-difference synchronization around the application/page Domain's origin store. Each accepted source incarnation SHALL start exactly one outgoing requester synchronization and SHALL admit at most one incoming provider synchronization, using independent `syncId` values. The outgoing ID SHALL bind when the connection is accepted; the first strict valid incoming request page zero SHALL bind the provider ID. A requester SHALL freeze its own cutoff at `requester wall clock - 180 days` (`HISTORY_WINDOW_DAYS = 180`), obtain one fixed snapshot of eligible canonical Chat record IDs, and stream that inventory as continuous request pages. A provider SHALL accept only request pages starting at zero, wait for the complete `done: true` inventory, freeze its own `provider wall clock - 180 days` cutoff and one eligible canonical Chat-record snapshot, treat the received IDs as a set, and stream only snapshot records absent from that set as continuous response pages in canonical recent-first order. A response exactly at the requester cutoff SHALL remain eligible; only an earlier response SHALL be rejected locally. The two cutoffs SHALL not be transmitted or required to match.

Each request and response phase SHALL have no cumulative entry or canonical-content budget beyond the public per-frame and per-page limits; every non-final page SHALL contain at least one entry. The one explicit empty phase representation SHALL be `page: 0, done: true` with an empty inventory or empty response. Page numbers SHALL be continuous within each phase. Each directional synchronization SHALL use a fixed 10-second operational timeout at its established arm points with complete-identity fencing; accepted progress SHALL NOT re-arm or replace the timer. While active, an identical replay of the current expected/already-applied page SHALL be idempotent; a changed replay, gap, out-of-order page, response before complete inventory, page after `done`, or invalid source/session binding SHALL terminate only that synchronization without partial page application. No History peer acknowledgement, cursor, body request, provider receipt, or remote-persistence state SHALL exist.

The provider SHALL stream response pages only after the full inventory is accepted, but SHALL not wait for or infer remote processing between pages; each local `room.send()` settlement remains only local acceptance. The provider SHALL construct each page's exact author set. The receiver SHALL admit each response page atomically, trust the schema-accepted typed `messages` and `users` without a uniqueness/reference validation stage, and process them through one bounded serial local queue before `insert-if-absent`; concurrent live, peer, or same-domain-page races SHALL therefore converge without overwrite. A final response page completes the requester attempt only after that page's complete local processing settles.

Working State SHALL be scoped by current domain, source incarnation, direction, generation, `syncId`, and unique local token. Completion, transport departure, timeout, invalid input, local supplier failure, local processing failure, or lifecycle cleanup SHALL discard snapshots, pages, queues, and feedback ownership but SHALL retain exactly the bound `syncId` plus one terminal bit for that source incarnation and direction. Once terminal, neither the same nor a different ID SHALL start another synchronization on that connection. No automatic, delayed, or event-driven retry SHALL exist. Source replacement or domain release SHALL clear all working and terminal bindings for that source/domain. A later connection SHALL generate a fresh `syncId`, read current storage, and start one independent synchronization with no resumed page, snapshot, cursor, retry count, or other prior progress. Any previously uninserted response record is eligible only because the new connection computes from current storage, not because History retained recovery State.

The Runtime page contract SHALL retain explicit `{supplyId}` request/cancel ownership plus bounded resolve/reject settlement for each local snapshot query. Each selected page query SHALL receive an `AbortSignal` wired through its readonly IndexedDB transaction and subsequent projection/filter/sort work, and physical settlement SHALL precede failover, old-job release, or successor promotion. Supplier failover MAY continue the same active synchronization but SHALL NOT allocate a second synchronization or reset its terminal binding. Supplier work SHALL remain serial per source, isolated across domains and sources, and admitted through one pipeline covering selection, snapshot projection, encode, send, and final release, with at most four active jobs, 32 admitted requests, and 8KiB of decoded request metadata. A newly joined replacement source arriving before old physical settlement SHALL occupy at most one dormant source-local successor inside those same bounds, use its connection's fresh `syncId`, run no old synchronization concurrently, and promote automatically only after old settlement; that promotion executes the synchronization already triggered by the new connection and is not a retry.

#### Scenario: Frozen local history policy

- **WHEN** a directional History sync begins and its request inventory or missing-record response continues
- **THEN** the requester SHALL retain one fixed 180-day cutoff and ID snapshot through all request pages, the provider SHALL wait for the final inventory page and then retain one separate fixed 180-day cutoff and record snapshot through all response pages, the requester SHALL independently reject only response records earlier than its cutoff, and neither side SHALL transmit or compare cutoffs

#### Scenario: Scoped timeout ownership

- **WHEN** an old requester/provider timeout fires after a replacement domain, source generation, token, or `syncId` has started
- **THEN** the Runtime SHALL require the complete current attempt identity before canceling State or dismissing feedback, so the replacement attempt remains unchanged

#### Scenario: Terminal synchronization cannot restart within one connection

- **GIVEN** one source incarnation and direction has completed, canceled, or failed its bound History synchronization
- **WHEN** a repeated SESSION, timer, late page, replayed page zero, or page with another `syncId` arrives before source replacement or domain release
- **THEN** History SHALL retain only the original ID and terminal bit, start no synchronization, allocate no snapshot or queue, and publish no History feedback

#### Scenario: Domain release clears directional bindings

- **WHEN** the domain is released or the source incarnation is replaced after its physical work settles
- **THEN** History SHALL clear every outgoing and incoming working or terminal binding for that released lifecycle, while a later room connection starts exactly one independent synchronization per direction

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

- **WHEN** a newly joined replacement source has triggered its one History synchronization while the prior source's local snapshot job is unsettled
- **THEN** the Runtime SHALL admit at most one dormant source-local successor within the global bounds, assign the new connection a fresh `syncId`, SHALL NOT run it concurrently, and SHALL start it after old physical settlement without reviving or retrying old synchronization State

#### Scenario: One end-to-end concurrency boundary

- **WHEN** supplier selection, snapshot projection, filtering, encoding, or History page sending remains active for an admitted job
- **THEN** every stage SHALL retain the same job admission and no more than four jobs SHALL be active across the complete local supplier-to-send pipeline

#### Scenario: Completed provider releases its source slot

- **WHEN** a provider's final `done: true` response page settles locally and the same source immediately begins another domain's work
- **THEN** the completed provider SHALL release its source slot after that local send settlement without waiting for remote receipt, processing, persistence, or acknowledgement, and old timeout/token work SHALL have no authority over the newer attempt

#### Scenario: History application has no UI side effects

- **WHEN** valid missing History records reach an application/page Domain
- **THEN** records SHALL be inserted-if-absent without notifications, boolean unread-attention marks, or system notices; only the separately specified History loading Toast MAY reflect actual insertion and local attempt lifetime
