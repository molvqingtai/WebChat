## ADDED Requirements

### Requirement: Page connection completion is terminal and attempt-owned

Each accepted page connection request SHALL own one current page/host generation attempt across callback registration, inbound replay, replay-record persistence, Runtime Chat/World join, and current snapshot acceptance. The attempt SHALL have one finite implementation-owned deadline and cancellation boundary. It SHALL settle the matching application connection request exactly once as success, failure, or cancellation, and the matching terminal SHALL clear only that request's operation loading. A released, timed-out, or superseded attempt SHALL NOT clear a newer request, apply a stale snapshot, publish a stale callback, or start a late physical join.

Callback registration, inbound replay, and replay-record persistence SHALL remain prerequisites to requesting the Runtime join. If one prerequisite rejects, reaches the attempt deadline, or loses its page/host generation, the adapter SHALL reject or cancel the matching attempt through the existing application terminal path, dispose every partial registration/resource owned by that attempt, abort persistence where the existing Database boundary supports it, and permit a later page or retry to create fresh prerequisite work. A still-pending old prerequisite SHALL NOT remain the admission gate for a later attempt, and its late completion SHALL NOT affect the current generation.

Once the current Runtime generation has physically accepted the required Chat and World publications, committed the domain, and can return a snapshot containing the local session, page connection success SHALL settle from that committed fact. Active post-commit Presence persistence SHALL continue under a bounded Runtime persistence owner and SHALL NOT retain or reopen page connection loading, reverse the committed snapshot solely because it is slow, or become a second page request. An unresolved active Presence predecessor SHALL NOT permanently block later current-generation persistence or final release, and a late old completion SHALL NOT overwrite, retire, or report success for a newer Presence generation. Persistence failure SHALL use the existing Runtime error path.

This active-persistence decoupling SHALL NOT weaken final release. Session SHALL remove the private local active-generation authority through the current release owner, release domain State, allow physical departure of the domain Chat peer, and remove that domain's World contribution without producing or waiting for a Chat lifecycle message. The dedicated World peer SHALL depart only when its final site contribution has been removed. No in-flight end, retryable end, end-send settlement, or settled-cleanup State SHALL exist. A required local active-record cleanup failure SHALL retain the current release failure semantics, but no peer signal SHALL gate departure. An ordinary page-context refresh while the authoritative physical tab binding remains SHALL start no grace, retain the current domain Chat peer plus dedicated World owner and contribution, and give the replacement page an independent attempt. The existing five-second Lifecycle grace SHALL remain unchanged: a current page returning during actual grace SHALL cancel grace, reuse those same committed scoped peers, and independently settle from the current snapshot. A page arriving after completed grace release SHALL join through one new domain Chat peer and SHALL reuse the dedicated World peer when another site retains it or create a new World peer when no site retains World demand.

This terminal-settlement requirement SHALL add no success Toast, error-copy selection, duration masking, readiness or panel state, protocol field, public `ChatRoom` method, database schema/version, stored record shape, browser-specific business branch, or compatibility path. It SHALL NOT require `pageId` transport metadata, Provider callback re-registration, or another specific mechanism unless later evidence independently requires such a change.

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
- **THEN** no Lifecycle grace SHALL start, g2 SHALL retain the same domain Chat peer plus dedicated World owner and contribution, independently complete from the current snapshot, and inherit neither g1's request terminal nor loading owner

#### Scenario: Return during grace reuses rooms with fresh page settlement

- **GIVEN** the last authoritative domain binding was removed and the existing five-second Lifecycle grace is current
- **WHEN** page generation g2 returns before grace expiry
- **THEN** g2 SHALL cancel grace, reuse the same domain Chat peer plus dedicated World owner and contribution, independently complete from the current snapshot, and inherit no prior request terminal or loading owner

#### Scenario: Reopen after grace creates a new domain peer

- **GIVEN** the last page detached and the five-second grace completed the domain Chat release and removal of its World contribution
- **WHEN** a later page generation attaches and connects
- **THEN** it SHALL create one new domain Chat peer, reuse the dedicated World peer when another site retains it or create a new World peer when none does, and settle only its own connection request

#### Scenario: Final release has no peer end phase

- **GIVEN** an active domain begins final release after page connection success
- **WHEN** required local active-record cleanup rejects or remains unsettled
- **THEN** the existing local release failure and retry ownership SHALL remain authoritative, active-persistence decoupling SHALL NOT convert final release into success, and no Chat end send, retry, settlement, cleanup marker, or peer-signal gate SHALL be created

### Requirement: Bootstrap errors do not block the panel shell

Once the content script runs and receives the configured DOM anchor, it SHALL create exactly one existing Shadow UI root, launcher, and openable panel shell before awaiting browser-sync/local configuration preparation, MessageStore/IndexedDB preparation, Runtime registration, or another asynchronous bootstrap dependency. Any dependency deadline, rejection, cancellation, or unavailable result MAY gate only the capabilities that require it. It SHALL NOT return before shell mount, remove or blank the mounted shell, hide the launcher, automatically open the panel, or create another root on retry.

Each bootstrap attempt SHALL belong to one finite current generation. Before a prerequisite is ready, the application SHALL NOT ignite its dependent Domain, automatic Chat/World join, database read/write, callback, or other side effect. Bootstrap-independent shell controls SHALL remain usable. When the prerequisites for a Domain become ready, the same mounted root SHALL initialize that Domain and its application state exactly once; a Retry SHALL NOT create a duplicate store, Domain, listener, join, or UI root.

A terminal bootstrap failure SHALL leave one visible generic unavailable state and one Retry action inside the mounted shell. The launcher SHALL remain focusable and named; the unavailable state and Retry SHALL be discernible to assistive technology, and Retry SHALL be keyboard-operable with an accessible current label. When a genuine failure is owned by the current page, the existing application error route SHALL present exactly the original `error.message` and SHALL add no prefix, suffix, wrapper, mapping, normalization, replacement copy, or structured routing detail. A failure with no current affected page/live route or no user impact SHALL call `console.error(error)` directly and SHALL NOT manufacture a Toast destination. If only Runtime fails after the normal application surface is ready, the existing `ReadinessDomain`, generic feedback, `Connection failed`, ready dismissal, and retry/reconnect behavior SHALL remain the sole Runtime state and feedback authority.

One accepted Retry SHALL start one fresh bounded bootstrap generation, reuse an already valid dependency result only when that reuse preserves its ownership contract, and fence every late result from the failed generation. Success SHALL hydrate or recover the same shell in place and continue each newly available dependent flow once without requiring a document reload. Failure SHALL settle only the current Retry loading and return to the same accessible unavailable state without an infinite loading owner. A reload or genuine document replacement SHALL mount one fresh shell and generation; old work SHALL NOT mutate its shell, dependency state, or request result.

This requirement changes no connection or persistence truth after its prerequisites are ready. It SHALL add no success feedback, second Runtime readiness or Toast owner, decorated or replacement copy, structured diagnostic detail in user-facing text, panel visual redesign, protocol/public-port/schema/version change, or weakened final release behavior.

#### Scenario: Storage preparation failure preserves the shell

- **GIVEN** the content script has a body anchor and browser-sync/local configuration or MessageStore preparation rejects or reaches its current terminal
- **WHEN** full application initialization cannot continue
- **THEN** exactly one launcher and openable panel shell SHALL remain mounted with one accessible unavailable state and Retry, the existing current-page error route SHALL present exactly the original `error.message` without decorated/replacement copy, and no dependent storage Domain or side effect SHALL be ignited

#### Scenario: Initial control-plane timeout preserves the shell

- **GIVEN** the shell is mounted and initial Runtime registration never returns within the current bounded startup budget
- **WHEN** the Runtime attempt settles unavailable with `Runtime control-plane request timed out`
- **THEN** the shell and launcher SHALL remain usable, Runtime-dependent work SHALL remain unavailable, the current failure SHALL be visibly and accessibly recoverable through its exact original `error.message`, and no full blank, decorated/replacement copy, or pre-mount return SHALL occur

#### Scenario: Unready dependencies cannot ignite application work

- **GIVEN** one or more bootstrap dependencies have not reached ready
- **WHEN** the shell renders or another dependency independently becomes ready
- **THEN** no Domain, automatic join, database operation, callback, or listener that requires an unready dependency SHALL start, while each newly satisfied dependent flow MAY initialize exactly once

#### Scenario: Retry recovers the same mounted shell

- **GIVEN** the shell is mounted in a bootstrap-unavailable state
- **WHEN** one accepted Retry owns a fresh bounded generation and every required dependency becomes ready
- **THEN** the same root SHALL recover the normal application UI, each dependent Domain/flow SHALL initialize once, and no page reload, duplicate root/store, or stale attempt settlement SHALL occur

#### Scenario: Repeated Retry failure remains finite and accessible

- **GIVEN** the shell is mounted in the unavailable state
- **WHEN** the current Retry also reaches its bounded failure terminal
- **THEN** only that Retry loading SHALL settle, the launcher and panel SHALL remain usable, the unavailable state and Retry SHALL remain accessibly discernible, the matching current-page error SHALL retain exactly its original `error.message`, and no infinite loading, decorated/replacement copy, or shell unmount SHALL occur

#### Scenario: Reload creates one fresh shell generation

- **GIVEN** a document generation has a mounted shell and pending or failed bootstrap work
- **WHEN** a genuine reload or document replacement creates the next content-script generation
- **THEN** the replacement SHALL mount exactly one fresh shell and start one fresh bootstrap generation, while late work from the old generation SHALL NOT alter the replacement shell, dependency state, readiness, or request outcome
