## Context

The Notification service already owns browser-notification creation, notification click listeners, and browser tab/window capabilities. A created notification already retains request-lifetime context for the WebChat tab that produced its message. The click action needs only that notification's WebChat domain and a fresh browser tab/window snapshot.

See `proposal.md` for the product motivation and `specs/webrtc-runtime/spec.md` for the observable contract.

## Goals / Non-Goals

**Goals:**

- Keep the Notification service as the sole owner of browser-notification click side effects.
- Match tabs by the existing exact WebChat domain identity.
- Prefer the focused window and choose its rightmost matching tab.
- Fall back to the other-window match with the greatest API-provided `Tab.lastAccessed` value and focus its window.
- Create no tab when no match exists and add no custom tab-ordering state.

**Non-Goals:**

- Changing notification eligibility, settings, title, body, icon, creation count, or request-local creation failure behavior.
- Creating, reloading, navigating, closing, or reordering a tab from a notification click.
- Adding timestamps, persistence, a `tabs.onCreated` ledger, subscriptions, caches, state owners, retries, permissions, public APIs, or dependencies.
- Changing message delivery, history, projection, unread, barrage, Runtime, protocol, peer, connection, or persistence behavior.
- Adding browser-specific product policy.

## Decisions

### 1. Keep click handling in the existing Notification service

The Notification service remains the only owner of the browser click listener, tab inventory, tab activation, and window focus effects. The application Domain continues to own message-level notification eligibility and does not receive browser tab/window state.

No new Domain, Extern, event, coordinator, provider, public API, or state owner is introduced. Notification creation and notification click handling remain separate request paths within the existing service boundary.

### 2. Match the clicked notification's exact WebChat domain

The notification's existing request-lifetime context supplies the message's WebChat domain. At click time, a tab matches only when its current URL resolves to the same valid WebChat domain. Titles, partial host strings, paths, tab IDs retained from creation, unrelated pages, invalid URLs, and missing notification context do not establish a match.

This lets any currently open tab for the domain qualify even when the tab that originally produced the notification no longer exists. It also prevents a stale original tab ID from overriding the user's current browser layout.

### 3. Prefer the focused window and its rightmost match

The click path takes one fresh browser snapshot. If the currently focused window contains matching tabs, only that window participates in selection. The matching tab with the greatest current tab index is the last, rightmost match and is activated. A match in another window cannot override this choice, even when its `lastAccessed` value is greater.

Tab index is already maintained by the browser and directly expresses the Owner-confirmed rightmost ordering. No local order is derived or retained.

### 4. Use `Tab.lastAccessed` only for the other-window fallback

When the focused window contains no match, every matching tab outside that window participates in one fallback selection. WebChat chooses the match with the greatest API-provided `Tab.lastAccessed` value, activates it, and focuses its containing window. If no browser window is focused, all matching tabs participate in this fallback.

`lastAccessed` means most recently accessed or activated. It does not mean creation time. The browser-owned value is the complete ordering input; WebChat does not synthesize, persist, or repair it with a separate timestamp.

### 5. Treat no match as a no-op

If no currently open tab has the clicked notification's valid WebChat domain, the click creates no tab and performs no navigation or window mutation. Missing or invalid notification domain context has the same result because no exact match can be established.

The click action therefore never uses the originating URL as a tab-creation fallback. Notification creation, closure, message delivery, and later healthy notification requests remain independent.

### 6. Verify selection and absence of added state

Deterministic controls bind the clicked notification to a domain and model several tab/window snapshots. They prove focused-window priority, greatest-index selection, other-window greatest-`lastAccessed` selection, required window focus, exact domain matching, and no-match no-op behavior. Controls also prove that notification eligibility and creation remain unchanged and that no custom timestamp, persistence key, creation ledger, subscription, or ordering cache exists.

## Risks / Trade-offs

- [A matching tab in another window was accessed more recently] -> Focused-window priority still wins because the current visible window is the primary user context.
- [Several matching tabs share the focused window] -> The greatest browser tab index gives one visible, deterministic rightmost result without application state.
- [The focused window has no match] -> The browser's current `lastAccessed` facts choose one existing match and its window becomes focused.
- [Notification context or every tab domain is unavailable] -> No equality is established, so the click performs no tab/window mutation and creates no tab.
- [Focus or tab layout changes after the snapshot] -> Each click is one request-time decision; no cached ordering or delayed application state is introduced.
