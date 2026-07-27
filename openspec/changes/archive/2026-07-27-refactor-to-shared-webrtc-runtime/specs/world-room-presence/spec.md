## ADDED Requirements

### Requirement: WorldRoom v2 is a browser singleton inside the Runtime

The World wire types, schema, limits, and pure validation SHALL be defined by the public `src/protocol/index.ts` module. Runtime-only registry, projection, lifecycle, and transport orchestration SHALL remain outside that module; the dependency direction SHALL be Runtime → protocol.

The system SHALL keep the WorldRoom as the cross-domain discovery index, joined exactly once per browser by the shared Runtime in a v2-namespaced room rather than once per page. `ConnectionDomain` SHALL uniquely own that physical WorldRoom membership/recovery generation, while `WorldDomain` uniquely owns its session, active-domain registry, and presence snapshots. While at least one supported domain page is online, Connection SHALL maintain one WorldRoom membership; after the last page disconnects, the membership SHALL follow the Lifecycle domain-released Event after the unified five-second grace before exit.

#### Scenario: Single membership per browser

- **WHEN** multiple pages across one or more domains are online in one browser
- **THEN** `ConnectionDomain` SHALL hold exactly one WorldRoom membership, not one per page or per domain

#### Scenario: Grace-aligned exit

- **WHEN** the last page of the browser disconnects
- **THEN** the WorldRoom membership SHALL exit only after the same unified 5-second grace used by domain lifecycles

### Requirement: Presence is a full per-peer snapshot

WorldRoom presence SHALL be published as exactly one `WorldRoomMessage` complete snapshot per source peer: `WorldRoomMessage extends ChatSession {sites: ChatSite[]}`, `ChatSession = {sessionId,user:ChatUser}`, and `ChatSite = {origin,title?,icon?,description?}`. It SHALL have no payload discriminator. The trusted World `roomId` SHALL select this strict parser. World and Chat SHALL use the same structures while maintaining distinct session instances and room protocols. `WorldDomain` SHALL maintain the browser's active-domain registry, publish a fresh complete snapshot whenever the registry changes, atomically replace a trusted source peer's whole record on each snapshot, and delete that record when the peer leaves.

#### Scenario: Registry-driven publication

- **WHEN** a domain joins or leaves the browser's active registry
- **THEN** `WorldDomain` SHALL publish one new complete `sites` snapshot reflecting the post-change registry

#### Scenario: Atomic replace and delete

- **WHEN** a receiver gets a snapshot from a source peer
- **THEN** it SHALL replace that peer's entire site set; when the peer leaves it SHALL delete the entire record, never producing ghosts

#### Scenario: No partial-update artifacts

- **WHEN** presence behavior is inspected
- **THEN** there SHALL be no payload `type`, composite keys, TTL expiry, World reconnect-republish cycles, withdraw message types, or list flicker by design

### Requirement: Presence counts per domain per browser

Presence SHALL be aggregated by domain: multiple pages of one browser on one domain SHALL count as exactly one online user for that domain. A user on domain A who has not joined domain B's ChatRoom SHALL still see domain B's online count in the sites list.

#### Scenario: Multi-page dedup

- **WHEN** one browser has several pages open on the same domain
- **THEN** its WorldRoom contribution for that domain SHALL count as exactly one online user

#### Scenario: Cross-domain visibility

- **WHEN** a user stays on domain A without joining domain B's ChatRoom
- **THEN** the user SHALL still see domain B's online count derived from WorldRoom presence

#### Scenario: Grace-period counting stability

- **WHEN** a domain enters its 5-second refresh grace period
- **THEN** it SHALL remain in the published `sites` snapshot during the window and SHALL be removed only after grace expiry, avoiding count flapping

### Requirement: Presence site metadata is display-safe and privacy-bounded

`ChatSite = {origin, title?, icon?, description?}`. `host` and `hostname` SHALL NOT be published because they are derivable from `origin`; raw `href` SHALL NOT be published because it can leak paths, queries, and tokens. Any future page-specific display SHALL use newly designed sanitized fields behind an explicit privacy decision.

#### Scenario: No page-content disclosure

- **WHEN** any presence snapshot is published
- **THEN** each site SHALL contain only `origin` and optional `title`, `icon`, and `description`, and SHALL NOT contain `host`, `hostname`, `href`, paths, or query strings

### Requirement: WorldRoom self-recovery is independent

`ConnectionDomain` SHALL reconnect the WorldRoom automatically when its physical connection fails, and `WorldDomain` SHALL republish the current full presence snapshot only after the new generation is accepted. The domain-scoped manual reconnect action SHALL NOT rebuild or interrupt the WorldRoom.

#### Scenario: WorldRoom connection failure

- **WHEN** the WorldRoom connection itself fails while pages remain online
- **THEN** `ConnectionDomain` SHALL re-establish it automatically and `WorldDomain` SHALL republish current presence without user action or duplicate ownership

#### Scenario: Domain reconnect isolation

- **WHEN** the user activates "Reconnect this site" on any domain
- **THEN** the WorldRoom membership and its presence SHALL continue unaffected

### Requirement: World application port is projected and source-free

`WorldRoomExtern` SHALL directly type-import the exact protocol `ChatSite` and `ChatUser` structures and SHALL expose exactly `getState(): Promise<WorldState>`, `onState((WorldState) => void): disposer`, and `onError((Error) => void): disposer`, where `WorldState = (ChatSite & {users: ChatUser[]})[]`. `WorldDomain` SHALL remain the unique owner of private source/site contributions and SHALL project the source-free `WorldState`; the application adapter SHALL subscribe before taking that projected upstream snapshot, so no update can fall into a getter/subscription gap, and SHALL NOT reconstruct or retain a second writable source multiset. The application port SHALL NOT expose peer/source identity, Runtime snapshot/presence types, synthetic join times, or routing fields. Each `(source, origin)` contribution in `WorldDomain` SHALL receive stable order at first appearance; updates SHALL not reorder it and new contributions SHALL append. Every active contribution SHALL retain one entry in that origin's `users`, including repeated entries for the same user id; origin groups and their users SHALL project in stable order, and every origin SHALL have exactly one group. Group `ChatSite` metadata SHALL always be the current ChatSite value of the first active contribution: a metadata-only update of that first contribution updates the metadata while it remains first, and only its leave or move to another origin promotes the next active contribution. World application consumers and non-runtime Domains SHALL have zero `@/runtime/**` imports.

#### Scenario: Exact-origin projected multiset and metadata order

- **WHEN** multiple source contributions describe one exact origin, including multiple contributions for the same user, and the first contribution updates metadata, leaves, or moves to another origin
- **THEN** the application World state SHALL expose one exact-origin group whose users and origin groups retain first-appearance stable order; the metadata SHALL use the first active contribution's current ChatSite value after a metadata-only update and SHALL promote the next active contribution only after that first contribution leaves or moves, without exposing the source identities used by the adapter

#### Scenario: World subscription closes the snapshot gap

- **WHEN** a World application consumer establishes both state observation and an initial state read while upstream presence changes
- **THEN** the adapter SHALL subscribe before its projected upstream snapshot and the consumer SHALL receive no missing state between `onState` and `getState`, without the adapter retaining private source contribution authority

#### Scenario: World fake-port replacement

- **WHEN** a fake World application port drives state updates and errors
- **THEN** a World application consumer SHALL operate using only the exact-origin projected state and exact public protocol value types, while `WorldDomain` alone retains Runtime snapshot/source handling
