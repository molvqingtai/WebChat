## Why

Every same-domain surface represents the same WebChat AppButton and needs one consistent open state, placement, and unread-attention truth. Edge-relative placement must remain meaningful across different window sizes, and collapsed surfaces need one shared visible signal for eligible remote text.

## What Changes

- Give each WebChat domain one shared AppButton status containing `open`, position, and unread attention.
- Synchronize every open or collapse action across all same-domain tabs. Opening the domain clears its unread attention everywhere; collapsing it leaves the domain ready for the next eligible remote text.
- Mark unread only when a first-delivered remote text reaches a collapsed domain. An expanded domain is already presenting the conversation and remains read.
- Represent position from the bottom-left edge while the AppButton is in the left half of the viewport and from the bottom-right edge while it is in the right half. Crossing the midpoint changes the anchor without moving the rendered button away from the pointer.
- Reproject the saved edge-relative position against each viewport and keep the AppButton visible through bounds derived from the current viewport. Resizing leaves the shared position unchanged and performs no persistence write.
- Preserve the current hand-control drag interaction: continuous animation-frame pointer following, bounded movement, selection suppression, and grab cursor, with no snap, rebound, easing, or release-behavior change.
- Preserve zero unread attention for self-authored text, history application, and duplicate delivery. Browser-window focus, active/highlighted tab, and browser-notification enabled/type settings do not participate in unread eligibility or clearing.
- Keep the AppButton indicator count-free: a top-right orange ping with an opaque orange center and a short opacity presence transition.
- Make open, position, and unread writes field-scoped so one shared fact can change without overwriting the others.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define one fully synchronized same-domain AppButton status, responsive edge anchoring, unread eligibility and clearing, and the fixed interaction and indicator results.

## Impact

- Affected behavior: AppButton placement, dragging, unread attention, and badge visibility across multiple tabs and viewport sizes of the same or different WebChat domains.
- Affected implementation: the existing AppStatus owner, its same-domain synchronization boundary, the draggable position projection, and the AppButton badge projection.
- Affected verification: deterministic whole-status synchronization, responsive edge projection, midpoint crossing, drag continuity, collapsed and expanded delivery, read clearing, field-write isolation, exclusion, focus/highlight/settings independence, and indicator-presentation controls.
- Unchanged: message content and history, notification eligibility and presentation, barrage, Runtime networking, peer protocol, public APIs, permissions, dependencies, and cross-domain isolation.
