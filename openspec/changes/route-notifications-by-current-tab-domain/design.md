## Context

`NotificationDomain` owns message-level eligibility because it already consumes the first-delivered text event together with the current user's notification-enabled and notification-type settings. The Notification service owns browser attention lookup and the `browser.notifications` side effect because it already holds the browser tab, window, and notification capabilities. The current provider RPC and request-local failure isolation remain the only notification delivery path.

See `proposal.md` for the product motivation and `specs/webrtc-runtime/spec.md` for the observable contract.

## Goals / Non-Goals

**Goals:**

- Preserve one message-level eligibility owner and one browser-notification side-effect owner.
- Take one fresh, bounded snapshot of the tab the user is currently viewing for each eligible remote text.
- Suppress only on established equality between the message domain and that currently viewed tab's domain.
- Keep the decision free of tab/window mutations and preserve exactly-once notification delivery and request-local failure isolation.

**Non-Goals:**

- Adding notification settings, UI copy, permissions, public APIs, state owners, retries, caches, or dependencies.
- Changing message delivery, persistence, history, projection, unread, barrage, Runtime, protocol, or peer behavior.
- Changing notification title/body/icon, notification-click behavior, or any explicit user-initiated tab focus behavior after a notification exists.
- Adding alternate notification implementations or browser-specific business policy.

## Decisions

### 1. Preserve the existing two-owner boundary

Message-level gates remain in `NotificationDomain`: enabled/disabled, `All message` versus `Only @self`, current-user mention, self-authored exclusion, and first-delivery ownership. Browser attention and OS notification creation remain in the Notification service. This keeps user/message truth out of the browser adapter and browser window/tab truth out of the application Domain.

No new Domain, Extern, state, event, cache, or coordinator is introduced. The existing ownership boundary keeps user/message policy in the application Domain and browser window/tab truth in the browser service.

### 2. Resolve one current browsing tab at request time

For each admitted message, the service resolves the focused browser window and its single current highlighted/active tab through supported WebExtension APIs. It does not query every window's active tab as interchangeable attention and does not cache focus or tab state between messages. Only the tab the user is currently viewing participates in suppression.

A fresh request-time snapshot is the smallest authority that follows user attention without adding subscriptions or a second state copy. If no focused window or comparable current tab is available, equality is not established and the eligible message proceeds to notification creation.

### 3. Use the existing WebChat domain identity and exact equality

The message context and current tab are reduced through the existing WebChat domain/origin identity. Only exact equality suppresses. The implementation does not infer domain equality from titles, partial host strings, unrelated tabs, retained state, or alternate fields. An unavailable or invalid current-tab domain therefore cannot silently suppress an eligible notification.

### 4. Keep eligibility read-only with respect to tabs

The request-time attention lookup is read-only. Neither the equal-domain suppression path nor the different-domain creation path updates tabs or windows. The existing click listeners remain separate and may preserve their current user-initiated behavior only after a notification has been created and the user interacts with it.

### 5. Bind verification to observable boundaries

Deterministic controls cover the existing setting/type gates, focused versus unfocused windows, same versus different domains, absent or invalid current-tab context, self/history/duplicate exclusions, exactly-once creation, and zero tab/window mutation. Failure controls prove one rejected notification remains request-local and a later healthy request still succeeds. Chrome MV3 and Firefox MV2 use the same product contract without browser-specific business branches.

## Risks / Trade-offs

- [Focus can change immediately after the snapshot] -> Each message uses one atomic product decision based on the request-time snapshot; no cached attention state or delayed re-evaluation is introduced.
- [Several windows can each contain an active tab] -> Only the focused window's currently viewed tab is authoritative; unfocused-window tabs cannot suppress attention.
- [The current tab can lack a comparable WebChat domain] -> Only proven equality suppresses, so the eligible message notifies instead of being silently lost.
- [Browser notification creation can reject] -> Preserve the existing request-local diagnostic and failure isolation; do not retry or affect chat delivery.
