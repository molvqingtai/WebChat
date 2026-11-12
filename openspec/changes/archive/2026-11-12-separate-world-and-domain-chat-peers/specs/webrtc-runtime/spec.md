## ADDED Requirements

### Requirement: Domain peer attempts commit and release atomically

An initial connection for domain A SHALL run as one repeatable, generation-owned attempt. The attempt SHALL obtain or create the dedicated World peer, stage A's contribution to the full World `sites` snapshot, create and join one A-scoped Chat peer, and keep both results provisional until the current attempt has accepted the required World publication and initial Chat session. Only then SHALL the Runtime commit A's World contribution and Chat connection together and expose A as ready.

Any World or Chat failure before commit SHALL fail the same attempt and roll back only facts and resources owned by that attempt. A World peer created by the failed attempt and never committed SHALL be left and disposed idempotently exactly once. A reused or previously committed World peer, every committed World site, and every other domain Chat peer SHALL remain unchanged. After rollback and provenance cleanup settle, A SHALL enter the existing retryable unavailable state and a bounded retry SHALL create a fresh attempt generation. Every later initial-attempt failure SHALL follow this same loop rather than a separate terminal or fallback path.

Commit SHALL make the current connection ready immediately. Each accepted remote Chat source incarnation SHALL independently trigger exactly one History synchronization after commit. History completion, failure, cancellation, or delayed local supplier settlement SHALL NOT retain or reverse ready, trigger a peer retry, or change the committed World contribution.

Automatic recovery, concurrent retry, and the Domain child of ready-state AppButton Refresh for one committed domain SHALL share one domain-scoped single-flight generation. The current Chat peer SHALL enter reconnecting, stop, and reach physical exit before the next generation creates or joins a replacement Chat peer. The replacement SHALL use a new physical `peerId` and `sessionId` while preserving the current logical `presenceId` and `joinedAt`. Automatic Domain recovery and non-AppButton retry SHALL leave the dedicated World physical owner and A's committed World site live and unchanged. A ready-state AppButton action SHALL additionally start the independently fenced sibling World replacement defined by the manual Refresh contract without removing A's World registration or demand. Every other domain Chat peer SHALL remain live and unchanged. A failed Domain replacement SHALL affect only A and SHALL neither cancel nor settle a sibling World replacement; only the current generation for each scope may mutate or settle that scope, and stale callbacks, timers, sends, cleanup, and terminals SHALL have no current authority.

When the last page lease for A leaves, the existing five-second grace SHALL begin while the current Chat peer and World contribution remain committed. A new lease during grace SHALL cancel that release and reuse the same Chat peer and generation. Once grace expires, release SHALL be considered started before the Runtime waits for Chat physical exit. A release started in this way SHALL NOT be canceled or superseded by a connection-attempt generation; every later lease SHALL queue behind that release.

After Chat(A) physically exits, the release owner SHALL publish the full current World snapshot without site A. If that World step fails, one zero-page live release owner SHALL retain A's release identity and retry only the same World completion step at the existing bounded cadence. It SHALL NOT recreate Chat(A), republish A as ready, disturb another domain, or allow an attempt fence to cancel the release. When the World update completes, an otherwise empty World owner SHALL also complete its no-demand leave and disposal; a World peer still serving other sites SHALL remain live. Only after all required World completion settles SHALL the Runtime close A's release owner and resolve queued leases. A resolved waiter SHALL start a fresh generation that stages site A and a new Chat(A) peer through the same atomic initial-attempt contract.

This lifecycle SHALL use only the dedicated World peer and per-domain Chat peers. No host-wide peer shared by World and Chat, alternate transport owner, compatibility route, migration, fallback, or dual path SHALL exist. The external peer schemas, codec, room identifiers, payloads, protocol namespaces, persistence, public `ChatRoom` port, and user-facing feedback contract SHALL remain unchanged.

#### Scenario: Initial attempt repeats after either side fails

- **GIVEN** domain A has no committed connection and initial attempt N owns its staged World contribution and Chat candidate
- **WHEN** the World step or Chat step fails in attempt N or any later retry
- **THEN** the Runtime SHALL roll back A's staged facts, dispose only an attempt-created uncommitted World peer exactly once, preserve every reused or committed owner, settle cleanup, enter A unavailable, and start attempt N+1 only through the bounded retry owner

#### Scenario: Initial commit is ready before History settles

- **GIVEN** one current initial attempt has accepted A's World publication and initial Chat session
- **WHEN** it atomically commits A and discovers accepted remote Chat source incarnations
- **THEN** A SHALL become ready immediately and each accepted source incarnation SHALL trigger exactly one independent History synchronization whose terminal cannot change ready or retry ownership

#### Scenario: Replacement never overlaps Chat peers

- **GIVEN** A is committed and automatic recovery or a ready-state AppButton Refresh replaces its Chat peer
- **WHEN** the replacement generation starts
- **THEN** the old Chat peer SHALL physically exit before the new Chat peer is created or joined and the replacement SHALL retain `presenceId` and `joinedAt` while rotating `peerId` and `sessionId`; automatic recovery alone SHALL leave World physically unchanged, while AppButton SHALL own any World replacement only through its independent sibling operation, and every other Domain SHALL remain unchanged

#### Scenario: Failed or stale replacement affects only its domain

- **GIVEN** one A replacement fails or an older A generation completes after a newer generation owns the attempt
- **WHEN** its failure, callback, timer, send, or cleanup settles
- **THEN** only current A work MAY enter unavailable or commit ready, stale work SHALL be ignored, A work SHALL neither cancel nor settle an independently owned AppButton World replacement, and all other Domain Chat peers SHALL remain live and unchanged

#### Scenario: Lease during grace reuses the current peer

- **GIVEN** A's last page left and the five-second grace is active but release has not started
- **WHEN** a new A lease arrives
- **THEN** the Runtime SHALL cancel grace, retain site A and the same Chat peer generation, and return A to ready without a physical peer replacement

#### Scenario: Lease after release starts waits for completion

- **GIVEN** A's grace expired and release started, including while Chat physical exit or World site removal is still pending
- **WHEN** a new A lease arrives
- **THEN** the lease SHALL queue until World completion closes the release owner, then and only then start one fresh generation that stages site A and a new Chat(A) peer

#### Scenario: World failure retains a zero-page release owner

- **GIVEN** Chat(A) has physically exited and publishing the World snapshot without A fails
- **WHEN** no page lease remains or a new lease is queued
- **THEN** one live release owner SHALL retry only that World step at the bounded cadence, SHALL expose no false A ready state, and SHALL close and resolve waiters only after normal or eventual World completion

#### Scenario: Final site release closes World demand

- **GIVEN** A is the final committed World site and Chat(A) has physically exited
- **WHEN** the empty World publication succeeds
- **THEN** the World owner SHALL complete its no-demand leave and disposal before A's release owner closes, while a later queued lease SHALL create a fresh World and Chat attempt only after that completion

## MODIFIED Requirements

### Requirement: Domain connection sharing and isolation

The headless Runtime SHALL own at most one dedicated World peer for the browser host and at most one dedicated Chat peer for each domain. A World peer SHALL exist exactly while a staged or committed site, a grace-retained site, or current World-release completion requires World demand. A domain Chat peer SHALL exist exactly while its current connection attempt, committed or grace-retained connection, or reconnect generation requires Chat membership; it SHALL be absent after that domain's Chat release physically exits and before any queued post-release attempt begins. The World peer SHALL join only the current World room. Each domain Chat peer SHALL join only that domain's current Chat room. A physical peer, peer identity, desired-room set, restart owner, callback, timer, or pending operation SHALL NOT be shared between the World scope and a Chat scope or between two Chat domains.

Every same-domain page SHALL share its domain's one Chat peer and committed Runtime state. `ConnectionDomain` SHALL maintain at most one connection to the same remote Chat peer for that domain, not one per page. Connection, Session, World, History, Delivery, and Wire owners SHALL keep different domains isolated while `WorldDomain` alone aggregates every committed or grace-retained site into the one full World snapshot.

#### Scenario: Two tabs on one domain

- **WHEN** two pages of the same domain are online
- **THEN** the Runtime SHALL hold exactly one local Chat peer for that domain and exactly one connection to each remote Chat peer of that domain, not one peer or connection set per page

#### Scenario: Cross-domain isolation

- **WHEN** pages of domains A and B are online
- **THEN** A and B SHALL use distinct Chat peers, and neither domain's peer lifecycle, connections, sessions, presence, buffered events, History work, retry, or cleanup SHALL be visible to or affect the other domain

#### Scenario: World ownership is independent of Chat

- **WHEN** one or more Domain Chat peers are active, automatically replaced, released, or replaced as the Domain child of AppButton Refresh
- **THEN** the dedicated World owner SHALL remain scoped only to World, publish the full current site snapshot through its current generation, and share no physical peer identity or restart owner with any Chat Domain; a ready-state AppButton action SHALL replace that World generation only through the independently fenced sibling operation defined by the manual Refresh contract

### Requirement: Artico room demand repairs a retained disconnected peer

The Runtime-private Artico transport SHALL maintain one independent scoped peer owner for World and one for each current Chat-domain lifecycle. Each owner SHALL accept demand for exactly its own room and SHALL maintain this invariant while that demand is non-empty: it owns either one non-terminal physical peer generation or exactly one restart capable of creating it. An owner whose demand is empty SHALL own no live physical peer after its required leave and disposal settle. A provider facade MAY route typed scoped operations to these owners, but SHALL NOT coalesce their peer identities, desired-room State, restart work, callbacks, timers, or pending joins.

When one owner's demand changes from empty to non-empty and its retained scoped peer is already `disconnected`, that owner SHALL enter its generation-owned restart before the join waits for physical readiness. Repeated joins, a close-driven restart, and a delayed restart timer for the same owner SHALL converge on one replacement. World, Chat(A), and Chat(B) demand SHALL remain independent and MAY each have one current owner without sharing a peer or restart.

Every peer callback, pending operation, and timer SHALL be fenced by both scope and generation so an old or different-scope peer cannot join a current room, settle current work, reject another owner, or replace a newer peer. A new domain reconnect generation SHALL own a new physical peer identity; no host-lifetime peer id SHALL be shared across World and Chat owners. Scoped leave and dispose SHALL settle only their exact owner once. The transport SHALL add no unbounded retry loop, page-owned peer, public `ChatRoom` method, alternate shared-peer route, or compatibility path.

#### Scenario: Fresh demand replaces an already disconnected peer

- **GIVEN** one World or domain Chat owner retains a disconnected peer after its close edge while its scoped room demand is empty
- **WHEN** fresh demand for that exact scope arrives
- **THEN** only that owner SHALL create or await one current replacement before joining its room, without waiting for another close edge or changing any other peer owner

#### Scenario: Concurrent room demand shares one restart

- **WHEN** joins, close recovery, or delayed restart work overlap for the same scope while World or other domain scopes also have demand
- **THEN** repeated work for the same scope SHALL converge on one restart, different scopes SHALL retain distinct peers and restart owners, and no Chat peer SHALL join World or another domain's Chat room

#### Scenario: Stale callbacks cannot affect replacement

- **GIVEN** one scoped peer generation has been superseded or another scope owns current work
- **WHEN** the old peer emits delayed open, error, or close, or its delayed timer fires
- **THEN** that stale work SHALL not join a room, settle or reject current pending work, schedule another current replacement, or alter any current peer generation

#### Scenario: Leave and dispose settle owned recovery

- **WHEN** one domain leaves or its scoped owner is disposed while restart or readiness work is pending
- **THEN** only that domain's demand and owned recovery SHALL be removed and settled once, while the World owner and every other domain Chat owner remain unchanged
