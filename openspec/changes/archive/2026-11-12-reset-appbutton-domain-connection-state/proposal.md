## Why

AppButton Refresh is the manual connection-refresh action for the current Domain. Its current contract fully rebuilds that Domain's Chat connection while deliberately preserving the singleton World connection. A stale or unhealthy World membership and its projected site list can therefore survive the user's explicit refresh, even though the product needs that same action to refresh both room connections without adding another World control or World loading surface.

## What Changes

- Make every accepted ready-state AppButton Refresh start two independently fenced operations concurrently: fully rebuild the current Domain's Chat connection and fully rebuild the singleton World connection.
- Keep the current Domain's complete reset contract: Chat transport owner/peer and trusted room membership; Connection attempts/generations/readiness; Session state; History synchronization; volatile Delivery state; pending leaves; observer/presence tombstones; member snapshot; baseline/catch-up facts; and every domain-scoped recovery timer, cache, queue, callback, or fence cannot survive into the replacement.
- Re-enter the existing canonical current-domain join and member synchronization path after the reset instead of adding a repair-only join, replay, fallback, or compatibility path.
- Rotate the physical `peerId` and `sessionId` while preserving the active local logical `presenceId` and `joinedAt`; the latter are logical-presence identity, not inherited remote connection state.
- Modify the existing v5 SESSION lifecycle requirement across reconnect, automatic recovery, page attach/reattach, grace return, and supported host recovery: replace its absolute post-expiry non-resurrection rule so an observer-stale `ended` record cannot reject a strictly matching logical presence when a current trusted source proves a new physical session binding. Superseded room/source work, the ended physical `sessionId`, identity/time mutation, and truly stale replay remain rejected.
- Make the World operation perform a real physical leave and settled disposal of the old World owner, trusted membership, generation-owned work, remote presence projection, pending publications, queues, timers, callbacks, and recovery facts before a canonical World join establishes a fresh physical generation. Preserve the active Domain registrations and World demand, then publish their one current full presence snapshot through the new generation and rebuild the World list only from current-generation facts.
- Keep the current Domain refresh as the sole owner of the AppButton disabled/loading state, completion, and error presentation. World loading, progress, completion, and error SHALL remain absent from the UI; World settlement SHALL neither delay nor change the Domain result, and a Domain terminal SHALL not cancel the World operation.
- Coalesce the manual World child with any current automatic recovery or prior manual replacement through one current in-flight World operation. Keep the pre-ready AppButton Retry path, automatic World recovery ownership, other automatic connection paths, every other Domain Chat connection, and other UI behavior unchanged.
- Preserve persistent message history, user identity and settings, the current page, page leases, active World registrations, and every other Domain. Re-publish the refreshed Domain presence and the current complete World snapshot through their respective replacement connections.
- Keep peer wire messages, schemas, codecs, versions, room identifiers, the public `ChatRoom` interface, and peer compatibility unchanged.
- Require deterministic controls for Domain and World physical identity replacement, stop-before-start settlement, current-generation snapshot reconstruction, UI/result isolation, overlap coalescing, complete-state destruction, preserved registrations/data, cross-Domain isolation, and lifecycle-path audit regressions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define one ready-state AppButton Refresh as concurrent, independently settled clean replacements of the current Domain and singleton World connections while only the Domain operation owns UI feedback; retain the common same-presence physical-rebind classifier and stale-generation rejection.
- `world-room-presence`: Add explicit manual World leave/rejoin through AppButton Refresh while preserving the active registration registry, canonical full-snapshot publication, automatic self-recovery, and source-free projected list.

## Impact

- Current-Domain and singleton-World Runtime-private transport/Wire, Connection, Session, History, Delivery, World, and recovery cleanup/attempt orchestration; Lifecycle keeps the same page lease and the AppButton UI keeps one Domain-owned reconnect request.
- Focused Runtime and application integration tests for complete Domain/World teardown, clean resynchronization, full World republish, UI/result isolation, overlap coalescing, same-domain convergence, cross-Domain isolation, preserved data/registrations, every legitimate same-presence rebinding lifecycle, and true stale-generation rejection.
- No external protocol, public API, persisted message schema, dependency, browser manifest, UI layout, or cross-domain behavior change.
