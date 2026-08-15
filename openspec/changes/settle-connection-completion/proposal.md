## Why

A page can remain permanently stuck on the `Connected to the chat...` loading feedback even after the shared Runtime has physically joined Chat and published the domain's World contribution and projected the local user. A different pending signature leaves the page at zero users before any physical join. Refresh or replacement can reproduce either state because the page operation is rebuilt while shared domain work survives; a return during the existing five-second lifecycle grace also reuses the same domain Chat peer and dedicated World owner.

Exact-bound stage tracing on `develop@d7fa3d386250aee22a740ca84e3cd29dadbbc724` proved that the visible-user signature is a post-commit active Presence persistence tail. It also narrowed the zero-user signature to callback registration, replay, or replay persistence/IndexedDB before connection, without identifying one field request among those three. The page connection operation currently has no terminal deadline or cancellation owner across those waits.

Owner smoke on the repaired source exposed a separate bootstrap ownership defect: an exhausted Runtime control-plane registration logs `Shared runtime unavailable: Runtime control-plane request timed out` and returns before the content script creates its Shadow UI. Read-only source diagnosis also confirmed that browser-sync/local configuration or MessageStore preparation failure silently returns at the same boundary. Bootstrap dependencies may determine which product capabilities are ready, but no bootstrap error may determine whether the existing launcher and openable panel shell exist.

## What Changes

- Give each page connection attempt one finite, generation-owned terminal lifecycle across callback registration, replay, replay persistence, Runtime join, and snapshot acceptance.
- Keep callback registration and replay durability as pre-connection prerequisites, but make timeout, page release, host replacement, and supersession reject or cancel only the matching attempt, clear its loading owner, dispose partial work, and permit a fresh attempt.
- Complete the page connection successfully once the current Runtime generation has physically committed Chat and World and returned a snapshot containing the local session; post-commit active Presence persistence continues independently and cannot retain page loading.
- Bound and fence the per-domain active Presence persistence tail so an unresolved predecessor cannot permanently block later current-generation persistence or final release.
- Mount the existing Shadow UI, launcher, and openable panel shell independently of browser-sync/local configuration, MessageStore, and Runtime bootstrap results; present one visible, accessible, retryable degraded state without unmounting or blanking the shell. A genuine failure owned by the current page uses the existing error route with exactly its original `error.message`; no-page or user-irrelevant failure uses direct `console.error(error)`.
- Ignite each dependency-backed application domain only after its required bootstrap dependency is ready, then recover the same mounted shell in place after a successful retry.
- Preserve the existing five-second same-domain grace, scoped Chat-peer reuse/release, dedicated World contribution ownership, local active-presence cleanup, connection semantics, and stale-request fencing. Final release sends no Chat lifecycle message and owns no end-send settlement chain.
- Keep `pageId` metadata and provider-refresh callback behavior as implementation-neutral diagnostic hypotheses. The change does not prescribe either mechanism.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Add terminal, attempt-owned page connection settlement across pre-connection initialization and post-commit Presence persistence.

## Impact

- Content bootstrap ordering, Runtime page adapter subscription/replay ownership, and focused tests.
- Runtime join completion, active Presence persistence queue ownership, and focused tests.
- Application connection-request terminal settlement and stale-request regressions.
- A new OpenSpec delta for the existing `webrtc-runtime` capability.
- No additional peer message, public `ChatRoom` method, origin-database schema/version, stored message-record shape, Toast identity/duration/presentation lifecycle, readiness-state model, panel visual structure, dependency, WXT, or browser-specific business change. Current-page failure copy follows the unchanged-message route above without decoration or replacement.
