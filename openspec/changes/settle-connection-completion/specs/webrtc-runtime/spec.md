## ADDED Requirements

### Requirement: Page connection completion is terminal and attempt-owned

Each accepted page connection request SHALL own one current page/host generation attempt across callback registration, inbound replay, replay-record persistence, Runtime Chat/World join, and current snapshot acceptance. The attempt SHALL have one finite implementation-owned deadline and cancellation boundary. It SHALL settle the matching application connection request exactly once as success, failure, or cancellation, and the matching terminal SHALL clear only that request's operation loading. A released, timed-out, or superseded attempt SHALL NOT clear a newer request, apply a stale snapshot, publish a stale callback, or start a late physical join.

Callback registration, inbound replay, and replay-record persistence SHALL remain prerequisites to requesting the Runtime join. If one prerequisite rejects, reaches the attempt deadline, or loses its page/host generation, the adapter SHALL reject or cancel the matching attempt through the existing application terminal path, dispose every partial registration/resource owned by that attempt, abort persistence where the existing Database boundary supports it, and permit a later page or retry to create fresh prerequisite work. A still-pending old prerequisite SHALL NOT remain the admission gate for a later attempt, and its late completion SHALL NOT affect the current generation.

Once the current Runtime generation has physically accepted the required Chat and World publications, committed the domain, and can return a snapshot containing the local session, page connection success SHALL settle from that committed fact. Active post-commit Presence persistence SHALL continue under a bounded Runtime persistence owner and SHALL NOT retain or reopen page connection loading, reverse the committed snapshot solely because it is slow, or become a second page request. An unresolved active Presence predecessor SHALL NOT permanently block later current-generation persistence or final release, and a late old completion SHALL NOT overwrite, retire, or report success for a newer Presence generation. Persistence failure SHALL use the existing Runtime error path.

This active-persistence decoupling SHALL NOT weaken final release. Durable retirement, SESSION_END settlement, cleanup, and physical Chat/World departure SHALL retain their existing causal order and retryable failure semantics. An ordinary page-context refresh while the authoritative physical tab binding remains SHALL start no grace, retain the current physical rooms, and give the replacement page an independent attempt. The existing five-second Lifecycle grace SHALL remain unchanged: a current page returning during actual grace SHALL cancel grace, reuse the same committed physical rooms, and independently settle from the current snapshot, while a page arriving after completed grace release SHALL join new physical rooms.

This requirement SHALL add no success Toast, copy/duration masking, readiness or panel state, protocol field, public `ChatRoom` method, database schema/version, stored record shape, browser-specific business branch, or compatibility path. It SHALL NOT require `pageId` transport metadata, Provider callback re-registration, or another specific mechanism unless later evidence independently requires such a change.

#### Scenario: Projected local user is not held by active Presence persistence

- **GIVEN** the current Runtime generation physically accepted Chat and World, committed the domain, and projected a snapshot containing the local user
- **WHEN** the post-commit active Presence save never settles
- **THEN** the matching page connection SHALL settle success and clear its operation loading from the committed snapshot, while Presence persistence remains independently bounded and no new or modified Toast behavior is introduced

#### Scenario: Pending callback registration fails the current attempt terminally

- **GIVEN** the current page attempt is registering its required Runtime callbacks and no physical join has started
- **WHEN** one registration never settles until the attempt deadline or the page/host generation is released
- **THEN** the matching attempt SHALL fail or cancel, clear only its loading owner, dispose its partial registrations, request no physical join, and allow a later attempt to register afresh

#### Scenario: Pending replay request fails before physical connection

- **GIVEN** required callbacks are registered but inbound replay has not returned and no physical join has started
- **WHEN** replay never settles until the attempt deadline or the page/host generation is released
- **THEN** the matching attempt SHALL fail or cancel with zero projected users, clear only its loading owner, clean up attempt resources, and leave a later attempt independent of the old replay Promise

#### Scenario: Pending replay persistence fails before physical connection

- **GIVEN** replay returned records whose MessageStore/Database persistence belongs to the current attempt and no physical join has started
- **WHEN** one replay write never settles until the attempt deadline or the page/host generation is released
- **THEN** the matching attempt SHALL fail or cancel with zero projected users, clear only its loading owner, abort or fence that write, request no physical join, and allow later replay/persistence to proceed without waiting for the stale write

#### Scenario: Late prerequisite completion is generation-fenced

- **GIVEN** an old page attempt timed out, detached, or was superseded and a newer attempt owns the current page connection request
- **WHEN** an old callback registration, replay, replay write, or terminal result completes later
- **THEN** it SHALL NOT register current callbacks, apply records or snapshots, start a join, clear the newer loading owner, or alter the newer attempt's outcome

#### Scenario: Active Presence tail cannot poison later domain work

- **GIVEN** a committed domain has an unresolved active Presence persistence predecessor
- **WHEN** the current generation needs a later active persistence transition or begins final release
- **THEN** the unresolved predecessor SHALL reach a bounded failure or superseded terminal, later current-generation work SHALL not remain permanently queued behind it, and any late old completion SHALL not replace the current generation

#### Scenario: Page refresh retains rooms with fresh page settlement

- **GIVEN** page generation g1 completed a domain connection and its page context is replaced while the authoritative physical tab binding remains current
- **WHEN** replacement page generation g2 attaches
- **THEN** no Lifecycle grace SHALL start, g2 SHALL retain the same physical Chat and World rooms, independently complete from the current snapshot, and inherit neither g1's request terminal nor loading owner

#### Scenario: Return during grace reuses rooms with fresh page settlement

- **GIVEN** the last authoritative domain binding was removed and the existing five-second Lifecycle grace is current
- **WHEN** page generation g2 returns before grace expiry
- **THEN** g2 SHALL cancel grace, reuse the same physical Chat and World rooms, independently complete from the current snapshot, and inherit no prior request terminal or loading owner

#### Scenario: Reopen after grace creates new physical rooms

- **GIVEN** the last page detached and the five-second grace completed durable release of Chat and World
- **WHEN** a later page generation attaches and connects
- **THEN** it SHALL create one new physical Chat room and one new physical World room through the existing join path and settle only its own connection request

#### Scenario: Final retirement remains durable

- **GIVEN** an active domain begins final release after page connection success
- **WHEN** durable retirement, SESSION_END, or cleanup rejects or remains unsettled
- **THEN** the existing release failure and retry ownership SHALL remain authoritative, physical departure SHALL not bypass its required order, and active-persistence decoupling SHALL NOT convert final release into success
