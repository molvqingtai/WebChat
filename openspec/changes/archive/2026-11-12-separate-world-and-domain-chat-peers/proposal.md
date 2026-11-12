## Why

A current-domain reconnect or recovery must establish a completely new Chat transport without crossing into another Chat domain or deleting the user's World registration. A ready-state AppButton Refresh additionally replaces the World transport through a separate operation, so the Runtime needs one unambiguous physical peer owner for each network scope and independent closed lifecycles for connection, replacement, and release.

## What Changes

- **BREAKING (internal transport ownership)**: Give the Runtime one dedicated World peer that joins only the World room and one dedicated Chat peer for each active domain that joins only that domain's Chat room. Same-domain pages share their domain's Chat peer; different domains never share a Chat peer.
- Make an initial domain connection one repeatable atomic attempt: stage the domain's World site contribution and Chat candidate, commit both together, and apply provenance-owned rollback plus bounded retry when either side fails.
- Make every current-domain replacement stop and await the old Chat peer's physical exit before a new generation creates and joins its replacement while preserving logical `presenceId` and `joinedAt`. Automatic Domain recovery and non-AppButton retry leave the World physical owner live; a ready-state AppButton Refresh independently starts the sibling World replacement defined by the active manual-refresh contract while preserving World registrations, demand, and every other Domain.
- Treat connection commit as ready immediately. Each accepted source incarnation independently triggers History exactly once; History success, failure, or cancellation never gates ready or peer retry.
- Preserve the five-second last-page grace. A lease during grace cancels release and reuses the current Chat peer; a lease after release starts waits until the old World site-removal publication completes and its release owner closes before a new generation rebuilds the domain.
- Keep the external peer schema, codec, room identifiers, payloads, persistence, public `ChatRoom` port, and UI unchanged. The result contains only this ownership model, with no alternate peer path, compatibility layer, migration, fallback, or dual owner.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define physical World/Chat peer ownership and the atomic per-domain connection, replacement, History, grace, and release lifecycle.

## Impact

- Runtime-private Artico transport composition, peer-generation ownership, domain connection and release orchestration, and internal Runtime snapshots.
- Deterministic tests for multi-domain isolation, atomic attempts, replacement ordering, History triggering, five-second grace, queued leases, release continuation, and stale-generation fencing.
- No peer-wire capability delta, protocol namespace change, dependency, storage migration, public API change, or user-facing UI/copy change.
