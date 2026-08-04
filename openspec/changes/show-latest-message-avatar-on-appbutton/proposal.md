## Why

The AppButton should identify the person who just sent a message without making the user open or inspect the shell. The result needs two lifetimes: a brief acknowledgement while the conversation is already visible, and a persistent identity while the message remains unread.

## What Changes

- Use the same first-delivered remote-text boundary that owns unread attention to select one latest AppButton author per WebChat domain.
- While the shared shell is expanded, replace the daily launcher logo with that author's avatar for exactly `1,000ms` from the latest eligible delivery, then restore the daily logo.
- While the shared shell is collapsed, replace the daily logo with the latest unread author's avatar until the shell expands and clears unread.
- Let every newer eligible delivery replace the current avatar immediately. It starts its own expanded `1,000ms` lifetime or becomes the collapsed persistent unread avatar; it never waits for an earlier author's lifetime.
- Allow the inner logo/avatar replacement to use one launcher-scoped same-document View Transition. That animation cannot queue delivery, extend the one-second lifetime, capture another launcher surface, or block the immediate state update; reduced-motion, unavailable, or rejected transition paths update directly.
- Synchronize the selected author and any live expanded deadline across same-domain AppButtons while isolating other domains. Hydration cannot restore an expired or already-read avatar.
- Keep the existing count-free unread badge, launcher geometry, drag/menu/open interactions, daily logo, notification policy, message delivery, and browser behavior unchanged outside this avatar projection.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Project the latest eligible remote author on the AppButton with one superseding expanded timer and one collapsed unread lifetime.

## Impact

- Affected behavior: the AppButton's inner visual while receiving first-delivered remote text, including bursts from the same or different authors, same-domain synchronization, collapse, reopen, hydration, and expiry.
- Affected implementation: the existing AppStatus owner, its same-domain synchronization and persistence boundary, and the existing AppButton renderer.
- Affected verification: eligible delivery, exact `1,000ms` expiry, immediate replacement, stale-expiry fencing, collapsed persistence, reopen clearing, same-domain isolation, avatar fallback, scoped View Transition behavior, and unchanged badge/launcher interactions.
- Unchanged: message content, history, ordering, durable insertion, notification eligibility or presentation, barrage, Runtime networking, protocol, public APIs, permissions, dependencies, and cross-domain isolation.
