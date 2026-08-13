## MODIFIED Requirements

### Requirement: Headless Runtime owns history orchestration

`HistoryDomain` SHALL own history synchronization policy around the application/page Domain's origin store. At each sync start, it SHALL freeze the receiver/requester's own `requester cutoff = requester wall clock - 180 days` (`HISTORY_WINDOW_DAYS = 180`). A remote response message exactly at that requester cutoff SHALL be eligible; only an earlier remote response message SHALL be rejected. At its corresponding provider supply/session admission, the selected provider SHALL separately freeze its own `provider cutoff = provider wall clock - 180 days`. A local candidate exactly at that provider cutoff SHALL be eligible, and only earlier local candidates SHALL be excluded without deletion; its local query, subsequent cursor, and local page failover SHALL retain that provider cutoff without re-reading time. A dormant successor SHALL freeze its own provider cutoff at its own admission and SHALL retain it after promotion. The cutoffs SHALL NOT be transmitted or required to match. The requester SHALL independently validate every response against its own cutoff and has final acceptance authority, so a remote provider SHALL NOT expand the requester window, although clock skew MAY omit boundary candidates that the requester would otherwise accept. The requester cutoff SHALL remain unchanged through that sync's pagination, retry, and provider failover. `HistoryDomain` SHALL enforce at most one outstanding request per source with a fixed 10-second operational timeout. The timeout SHALL use its established arm points and complete-identity fencing; accepted progress SHALL NOT re-arm or replace it. One synchronization SHALL have no session-wide cumulative message-count or canonical-content-byte limit and no aggregate object or page guard. `HistoryDomain` SHALL select one application/page supplier per request, keep requester/provider State scoped by `(sourcePeerId, domain, syncId, unique sync token)`, and SHALL not store a history copy or read-model replica. The public protocol remains responsible only for validating the typed history request/response shape, cursor, response-size limit, and user/message references.

The Runtime page contract SHALL use an explicit `{supplyId}` request/cancel event plus `resolveHistorySupply`/`rejectHistorySupply` RPC. Each page supply attempt SHALL have a 5-second boundary. A page query SHALL receive an `AbortSignal` wired to its readonly IndexedDB transaction; the signal SHALL abort that transaction and gate all subsequent projection/filter/sort work, and the page SHALL confirm physical settlement only after the entire query and gated work truly exits. Failover, old-job release, and successor promotion SHALL wait for that confirmation. Supplier work SHALL be serial per source, isolated across domains and sources, and admitted through one pipeline covering supplier selection, encode, send, and final release; the pipeline SHALL have at most four active jobs, 32 admitted requests, and 8KiB of decoded request metadata. A replacement session's one-shot request arriving before the old source job settles SHALL occupy one dormant source-local successor within the same global admission; the successor itself SHALL count toward the 32-request and 8KiB decoded-metadata limits, SHALL NOT run concurrently, and SHALL automatically promote after physical settlement without another peer request. Timeout, leave, and release MAY remove an unstarted successor; a started job SHALL remain counted until settlement. A completed response releases its source slot immediately after send settlement, and an old timer/token SHALL NOT delay or close a newer domain/request. Cleanup SHALL retain active admission until physical settlement and remove dormant successors without starting them.

#### Scenario: Frozen local history policy

- **WHEN** a history sync begins, and when requester pagination/retry/provider failover, provider local query/subsequent cursor/local page failover, or dormant-successor promotion continues
- **THEN** the Runtime SHALL freeze the receiver/requester's own `requester cutoff = requester wall clock - 180 days`, accept remote response messages exactly at that requester cutoff and reject only earlier remote response messages after independently validating them against that requester cutoff. At corresponding provider supply/session admission, the provider SHALL separately freeze its own `provider cutoff = provider wall clock - 180 days`, accept local candidates exactly at that provider cutoff, exclude only earlier local candidates without deleting them, and retain it through its local query/subsequent cursor/local page failover; a dormant successor SHALL freeze its own provider cutoff at its own admission and retain it after promotion. The cutoffs SHALL NOT be transmitted or required to match; the requester has final acceptance authority, so remote data cannot expand its window, though clock skew MAY omit otherwise acceptable boundary candidates. The requester SHALL retain its cutoff without re-reading time through pagination/retry/provider failover and continue across bounded pages until a non-cumulative terminal boundary, without a session-wide cumulative message-count or canonical-content-byte limit

#### Scenario: Scoped timeout ownership

- **WHEN** a requester/provider timeout is armed, accepted progress arrives, or a timer fires after a replacement domain, request, or sync has started
- **THEN** the Runtime SHALL retain the fixed 10-second interval from the applicable arm point without progress-based re-arm or timer replacement, and SHALL require the `(sourcePeerId, domain, syncId, unique sync token)` match before changing state

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
- **THEN** records SHALL be inserted-if-absent through the origin store without notifications, boolean unread-attention marks, or system notices caused solely by history application
