## Context

Canonical records and the existing `messageListLoadFinished` fact own message-history readiness. The existing Radix ScrollArea owns the real viewport DOM resource. Virtuoso's initial item location applies only when the list mounts, while its follow behavior applies to later data changes.

The list therefore needs one stable mount boundary: history readiness and the real viewport must both exist before Virtuoso first receives canonical records. Initial positioning must not be implemented as a later live append or as another scrolling lifecycle.

## Goals / Non-Goals

**Goals:**

- Present the first non-empty message-list frame already aligned at the latest canonical message with no visible top-to-bottom motion.
- Use `messageListLoadFinished` as the only history-ready truth and one callback-ref viewport handle as the only scroll-parent resource identity.
- Keep the ScrollArea shell present while either prerequisite is unavailable, without adding visible loading feedback.
- Smooth-follow later appends only when the user was already at the bottom and preserve the reading position otherwise.
- Keep one mounted Virtuoso instance across record updates and support empty, short, long, grouped, and variable-height histories.

**Non-Goals:**

- Changing canonical records, ordering, grouping, row identity, storage, delivery, composer behavior, shell geometry, Runtime, protocol, permissions, or dependencies.
- Adding an initialization boolean, positioned flag, bottom-state copy, second scroll owner, observer, timer, `requestAnimationFrame`, positioning effect, imperative `scrollToIndex`, CSS hiding, opacity gate, or data-driven remount key.
- Replacing Radix ScrollArea, migrating to another virtualizer or a commercial package, or changing browser-specific behavior.
- Adding a loading indicator, placeholder, skeleton, status message, setting, or other UI.

## Decisions

### 1. Join the two existing prerequisites at one mount boundary

The existing `messageListLoadFinished` value remains the sole history-ready fact. The existing MessageList/ScrollArea composition retains one callback-ref-backed `HTMLElement | null` handle for the current Radix viewport. The handle represents DOM resource identity; it is not a second loading or scroll-position truth.

Virtuoso mounts only when history loading is finished and that handle is non-null. A plain mutable ref cannot act as the gate because ref assignment alone does not schedule the render that makes both prerequisites observable. No additional `initialized`, `firstLoad`, `hasPositioned`, or equivalent fact participates.

The ScrollArea shell and viewport remain under their existing owner while the list is gated. The absent list adds no visible loading surface and changes no shell geometry.

### 2. Make the first mount the initial positioning event

The first Virtuoso mount receives the complete current canonical records, the non-null viewport as `customScrollParent`, and the existing last-item/end-aligned initial location. Its first non-empty presented frame is therefore already at the latest message. Initialization does not invoke smooth live following and produces no visible top-to-bottom scroll, sweep, or intermediate top position.

This mount is the only initial-positioning event for that viewport resource. It requires no effect, timer, animation frame, imperative scroll command, hidden render, opacity transition, estimated-height workaround, or separate settlement state.

### 3. Keep one list identity after mount

Canonical record updates do not change the mounted list's key or otherwise remount it. Grouping, row keys, measurement ownership, and the scroll parent keep their existing identities. Only actual destruction or replacement of the Radix viewport resource may remove the list and allow the same two-prerequisite boundary to mount it against the new viewport.

An empty canonical history mounts after both prerequisites are ready. Its first later message enters through normal live append behavior rather than creating another initialization branch or remount.

### 4. Let Virtuoso's bottom fact decide later following

After the stable first mount, Virtuoso's live follow callback uses the `isAtBottom` fact supplied for that append. It returns smooth following only when `isAtBottom` is true and returns no following when it is false. The application retains no duplicate bottom state and issues no automatic or imperative scroll when the user is reading above the bottom.

Initial history application is not a live append. Later text, notice, and grouped-row updates retain their existing canonical projection and use the same bottom-aware decision without message-type exceptions.

### 5. Leave short histories without forced alignment

A complete non-empty history that fits within the actual viewport simply presents its records from their natural position. No `alignToBottom`, minimum block-size declaration, or settlement scroll forces such a history to the viewport bottom; the requirement is only that initialization presents its first frame without scrolling.

### 6. Verify the real composition boundary

Deterministic component controls prove that Virtuoso is absent while either prerequisite is missing, mounts once with complete records and the real viewport when both exist, and remains mounted as records update. Browser Mode controls use the real Radix ScrollArea and Virtuoso composition to prove a first non-empty frame already at the end with no live-follow smooth decision or visible top-to-bottom motion.

The same controls cover empty and short histories (presented without forced end alignment or settlement scroll), overflowing variable-height and grouped rows, one later append at the bottom, and one later append while reading above the bottom. Structural controls exclude extra readiness/position state, positioning effects, timers, animation-frame workarounds, imperative scrolling, CSS visibility gates, observers, runtime height correction loops, data-driven remount keys, and dependency changes.

## Risks / Trade-offs

- [History completes before the viewport exists] -> The ScrollArea remains present and the list waits for the real viewport instead of mounting against a temporary scroll parent.
- [The viewport exists before history completes] -> The list waits for the canonical readiness fact instead of treating later history as a live append.
- [Row heights vary] -> The first mount uses Virtuoso's native last-item/end alignment and existing measurement ownership; no competing correction loop is introduced.
- [A message arrives while the user reads history] -> No follow action occurs, so the user's reading position remains under their control.
- [The actual viewport is replaced] -> Resource lifecycle may remount the list against the new real viewport using the same two prerequisites; record changes alone cannot remount it.

## Open Questions

None.
