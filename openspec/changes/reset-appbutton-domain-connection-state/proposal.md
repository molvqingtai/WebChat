## Why

AppButton Refresh currently replaces the current domain's physical Chat peer but can retain old remote-presence observer state. An `ended` tombstone can then reject a valid SESSION from a still-online member, leaving the refreshed member snapshot stale until the domain is fully released and reopened.

## What Changes

- Make every accepted AppButton Refresh fully destroy the current domain's complete connection state before rebuilding it: Chat transport owner/peer and trusted room membership; Connection attempts/generations/readiness; Session state; History synchronization; volatile Delivery state; pending leaves; observer/presence tombstones; member snapshot; baseline/catch-up facts; and every domain-scoped recovery timer, cache, queue, callback, or fence cannot survive into the replacement.
- Re-enter the existing canonical current-domain join and member synchronization path after the reset instead of adding a repair-only join, replay, fallback, or compatibility path.
- Rotate the physical `peerId` and `sessionId` while preserving the active local logical `presenceId` and `joinedAt`; the latter are logical-presence identity, not inherited remote connection state.
- Modify the existing v5 SESSION lifecycle requirement across reconnect, automatic recovery, page attach/reattach, grace return, and supported host recovery: replace its absolute post-expiry non-resurrection rule so an observer-stale `ended` record cannot reject a strictly matching logical presence when a current trusted source proves a new physical session binding. Superseded room/source work, the ended physical `sessionId`, identity/time mutation, and truly stale replay remain rejected.
- Preserve persistent message history, user identity and settings, the current page, the shared World peer, and every other domain. Re-publish only the refreshed domain's presence and converge all same-domain pages to its new snapshot.
- Keep peer wire messages, schemas, codecs, versions, room identifiers, the public `ChatRoom` interface, and peer compatibility unchanged.
- Require a deterministic fail-before control reproducing healthy room size 4, stale local size 3 after the old Refresh path, and size 4 after a clean rebuild, plus complete-state destruction, isolation, preserved-data, and lifecycle-path audit regressions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define AppButton Refresh as complete current-domain connection destruction followed by canonical join/member synchronization, and correct the common same-presence physical-rebind classifier across every lifecycle entry while preserving stale-generation rejection.

## Impact

- Current-domain Runtime-private transport/Wire, Connection, Session, History, Delivery, and recovery cleanup/attempt orchestration; Lifecycle keeps the same page lease and only reflects one reconnect request.
- Focused Runtime and application integration tests for stale observer correction, complete domain-connection teardown, clean resynchronization, same-domain convergence, cross-domain/World isolation, preserved data, every legitimate same-presence rebinding lifecycle, and true stale-generation rejection.
- No external protocol, public API, persisted message schema, dependency, browser manifest, UI layout, or cross-domain behavior change.
