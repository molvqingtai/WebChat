## Why

A chat with stored history should open directly at its latest message. The initial content must not become visible at the top and then animate or sweep to the bottom, and later messages must not pull a user away from history they are reading.

## What Changes

- Keep the existing ScrollArea shell present, but mount the virtual message list only after canonical history loading is complete and the actual Radix viewport exists.
- Keep the presentational message-list UI pure: the business composition layer renders `null` while loading and the complete records once ready, so the list mounts on content presence plus the real viewport without receiving any business readiness fact.
- Give the first mount the complete canonical history and the real scroll parent so its first non-empty visible frame is already aligned at the latest message with no initial top-to-bottom scroll or live-follow animation.
- Leave a complete history that fits within the actual viewport at its natural position with no forced end alignment, block-size declaration, or settlement scroll.
- Treat initial positioning and later live appends as separate behaviors.
- Smooth-follow a later append only when the list was already at the bottom; otherwise preserve the user's reading position.
- Let an empty loaded history mount normally and accept its first later message without a special initialization path.
- Add no loading UI, readiness or scroll-state copy, effect-driven positioning, timer, animation-frame workaround, imperative post-mount scroll, dependency, or commercial package migration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define stable initial message-list positioning and bottom-aware live append following.

## Impact

- Affected behavior: the first visible message-list frame after canonical history loads, later appends while the user is at or away from the bottom, empty history, and scroll-viewport replacement.
- Affected implementation: the existing MessageList/ScrollArea composition, its callback-ref viewport handle, Virtuoso's initial position, and its live follow decision.
- Affected verification: both readiness gates, first-frame end alignment without scrolling, bottom and non-bottom appends, empty and short histories, variable-height rows, and stable list identity after mount.
- Unchanged: canonical message data, ordering, grouping and row keys, durable history, composer behavior, shell geometry, Runtime networking, protocol, persistence, permissions, dependencies, and browser-specific product behavior.
