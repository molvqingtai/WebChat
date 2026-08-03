## Why

Every same-domain surface represents the same WebChat AppButton and needs one consistent open state, placement, and unread-attention truth. Edge-relative placement must remain meaningful across different window sizes, the expanded shell must not cross the viewport top when it is dragged upward, and collapsed surfaces need one shared visible signal for eligible remote text.

## What Changes

- Give each WebChat domain one shared AppButton status containing `open`, position, and unread attention.
- Synchronize every open or collapse action across all same-domain tabs. Opening the domain clears its unread attention everywhere; collapsing it leaves the domain ready for the next eligible remote text.
- Mark unread only when a first-delivered remote text reaches a collapsed domain. An expanded domain is already presenting the conversation and remains read.
- Represent position from the bottom-left edge while the AppButton is in the left half of the viewport and from the bottom-right edge while it is in the right half. Crossing the midpoint changes the anchor without moving the rendered button away from the pointer.
- Reproject the saved edge-relative position against each viewport while preserving the `44x44px` launcher's fixed bounds: its center stays at least `50px` from either horizontal edge (`28px` outer-edge margin) and its bottom edge stays at least `22px` above the viewport bottom whenever the viewport can satisfy those margins. A smaller viewport uses only its nearest fully visible local bound; resizing leaves the shared position unchanged and performs no persistence write.
- While WebChat is expanded, apply one additional local vertical bound so upward dragging, opening or reopening, and viewport resizing keep the shell's top edge at least `40px` below the viewport top. The result applies at either horizontal anchor and every supported shell width without rewriting the shared position merely because local projection changed.
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

- Affected behavior: AppButton and expanded-shell placement, dragging, unread attention, and badge visibility across multiple tabs and viewport sizes of the same or different WebChat domains.
- Affected implementation: the existing AppStatus owner, its same-domain synchronization boundary, the single local placement projection, and the AppButton badge projection.
- Affected verification: deterministic whole-status synchronization, responsive edge and expanded-shell projection, midpoint crossing, drag continuity, reopen and resize behavior, collapsed and expanded delivery, read clearing, field-write isolation, exclusion, focus/highlight/settings independence, and indicator-presentation controls.
- Unchanged: message content and history, notification eligibility and presentation, barrage, Runtime networking, peer protocol, public APIs, permissions, dependencies, and cross-domain isolation.
