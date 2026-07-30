## Why

A page can remain permanently stuck on the `Connected to the chat.` loading feedback even after the shared Runtime has physically joined Chat and World and projected the local user. A different pending signature leaves the page at zero users before any physical join. Refresh or replacement can reproduce either state because the page operation is rebuilt while shared domain work survives; a return during the existing five-second lifecycle grace also reuses the same physical rooms.

Exact-bound stage tracing on `develop@d7fa3d386250aee22a740ca84e3cd29dadbbc724` proved that the visible-user signature is a post-commit active Presence persistence tail. It also narrowed the zero-user signature to callback registration, replay, or replay persistence/IndexedDB before connection, without identifying one field request among those three. The page connection operation currently has no terminal deadline or cancellation owner across those waits.

## What Changes

- Give each page connection attempt one finite, generation-owned terminal lifecycle across callback registration, replay, replay persistence, Runtime join, and snapshot acceptance.
- Keep callback registration and replay durability as pre-connection prerequisites, but make timeout, page release, host replacement, and supersession reject or cancel only the matching attempt, clear its loading owner, dispose partial work, and permit a fresh attempt.
- Complete the page connection successfully once the current Runtime generation has physically committed Chat and World and returned a snapshot containing the local session; post-commit active Presence persistence continues independently and cannot retain page loading.
- Bound and fence the per-domain active Presence persistence tail so an unresolved predecessor cannot permanently block later current-generation persistence or final release.
- Preserve the existing five-second same-domain grace, physical room reuse/release behavior, durable final-retirement ordering, connection semantics, and stale-request fencing.
- Keep `pageId` metadata and provider-refresh callback behavior as implementation-neutral diagnostic hypotheses. The change does not prescribe either mechanism.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Add terminal, attempt-owned page connection settlement across pre-connection initialization and post-commit Presence persistence.

## Impact

- Runtime page adapter subscription/replay ownership and focused tests.
- Runtime join completion, active Presence persistence queue ownership, and focused tests.
- Application connection-request terminal settlement and stale-request regressions.
- A new OpenSpec delta for the existing `webrtc-runtime` capability.
- No peer wire, public `ChatRoom` method, database schema/version, stored record shape, Toast copy/duration, readiness model, panel UI, dependency, WXT, or browser-specific business change.
