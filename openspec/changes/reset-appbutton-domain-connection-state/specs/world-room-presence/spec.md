## MODIFIED Requirements

### Requirement: Presence is a full per-peer snapshot

WorldRoom presence SHALL be published as exactly one `WorldRoomMessage` complete snapshot per source peer: `WorldRoomMessage extends ChatSession {sites: ChatSite[]}`, `ChatSession = {sessionId,user:ChatUser}`, and `ChatSite = {origin,title?,icon?,description?}`. It SHALL have no payload discriminator. The trusted World `roomId` SHALL select this strict parser. World and Chat SHALL use the same structures while maintaining distinct session instances and room protocols. `WorldDomain` SHALL maintain the browser's active-Domain registry, publish a fresh complete snapshot whenever the registry changes, atomically replace a trusted source peer's whole record on each snapshot, and delete that record when the peer leaves.

Automatic recovery or accepted AppButton manual World replacement SHALL publish only one current complete snapshot after the replacement generation is trusted. It SHALL NOT patch, merge, or replay a prior generation's remote record. A real physical World leave/rejoin MAY make the old source disappear and the fresh source later reappear through normal complete-snapshot presence; that connection lifecycle SHALL add no separate loading/progress UI and SHALL NOT be represented as a partial-update payload or synthetic withdraw message.

#### Scenario: Registry-driven publication

- **WHEN** a Domain joins or leaves the browser's active registry
- **THEN** `WorldDomain` SHALL publish one new complete `sites` snapshot reflecting the post-change registry

#### Scenario: Atomic replace and delete

- **WHEN** a receiver gets a snapshot from a source peer
- **THEN** it SHALL replace that peer's entire site set; when the peer leaves it SHALL delete the entire record, never producing ghosts

#### Scenario: No partial-update artifacts

- **WHEN** presence behavior is inspected, including an automatic or AppButton-owned physical World replacement
- **THEN** there SHALL be no payload `type`, composite keys, TTL expiry, partial site mutation, or withdraw message type; a real old-source removal and fresh-source full-snapshot appearance MAY occur only through the physical leave/rejoin lifecycle

### Requirement: WorldRoom self-recovery is independent

`ConnectionDomain` SHALL reconnect the WorldRoom automatically when its physical connection fails, and `WorldDomain` SHALL republish the current full presence snapshot only after the new generation is accepted. Automatic recovery SHALL remain independent of Domain manual-refresh availability and SHALL require no user action.

In ready application state, the accepted AppButton manual Refresh SHALL additionally start one independently fenced World replacement alongside the current-Domain replacement. The World replacement SHALL physically leave and settle the old singleton World owner before canonical join establishes a fresh physical generation. It SHALL preserve the active Domain registration registry, user/site values, desired World demand, and resulting complete local presence, while discarding old-generation trusted membership, room-member and remote-presence projection, recovery/publication work, queues, timers, callbacks, and completion authority. After the replacement is trusted, `WorldDomain` SHALL publish exactly one current full snapshot and rebuild the projected World list only from current-generation presence.

The World child SHALL remain outside AppButton presentation: it SHALL expose no loading, progress, disabled state, completion, error, or Toast, SHALL not delay or change the current-Domain result, and SHALL not be cancelled by Domain settlement. A manual child that overlaps current automatic World recovery or a prior manual replacement SHALL join the one current in-flight World operation. This manual trigger SHALL not change automatic World recovery ownership, pre-ready initialization Retry, another Domain's Chat connection, World payload/schema/room identity, or the source-free `WorldRoomExtern` projection.

#### Scenario: WorldRoom connection failure

- **WHEN** the WorldRoom connection itself fails while pages remain online
- **THEN** `ConnectionDomain` SHALL re-establish it automatically and `WorldDomain` SHALL republish current presence without user action or duplicate ownership

#### Scenario: Domain reconnect isolation

- **WHEN** the user activates AppButton Refresh on the current Domain
- **THEN** that Domain and the singleton World connection SHALL each run their own physical replacement, while every other Domain's Chat connection and state SHALL continue unaffected

#### Scenario: AppButton manually replaces both physical rooms

- **GIVEN** the application is ready with one current Domain and one joined singleton World connection
- **WHEN** the user activates AppButton Refresh once
- **THEN** the current Domain SHALL run its existing clean replacement and World SHALL independently perform one real stop-before-start physical leave/rejoin, preserve active registration demand, and republish the current complete World snapshot through the fresh generation

#### Scenario: Manual World replacement has no UI owner

- **GIVEN** the World child is pending, succeeds, fails, or joins a current automatic or manual World replacement
- **WHEN** the AppButton state and application feedback are observed
- **THEN** only the current-Domain child SHALL control the button and manual-refresh result, while World SHALL publish no loading, progress, completion, error, or Toast UI and SHALL create no overlapping physical replacement
