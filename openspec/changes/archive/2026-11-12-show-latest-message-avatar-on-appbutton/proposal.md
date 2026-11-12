## Why

The AppButton should identify the person who just sent a message without making the user open or inspect the shell. The result needs two lifetimes: a brief acknowledgement while the conversation is already visible, and a persistent identity while the message remains unread.

## What Changes

- Use the same first-delivered remote-text boundary that owns unread attention to select one latest AppButton author per WebChat domain.
- While the shared shell is expanded, select that author's avatar for exactly `1,000ms` from the latest eligible delivery, fading from and then back to the daily launcher logo.
- While the shared shell is collapsed, fade from the daily logo to the latest unread author's avatar until the shell expands and clears unread.
- Let every newer eligible delivery select the current author and begin its fade immediately. It starts its own expanded `1,000ms` lifetime or becomes the collapsed persistent unread avatar; it never waits for an earlier author's lifetime or fade.
- Fade every visible inner identity change with the project's existing Motion runtime: daily logo to author, one author to another, and author back to daily logo. The fade cannot queue delivery, extend the one-second lifetime, include another launcher surface, or block the immediate state update; reduced-motion settles the final identity directly.
- Share the selected author and any live expanded deadline across same-domain AppButtons while isolating other domains. A synchronizing surface applies the latest accepted state immediately; a paused or delayed surface may briefly retain its last observation, but must converge when synchronization resumes without restarting an expired or already-read avatar.
- Keep the existing count-free unread badge, launcher geometry, drag/menu/open interactions, daily logo, notification policy, message delivery, and browser behavior unchanged outside this avatar projection.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Project the latest eligible remote author on the AppButton with one superseding expanded timer and one collapsed unread lifetime.

## Impact

- Affected behavior: the AppButton's inner visual while receiving first-delivered remote text, including bursts from the same or different authors, same-domain convergence, collapse, reopen, hydration, and expiry.
- Affected implementation: the existing AppStatus owner, its same-domain synchronization and persistence boundary, and the existing AppButton renderer.
- Affected verification: eligible delivery, exact `1,000ms` expiry, immediate state supersession, stale-expiry fencing, collapsed persistence, reopen clearing, resumed same-domain convergence, cross-domain isolation, avatar fallback, Motion opacity fades in every identity-change direction, rapid fade supersession, reduced-motion settlement, and unchanged badge/launcher interactions.
- Unchanged: message content, history, ordering, durable insertion, notification eligibility or presentation, barrage, Runtime networking, protocol, public APIs, permissions, dependencies, and cross-domain isolation.
