## 1. Freeze Current Authority

- [x] 1.1 Define one dedicated World peer that joins only World and one dedicated Chat peer per active or grace-retained domain that joins only its Chat room.
- [x] 1.2 Define the repeatable atomic initial-attempt loop, provenance-owned rollback, stop-before-start replacement, immediate ready commit, and independent per-source History trigger.
- [x] 1.3 Define five-second grace reuse, non-cancelable release-started ownership, queued leases, zero-page World continuation, and release-completion gating before rebuild.
- [x] 1.4 Freeze the external peer schema, codec, namespace, room ids, payloads, persistence, public `ChatRoom` port, and UI as unchanged, with no alternate shared-peer path or compatibility logic.

## 2. Establish Candidate-Sensitive Controls

- [x] 2.1 Add structural controls requiring exact World and `chat(domain)` scoped owners with one allowed room, peer identity, restart owner, and callback generation each.
- [x] 2.2 Add deterministic controls for initial World/Chat partial success, repeated failure, provenance cleanup, bounded retry, and atomic local commit.
- [x] 2.3 Add deterministic controls for stop-before-start replacement, fresh physical identity, stable logical presence, other-domain isolation, stale-generation fencing, immediate ready, and exactly-once History triggering.
- [x] 2.4 Add deterministic controls for lease arrival during grace, lease arrival after release starts, World-removal failure with zero pages, waiter release, and final-site World disposal.

## 3. Replace Physical Peer Composition

- [x] 3.1 Replace provider composition with one World peer owner and a keyed set of per-domain Chat peer owners while keeping Artico behind the Runtime-private transport boundary.
- [x] 3.2 Route typed internal World and `chat(domain)` operations plus callbacks to the exact scoped owner; keep trusted room/source validation, queues, and provider translation in `WireDomain`.
- [x] 3.3 Enforce one allowed room, one peer generation, and one restart owner per scope; prove the finished source contains no host-wide peer identity, shared desired-room set, shared restart, fallback, flag, adapter, fixture, or dual path.
- [x] 3.4 Preserve same-owner demand repair and bounded close recovery while fencing callbacks, timers, joins, leaves, and disposal by both scope and generation.

## 4. Implement Atomic Domain Attempts And Replacement

- [x] 4.1 Give `ConnectionDomain` one per-domain attempt handle with generation, World provenance, staged results, cancellation fencing, and physically settled cleanup.
- [x] 4.2 Stage A's World contribution and Chat candidate through their existing owners, commit both current results together, and compensate only attempt-owned partial acceptance on failure.
- [x] 4.3 Dispose an attempt-created uncommitted World peer exactly once, preserve reused or committed World plus other domains, and feed every cleaned initial failure into the same bounded N+1 retry loop.
- [x] 4.4 Serialize reconnect and automatic recovery per domain, await old Chat physical exit before creating the replacement, rotate `peerId`/`sessionId`, and preserve `presenceId`/`joinedAt`.
- [x] 4.5 Make commit the sole ready transition and trigger one independent History synchronization for each accepted remote Chat source incarnation without a History-to-ready or History-to-retry edge.

## 5. Implement Grace And Release Ordering

- [x] 5.1 Keep the current Chat peer and World contribution through the exact five-second grace; cancel grace and reuse that generation when a lease returns before release starts.
- [x] 5.2 Create the release owner at grace expiry before awaiting Chat physical exit, make it immune to attempt-generation supersession, and queue every later same-domain lease.
- [x] 5.3 After Chat exit, publish the full World snapshot without A and retain one zero-page bounded continuation that retries only the remaining World completion step.
- [x] 5.4 Close the release owner only after World completion and any final no-demand World disposal, then resolve queued leases into one fresh atomic domain attempt.

## 6. Verify And Deliver One Clean Cut

- [x] 6.1 Update the maintained architecture source and generated HTML to show the dedicated World peer, per-domain Chat peers, atomic attempt, replacement, History side work, and release-completion gate.
- [x] 6.2 Prove same-domain page sharing; concurrent A/B/C isolation; World aggregation; repeated World/Chat failures; replacement failure; stale work; History success/failure/cancellation; grace; queued leases; and zero-page release continuation in focused and full deterministic suites.
- [x] 6.3 Prove external peer protocol source, schemas, codec, namespaces, room ids, payload fixtures, canonical bytes, public `ChatRoom` port, persistence, dependencies, and user-facing UI/copy are unchanged.
- [x] 6.4 Run the repository's complete source tests, typecheck, format, lint, Chrome/Firefox production builds, strict OpenSpec/status/doctor, architecture validation/regeneration, scope, identity, current-only residue, and clean-worktree gates on one immutable exact.
- [x] 6.5 Obtain fresh architecture-first Inspector review, exact CI, and nonblocking real Chrome/Firefox behavior observations; report every unreached case as BLOCKED or unverified rather than PASS.
- [x] 6.6 Continue implementation, correction, review, and acceptance on this requirement's one branch and Draft PR; merge only after the Owner's acceptance/authorization and final exact gates.
