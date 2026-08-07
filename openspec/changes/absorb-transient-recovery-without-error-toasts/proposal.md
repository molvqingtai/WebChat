## Why

Connection lifecycle and error presentation answer different questions. Current generation, Room, revision, page, and continuation facts decide whether work retries, becomes ready, settles, or is canceled. Every distinct real local failure still matters to users on every current affected page and must retain its original message. Conflating those concerns either hides failures or lets presentation state control connection work.

The browser also has two different restart boundaries. Normal Chrome and Edge MV3 Background idle/restart preserves the Offscreen Runtime and Rooms, while a full extension reload permanently separates an old Content document from the new extension generation. The product must preserve the former and expose the latter through bounded, visible polling without automatic refresh or injection.

## What Changes

- Make connection recovery depend only on current structural lifecycle facts, never error content.
- Keep lifecycle owner, retry, iterator, error delivery, Room-attempt handle, and cleanup step state inside the current live generation; do not add durable lifecycle state.
- Preserve Chrome and Edge Offscreen Runtime work across normal MV3 Background idle/restart and keep Firefox on its persistent Background Runtime.
- Keep an old document non-ready after full extension reload and continue ordinary bounded polling until refresh, navigation, close, or supersession.
- Give each Chat and World attempt ownership only of an optional handle it created but has not committed.
- Route every Presence publication through one World iterator; preserve the Room, attempted results, and ready or release continuation when only the revision is superseded.
- Treat an exact live domain-release continuation as World demand so last-page release publishes Presence and completes without a page binding.
- Treat `room.send()` return as local acceptance, never retry a target that throws, and keep remote non-delivery or missing History as no-result.
- Create a fresh original-message toast for every distinct real local failure on every current affected page; do not suppress, merge, update, throttle, normalize, or rewrite it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Connection ownership, browser restart behavior, Room recovery, Presence publication, domain release, send settlement, and error delivery follow current-generation structural state with transparent original-message failures.

## Impact

- Affected behavior: Content binding and readiness, Chrome and Edge MV3 wake, Firefox persistent Runtime, full extension reload, Chat and World recovery, Presence revisions, domain and host release, target sends, History response windows, and error toasts.
- Affected implementation: Background bootstrap, physical Runtime coordination, page leases and callbacks, Room-attempt cleanup, the World target iterator, live release steps, send settlement, and current-route error delivery.
- Affected verification: worker wake, full reload, Runtime replacement, page supersession, Room failure and cleanup, revision supersession, last-page release, target failure, History no-result, original-message toast fan-out, and zero durable lifecycle state.
- Unchanged: canonical message data and ordering, Room trust rules, Runtime networking protocols, permissions, manifest behavior, dependencies, and remote delivery guarantees.
