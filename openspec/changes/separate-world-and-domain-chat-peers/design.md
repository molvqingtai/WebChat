## Context

See `proposal.md` for the product motivation and `specs/webrtc-runtime/spec.md` for normative behavior.

The current public peer contract already separates transport context from payload data: trusted `roomId` and `sourcePeerId` come from the provider, World payload is the existing full `{sessionId,user,sites}` snapshot, and Chat session data distinguishes physical `sessionId` from logical `presenceId` and `joinedAt`. None of those external structures needs to change.

The shared headless Runtime already has separate state authorities. Lifecycle owns page leases and grace, Connection owns connection generations and physical transitions, Session owns logical Chat identity, World owns the site registry and full snapshot, History owns per-source synchronization, and Wire owns trusted rooms plus the provider boundary. The transport composition must preserve these owners while giving each physical peer a single network scope.

Existing page completion, History, and document-lifecycle contracts also constrain the design: a committed connection is ready without waiting for persistence or History; one accepted Chat source incarnation triggers one synchronization; and only the final active page lease starts the five-second domain grace.

## Goals / Non-Goals

**Goals:**

- Give every physical peer exactly one World or domain Chat scope.
- Coordinate World contribution and Chat connection as one local atomic domain attempt without duplicating their State owners.
- Replace one domain Chat peer without overlapping old and new peers or crossing ownership into other scopes, including when AppButton independently starts a sibling World replacement.
- Preserve stable logical presence across physical replacement and preserve exactly-once History triggering per accepted source incarnation.
- Serialize final release and a later lease so an old World removal cannot delete a newly committed site.

**Non-Goals:**

- Changing any peer message, schema, codec, namespace, room identifier, payload, size limit, persistence contract, public application port, or UI behavior.
- Moving peer ownership into pages or introducing a second owner for leases, committed sessions, World sites, History, or trusted transport facts.
- Retaining a host-wide shared-peer mode, transition adapter, migration, fallback, feature flag, or dual path.

## Decisions

### 1. Physical transport ownership is keyed by network scope

The provider composition will expose one World owner and a keyed set of Chat owners, one for each current domain lifecycle. Each owner allows exactly one room and contains exactly one Artico peer generation while its demand is non-empty; after scoped leave/disposal settles it contains no live peer. A typed internal scope distinguishes `world` from `chat(domain)` before an operation reaches the physical provider; scope is not inferred from payload shape and does not become peer-wire data.

`WireDomain` remains the sole provider anti-corruption boundary. The existing private transport Extern may remain one facade, but its implementation must route to scoped owners without becoming another lifecycle or connection State authority. Provider callbacks return through the same scope so trusted membership, queues, and stale-generation checks cannot cross peers.

### 2. Connection coordinates an attempt handle; Domains retain their facts

Connection owns a domain attempt handle containing its generation, cancellation fence, World-owner provenance, and cleanup settlement. It asks World to stage the full desired snapshot and Wire to stage the scoped Chat peer/session through their existing CQRS boundaries. Neither staged result becomes committed page truth until both accepted operations settle for the same current handle.

The commit transition publishes one coordinated fact to Session and World so pages cannot observe a committed Chat connection without site A or a committed site A without Chat. This is local atomicity across Runtime State. Network operations cannot be transactionally atomic across remote peers, so a partial external acceptance remains provisional and is compensated during rollback while no page sees ready.

Cleanup follows provenance. An attempt-created, never-committed World peer is left and disposed once. A reused or committed World peer is never disposed by the attempt; only A's staged contribution is removed. A Chat candidate is always attempt-owned until commit. The same cleanup path feeds bounded retry for every initial attempt number.

### 3. A domain replacement is stop-before-start and keeps logical presence

Connection serializes automatic recovery, concurrent requests, release, and the Domain child of manual AppButton Refresh for each domain. Replacement first marks A reconnecting, stops its current Chat owner, and awaits physical exit. Only then does generation N+1 allocate a new Chat peer and `sessionId`. Session supplies the already active `presenceId` and `joinedAt`, so remote observers see physical rebinding rather than a logical leave and join.

The Domain replacement itself causes no World site transition. Automatic Domain recovery and non-AppButton retry leave the current World physical owner live. In ready application state, AppButton independently starts the sibling World stop-before-start replacement defined by the manual Refresh contract; that World child retains the registration registry and demand and is not owned or settled by the Domain generation. Other Domain owners continue independently. Generation fences cover provider callbacks, delayed timers, snapshot publication, cleanup, and result settlement. Only the current generation for each scope can mutate or settle that scope.

Commit produces ready immediately. The accepted-source event that follows commit remains the one History trigger. History runs as independent per-source work and has no edge back to connection commit, retry, or ready.

### 4. Release completion, not a new attempt, unlocks post-grace leases

Lifecycle owns the five-second deadline and can cancel it while A remains in grace. Once the deadline fires, Connection creates a non-cancelable release handle before awaiting Chat physical exit. Attempt-generation fencing cannot supersede this handle.

The release state flow is:

`grace -> release-started -> chat-exited -> world-removal -> world-complete -> owner-closed`

A lease in `grace` cancels the deadline and reuses the current Chat peer. A lease in any later state enters one domain waiter queue. After Chat exit, World publishes its full snapshot without A. A failed publication leaves a zero-page release continuation that retries only the World step at the existing bounded cadence. It cannot recreate Chat or commit A. If no site remains after the accepted empty snapshot, the World owner also completes its own no-demand leave/disposal before domain release closes.

Normal or eventual World completion closes the release handle first and then resolves waiters. The first current waiter starts a fresh atomic domain attempt; coalesced same-domain leases share its result. This ordering prevents an old release from publishing `sites - A` after a new A is already committed.

### 5. Existing contracts compose at their current authority boundaries

Page connection completion still settles from the current committed Chat connection plus accepted World contribution and local-session snapshot. An ordinary same-domain document replacement/page-context refresh does not start grace and therefore reuses the current scoped peers. A return during actual grace also reuses them. A return after release creates a new Chat peer and reuses the dedicated World peer when another site retains it; if no site retains World demand, the same attempt creates a fresh World peer.

History remains bound only to accepted Chat source incarnations. World peer creation, World site publication, page attachment, and History termination do not create a History synchronization. History remains independent of ready and connection retry.

Document terminal exit and BFCache suspension still release only the page lease after silencing page feedback. They do not directly dispose a peer. The domain peer lifecycle changes only when the shared Lifecycle owner determines that the last lease entered or completed grace.

### 6. Delivery is one clean-cut internal replacement

The source change will update physical provider composition, internal scope metadata, tests, and architecture documentation together. The finished candidate will contain only the scope-keyed peer owners and their current fields, fixtures, and assertions. There is no persisted data conversion and no peer protocol negotiation because neither contract changes.

## Risks / Trade-offs

- [Stop-before-start creates a brief current-domain outage] -> Keep the Domain outage and reconnecting/unavailable truth scoped to that Domain. Automatic Domain replacement leaves World live; the separately owned AppButton World child follows its own stop-before-start lifecycle and remains outside Domain result and UI ownership.
- [One side of an initial attempt can reach the network before the other] -> Keep both sides provisional locally, compensate only attempt-owned facts, and generation-fence all late work.
- [World removal can fail after the final page disappears] -> Retain one bounded zero-page release owner that retries only the remaining World step and releases its resources after settlement.
- [A new lease can wait behind a slow release] -> Preserve strict causal ordering and existing feedback; starting early would permit the old release to erase the new site.
- [Physical and logical identities can be confused] -> Give the replacement a new `peerId` and `sessionId` while Session alone preserves `presenceId` and `joinedAt`; cover both sides with structural and behavioral tests.
- [A transport facade can hide a shared peer internally] -> Require scope-keyed owner and identity assertions plus residue checks proving no peer joins more than its one allowed room.

## Migration Plan

1. Land this authority as the first docs-only exact on the requirement branch and Draft PR.
2. Add candidate-sensitive structural and deterministic lifecycle controls against the current source before implementation.
3. Replace provider composition and domain orchestration in one source candidate, deleting the prior physical owner path in the same change.
4. Update the maintained architecture artifact and run exact-bound source, OpenSpec, Review, CI, and nonblocking browser gates on the same PR.

There is no data or peer-wire migration. Before merge, rollback is a normal revert of the source candidate and its matching docs; no compatibility mode or dual deployment is permitted.
