## ADDED Requirements

### Requirement: Editor images use session-owned Blob locators only while drafting

The application/page Domain SHALL retain ownership of the message draft and editor image lifecycle. Visible text input SHALL remain limited to 500 JavaScript string/UTF-16 code units. Inserting an image SHALL compress it toward the unchanged 30KiB target, generate one opaque editor-session id through the platform `crypto.randomUUID()` API, store the resulting Blob under that id in an editor-owned `Map<string, Blob>`, and insert exact literal Markdown `![Image](blob:<id>)` into the existing textarea. The textarea SHALL continue to display Markdown text and SHALL add no thumbnail or rich preview UI. The `blob:<id>` value SHALL be only an editor locator, not a browser object URL or fetch target.

The editor SHALL create no object URL and add no dependency. Its session-only map SHALL store the Blob itself and SHALL never enter persistence or another context. It SHALL store no Base64 or data-URL image content. Image insertion SHALL allocate no image NanoID, perform no immediate Blob-to-data-URL conversion, and create no `hash:` placeholder. Old `hash:` draft syntax SHALL receive no parser, compatibility read, or migration.

At send, only currently referenced `blob:<id>` tokens that resolve through the current editor map may proceed. The editor SHALL read each Blob, convert it to a data URL, replace the locators in a temporary message candidate, keep mention ranges consistent through the existing composition owner, and submit the candidate through the unified outbound Schema boundary and codec. The Footer SHALL add no separate Schema parse, complete-message byte preflight, duplicate object guard, compatibility path, or defensive validation layer. Sent, locally persisted, remotely persisted, and History-replayed message Markdown SHALL contain data URLs only; a `blob:<id>` token SHALL never enter wire, IndexedDB, History, or another persistent message value.

A missing id/Blob, Blob read/conversion failure, Schema failure, or codec failure SHALL reject the send and preserve the draft plus its still-referenced entries. Successful send SHALL clear only the draft it started from; edits made while Blob conversion is running and their referenced entries SHALL remain. Explicit draft clear and component unmount SHALL delete all entries. Editing away the last occurrence of one id SHALL delete that entry; duplicate occurrences SHALL keep it until the final reference disappears. Deletion SHALL make the Blob garbage-collectable; `URL.createObjectURL` and `URL.revokeObjectURL` SHALL NOT be used. No fallback, compatibility path, compensating state, or additional lifecycle abstraction SHALL be introduced.

#### Scenario: Image insertion stores only a local draft reference

- **WHEN** image compression succeeds in the current editor
- **THEN** the draft SHALL receive `![Image](blob:<id>)`, the id SHALL resolve to the compressed Blob in the current editor's session map, and no object URL, data URL, image NanoID, `hash:` token, Base64 entry, or dependency SHALL be created at insertion time

#### Scenario: Successful send resolves to persistent data URLs

- **WHEN** every referenced id maps to its Blob and the expanded message passes the unified outbound Schema boundary and common codec
- **THEN** the application SHALL send and persist only the data-URL-expanded message, clear only the draft it started from, preserve edits made while conversion was running, and delete only entries no longer referenced by the current draft

#### Scenario: Failed send preserves the complete draft

- **WHEN** one id is missing, conversion fails, or the expanded candidate fails the Schema or codec
- **THEN** no partial message SHALL be sent or persisted, the current literal draft SHALL remain unchanged, and every still-referenced owned map entry SHALL remain valid for correction or retry

#### Scenario: Duplicate references release only after the final removal

- **GIVEN** the same owned `blob:<id>` occurs more than once in one draft
- **WHEN** editing removes one occurrence but retains another
- **THEN** the editor SHALL keep the id-to-Blob entry, and SHALL delete it only after the final reference disappears or the owning draft succeeds, clears, or unmounts

## MODIFIED Requirements

### Requirement: Headless Runtime owns history orchestration

`HistoryDomain` SHALL retain the complete current exact-difference synchronization around the application/page Domain's origin store. Each accepted source incarnation SHALL start exactly one outgoing requester synchronization and admit at most one incoming provider synchronization with independent IDs. Requester and provider SHALL freeze their existing independent eligible 180-day snapshots at their owning boundaries and page them under the common 256KiB final-frame ceiling. Each History Push SHALL retain at most 100 messages, exact producer-created author sets, canonical recent-first order, serial local processing, atomic Delivery admission, and final `insert-if-absent` settlement.

History SHALL impose no cumulative 10,000-entry or 8MiB inventory/response/session budget. A complete finite fixed snapshot MAY span any number of individually bounded pages. The per-domain inbound un-ACK buffer SHALL remain 512 records/8MiB and provider supply SHALL retain at most four active jobs, 32 admitted requests, and 8KiB decoded request metadata. These are instantaneous operational admissions, not cumulative History completion limits.

Each current requester/provider attempt SHALL own one 10-second no-progress deadline under its complete domain/source/direction/generation/`syncId`/token identity. Valid forward progress that advances the current inventory page, provider snapshot/supply stage, response page send, response page admission, or local response processing SHALL re-arm the deadline. Duplicate replay, a page that does not advance current State, and stale work SHALL NOT extend it. A stale deadline SHALL not affect a later attempt.

A direction SHALL terminate on final locally settled `done: true`, fixed snapshot/data exhaustion including its frozen cutoff, source disconnect/replacement, domain release/lifecycle cleanup, explicit cancellation, malformed/invalid/order/gap/changed-replay/post-done/source-binding failure, supplier/persistence/encode/send/delivery/local-processing failure, or 10 seconds without valid forward progress. Terminalization SHALL discard requester/provider inventories, fixed snapshots, response pages, pending queues/sends, fingerprints, working counters, and attempt-owned History feedback. It SHALL release source/global supplier admission. Selected physical page supply SHALL be canceled through its existing `AbortSignal`, and old slot release or successor promotion SHALL wait for actual IndexedDB query and projection/filter/sort settlement. Late timeout/token/completion work SHALL be inert.

The existing constant-size terminal binding SHALL continue to prevent another synchronization on the same connection/direction. Source replacement or domain release SHALL clear its old bindings, and a later connection SHALL start one independent synchronization from current storage. No peer ACK, resume, retry, progress persistence, cumulative-budget fallback, or compatibility path SHALL exist.

#### Scenario: A progressing fixed snapshot is not truncated cumulatively

- **WHEN** an eligible 180-day requester or provider snapshot exceeds 10,000 records or 8MiB across individually valid pages and continues making forward progress
- **THEN** History SHALL continue until done/data exhaustion or another explicit terminal condition, without claiming completion or stopping because of an obsolete cumulative budget

#### Scenario: No-progress timeout is refreshed only by advancement

- **WHEN** the current attempt advances an inventory page, provider supply stage, response send/admission, or local response processing before 10 seconds elapse
- **THEN** its complete current identity SHALL receive a fresh 10-second no-progress deadline, while duplicate/replayed/stale work SHALL not extend that deadline

#### Scenario: Stalled work releases every owned resource

- **WHEN** one attempt makes no valid forward progress for 10 seconds
- **THEN** it SHALL terminalize only that identity, dismiss its History feedback, discard every owned snapshot/page/queue/working value, cancel selected physical supply, and release admission only after actual supplier settlement

#### Scenario: Data exhaustion and final page finish normally

- **WHEN** the fixed inventory/provider difference is exhausted and its final `done: true` page settles at the owning send or local-processing boundary
- **THEN** the direction SHALL complete, release working resources, retain only its existing terminal connection binding, and start no retry or peer acknowledgement flow

#### Scenario: Inbound Delivery buffer remains independently bounded

- **WHEN** one History Push would take the per-domain volatile un-ACK buffer over 512 records or 8MiB
- **THEN** Delivery SHALL retain its existing atomic whole-page rejection and cancel only that attempt; removal of cumulative History budgets SHALL not enlarge or bypass this buffer

#### Scenario: Frozen local history policy

- **WHEN** a directional History synchronization begins and its request inventory or missing-record response continues
- **THEN** the requester SHALL retain one fixed 180-day cutoff and ID snapshot through all Pull pages, the provider SHALL wait for the final inventory page and then retain one separate fixed 180-day cutoff and record snapshot through all Push pages, the requester SHALL independently reject only response records earlier than its cutoff, and neither side SHALL transmit or compare cutoffs

#### Scenario: Scoped timeout ownership

- **WHEN** an old requester/provider no-progress deadline fires after a replacement domain, source generation, token, or `syncId` has started
- **THEN** History SHALL require the complete current attempt identity before terminalizing State or dismissing feedback, so the replacement attempt remains unchanged

#### Scenario: Terminal synchronization cannot restart within one connection

- **GIVEN** one source incarnation and direction has completed, canceled, or failed its bound History synchronization
- **WHEN** a repeated SESSION, deadline, late page, replayed page zero, or page with another `syncId` arrives before source replacement or domain release
- **THEN** History SHALL retain only the original ID and terminal bit, start no synchronization, allocate no snapshot or queue, and publish no History feedback

#### Scenario: Domain release clears directional bindings

- **WHEN** the domain is released or the source incarnation is replaced after its physical work settles
- **THEN** History SHALL clear every outgoing and incoming working or terminal binding for that released lifecycle, while a later room connection starts exactly one independent synchronization per direction

#### Scenario: Supplier isolation across domains and sources

- **WHEN** a peer leaves domain A while domain B is waiting on a local snapshot supplier, or source A's supplier is hung while source B needs an inventory or provider snapshot
- **THEN** only the invalidated domain/source work SHALL be removed; eligible domain B and source B work SHALL continue within the bounded cross-source concurrency pool

#### Scenario: Physical cancellation settlement

- **WHEN** a selected page snapshot attempt reaches its existing five-second supplier boundary and History cancels its `supplyId`
- **THEN** the page SHALL use the `AbortSignal` to abort its readonly IndexedDB transaction and gate subsequent projection/filter/sort work, and SHALL confirm only after all physical work exits; failover, old-job release, and successor promotion SHALL wait for that confirmation

#### Scenario: Bounded provider admission

- **WHEN** inventory/provider snapshot or response work is queued or active and cleanup, rejoin, or replacement occurs
- **THEN** started jobs SHALL remain counted until final settlement, dormant successors SHALL be included in the same global counts and removed without starting, and admission SHALL never exceed four active jobs, 32 requests, or 8KiB decoded request metadata; excess work SHALL cancel source-locally without room reconnect

#### Scenario: Replacement request continues after prior settlement

- **WHEN** a newly joined replacement source has triggered its one History synchronization while the prior source's local snapshot job is unsettled
- **THEN** History SHALL admit at most one dormant source-local successor within the global bounds, assign the new connection a fresh `syncId`, SHALL NOT run it concurrently, and SHALL start it after old physical settlement without reviving or retrying old synchronization State

#### Scenario: One end-to-end concurrency boundary

- **WHEN** supplier selection, snapshot projection, filtering, encoding, or History page sending remains active for an admitted job
- **THEN** every stage SHALL retain the same job admission and no more than four jobs SHALL be active across the complete local supplier-to-send pipeline

#### Scenario: Completed provider releases its source slot

- **WHEN** a provider's final `done: true` Push settles locally and the same source immediately begins another domain's work
- **THEN** the completed provider SHALL release its source slot after that local send settlement without waiting for remote receipt, processing, persistence, or acknowledgement, and old deadline/token work SHALL have no authority over newer work

#### Scenario: History application has no UI side effects

- **WHEN** valid missing History records reach an application/page Domain
- **THEN** records SHALL be inserted-if-absent without notifications, boolean unread-attention marks, or system notices; only the separately specified History loading Toast MAY reflect actual insertion and local attempt lifetime

### Requirement: Event sequence and un-ACK buffer

`DeliveryDomain` SHALL continue to maintain its short-term per-domain event sequence and volatile inbound un-ACK buffer bounded to 512 records and 8MiB. An event SHALL be cleared once at least one page acknowledges durable persistence. One History Push page SHALL be admitted atomically or rejected as a whole when it would exceed either bound; rejection SHALL apply none of the page, cancel only the local History attempt, and request no continuation. Page reconnect replay, domain-grace discard, browser-kill loss, and absence of a peer ACK/outbox/recovery mechanism SHALL remain unchanged.

These bounds SHALL remain independent from the removed History cumulative 10,000-entry/8MiB session budgets. They constrain only current unacknowledged memory. Raising the declarative body field and codec limits SHALL not change 512 or 8MiB; larger typed records may therefore reach the byte bound before the record-count bound.

#### Scenario: Large messages consume the unchanged byte buffer

- **WHEN** admitted typed records contain large bodies and data URLs
- **THEN** Delivery SHALL continue counting their actual canonical bytes toward the unchanged 8MiB bound and MAY reach that byte bound with fewer than 512 records

#### Scenario: Removing cumulative History caps does not bypass atomic admission

- **WHEN** an otherwise progressing History synchronization presents a Push that would overflow the current un-ACK buffer
- **THEN** Delivery SHALL reject the complete page and cancel that attempt exactly as before, even though History no longer tracks a cumulative session byte or record budget

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

- **WHEN** a History Push page would exceed 512 records or 8MiB in the volatile un-ACK buffer
- **THEN** the Runtime SHALL reject the whole page, preserve existing records, cancel only that History attempt, and SHALL send no peer acknowledgement or continuation request
