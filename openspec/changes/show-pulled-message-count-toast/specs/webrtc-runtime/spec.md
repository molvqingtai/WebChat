## MODIFIED Requirements

### Requirement: Headless Runtime owns history orchestration

`HistoryDomain` SHALL own history synchronization policy around the application/page Domain's origin store. At each sync start, it SHALL freeze the receiver/requester's own `requester cutoff = requester wall clock - 180 days` (`HISTORY_WINDOW_DAYS = 180`). A remote response message exactly at that requester cutoff SHALL be eligible; only an earlier remote response message SHALL be rejected. At its corresponding provider supply/session admission, the selected provider SHALL separately freeze its own `provider cutoff = provider wall clock - 180 days`. A local candidate exactly at that provider cutoff SHALL be eligible, and only earlier local candidates SHALL be excluded without deletion; its local query, subsequent cursor, and local page failover SHALL retain that provider cutoff without re-reading time. A dormant successor SHALL freeze its own provider cutoff at its own admission and SHALL retain it after promotion. The cutoffs SHALL NOT be transmitted or required to match. The requester SHALL independently validate every response against its own cutoff and has final acceptance authority, so a remote provider SHALL NOT expand the requester window, although clock skew MAY omit boundary candidates that the requester would otherwise accept. The requester cutoff SHALL remain unchanged through that sync's pagination, retry, and provider failover. `HistoryDomain` SHALL enforce at most one outstanding request per source with a 10-second operational timeout, and stop a session at 8MiB or 10,000 messages while preserving the most recent accepted responses and never falsely claiming provider completion. `HistoryDomain` SHALL select one application/page supplier per request, keep requester/provider State scoped by `(sourcePeerId, domain, syncId, unique sync token)`, and SHALL not store a history copy or read-model replica. The public protocol remains responsible only for validating the typed history request/response shape, cursor, response-size limit, and user/message references.

The Runtime page contract SHALL use an explicit `{supplyId}` request/cancel event plus `resolveHistorySupply`/`rejectHistorySupply` RPC. Each page supply attempt SHALL have a 5-second boundary. A page query SHALL receive an `AbortSignal` wired to its readonly IndexedDB transaction; the signal SHALL abort that transaction and gate all subsequent projection/filter/sort work, and the page SHALL confirm physical settlement only after the entire query and gated work truly exits. Failover, old-job release, and successor promotion SHALL wait for that confirmation. Supplier work SHALL be serial per source, isolated across domains and sources, and admitted through one pipeline covering supplier selection, encode, send, and final release; the pipeline SHALL have at most four active jobs, 32 admitted requests, and 8KiB of decoded request metadata. A replacement session's one-shot request arriving before the old source job settles SHALL occupy one dormant source-local successor within the same global admission; the successor itself SHALL count toward the 32-request and 8KiB decoded-metadata limits, SHALL NOT run concurrently, and SHALL automatically promote after physical settlement without another peer request. Timeout, leave, and release MAY remove an unstarted successor; a started job SHALL remain counted until settlement. A completed response releases its source slot immediately after send settlement, and an old timer/token SHALL NOT delay or close a newer domain/request. Cleanup SHALL retain active admission until physical settlement and remove dormant successors without starting them.

After one valid history-response batch settles its application/page insert-if-absent work, that boundary SHALL count only messages newly inserted into the current origin store by that batch. If `count > 0`, it SHALL publish one generic loading Toast with exact copy `Pulled {count} new messages.` and exact `3000ms` duration. The template SHALL remain unchanged for every positive integer. The Toast SHALL NOT publish when a request starts, while waiting, when no response arrives, or when the batch adds zero messages. Existing same-id replay, retained conflicts, invalid values, and rejected values SHALL contribute zero.

Every qualifying batch SHALL publish independently with its own count. WebChat SHALL NOT accumulate across a complete sync, delay feedback until sync completion, or add a batch-feedback queue. A later qualifying batch SHALL use the existing generic one-visible-Toast behavior to cover the earlier presentation and SHALL receive its own `3000ms` duration. Synchronization SHALL NOT manually dismiss this Toast, convert it to success, or otherwise make it an operation-lifecycle owner. Toast paint, expiry, cover, absence, or teardown SHALL NOT delay or redefine persistence, acknowledgement, pagination, failover, continuation, or synchronization outcome. History application SHALL continue to create no notification, boolean unread-attention mark, or system notice.

#### Scenario: Frozen local history policy

- **WHEN** a history sync begins, and when requester pagination/retry/provider failover, provider local query/subsequent cursor/local page failover, or dormant-successor promotion continues
- **THEN** the Runtime SHALL freeze the receiver/requester's own `requester cutoff = requester wall clock - 180 days`, accept remote response messages exactly at that requester cutoff and reject only earlier remote response messages after independently validating them against that requester cutoff. At corresponding provider supply/session admission, the provider SHALL separately freeze its own `provider cutoff = provider wall clock - 180 days`, accept local candidates exactly at that provider cutoff, exclude only earlier local candidates without deleting them, and retain it through its local query/subsequent cursor/local page failover; a dormant successor SHALL freeze its own provider cutoff at its own admission and retain it after promotion. The cutoffs SHALL NOT be transmitted or required to match; the requester has final acceptance authority, so remote data cannot expand its window, though clock skew MAY omit otherwise acceptable boundary candidates. The requester SHALL retain its cutoff without re-reading time through pagination/retry/provider failover, stop at provider exhaustion/cutoff/8MiB/10,000 events, and SHALL distinguish local budget exhaustion from provider completion

#### Scenario: Scoped timeout ownership

- **WHEN** an old requester/provider timeout fires after a replacement domain, request, or sync has started
- **THEN** the Runtime SHALL require the `(sourcePeerId, domain, syncId, unique sync token)` match before changing state, so the replacement retains its own timeout interval

#### Scenario: Supplier isolation across domains and sources

- **WHEN** a peer leaves domain A while domain B is waiting on a local supplier, or source A's supplier is hung while source B requests history
- **THEN** only the invalidated domain/source work SHALL be removed; eligible domain B and source B work SHALL continue within the bounded cross-source concurrency pool

#### Scenario: Physical cancellation settlement

- **WHEN** a selected page supply attempt reaches its 5-second boundary and the Runtime sends its `supplyId` cancellation
- **THEN** the page SHALL use the `AbortSignal` to abort its readonly IndexedDB transaction and gate subsequent projection/filter/sort work, and SHALL confirm only after the entire physical query and gated work truly exit; failover, old-job release, and successor promotion SHALL wait for that confirmation, and ignored cancellation SHALL keep the old job admitted until settlement

#### Scenario: Bounded provider admission

- **WHEN** supplier work is queued or active and cleanup, rejoin, or replacement occurs
- **THEN** started jobs SHALL remain counted until final settlement, dormant successors SHALL be included in the same global counts and removed without starting, and admission SHALL never exceed four active jobs, 32 requests, or 8KiB of decoded request metadata; excess requests SHALL be dropped source-locally without room reconnect

#### Scenario: Replacement request continues after prior settlement

- **WHEN** a replacement session sends its one history request while the prior source job is unsettled
- **THEN** the Runtime SHALL admit it as the one dormant source-local successor within the global 32-request/8KiB decoded-metadata admission, SHALL count it against those limits, SHALL NOT run it concurrently, and SHALL automatically promote it to supplier selection after the old physical job settles without requiring another peer request

#### Scenario: One end-to-end concurrency boundary

- **WHEN** supplier selection, encoding, or response sending is still active for an admitted history job
- **THEN** all stages SHALL retain the same job admission, and no more than four jobs SHALL be active across the supplier-to-encode-to-send pipeline

#### Scenario: Completed provider releases its source slot

- **WHEN** source A completes a final response for domain A and immediately requests domain B
- **THEN** domain B SHALL enter supplier work after the domain A send settles, without waiting for the old 10-second timer; any old timer/token SHALL fail its source/domain/request identity check

#### Scenario: History application has no UI side effects

- **WHEN** a valid history response reaches an application/page Domain
- **THEN** records SHALL be inserted-if-absent through the origin store without notifications, boolean unread-attention marks, or system notices caused solely by history application; the exact positive-count pulled-message loading Toast specified below SHALL be the only added UI side effect

#### Scenario: A positive history batch publishes one finite loading Toast

- **GIVEN** one valid history-response batch contains both messages already present in the current origin store and messages not yet stored there
- **WHEN** its canonical insert-if-absent work settles with `count > 0` newly inserted messages
- **THEN** WebChat SHALL publish exactly one generic loading Toast `Pulled {count} new messages.` with `3000ms` duration, count only the newly inserted messages, and create no notification, boolean unread-attention mark, or system notice because of history application

#### Scenario: A batch without a new insertion stays silent

- **WHEN** a request starts, no response arrives, or a batch contains only existing same-id replay, retained conflicts, invalid values, or rejected values
- **THEN** WebChat SHALL publish no pulled-message Toast and SHALL NOT infer a count from request or payload size

#### Scenario: Successive batches remain independent

- **GIVEN** a qualifying batch's pulled-message Toast is still within its `3000ms` duration
- **WHEN** a later batch also inserts one or more new messages
- **THEN** WebChat SHALL publish the later batch's own exact count through the existing one-visible-Toast behavior, cover the earlier presentation, start the later Toast's own `3000ms` duration, and SHALL NOT aggregate or queue the batches

#### Scenario: Pulled-message feedback owns no synchronization lifecycle

- **WHEN** a qualifying batch continues to acknowledgement, pagination, another batch, completion, failover, interruption, or surface teardown
- **THEN** synchronization SHALL issue no manual cancel or success conversion for its pulled-message Toast, and Toast rendering or settlement SHALL NOT gate or change the synchronization path or outcome
