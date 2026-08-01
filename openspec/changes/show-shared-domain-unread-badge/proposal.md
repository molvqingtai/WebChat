## Why

Same-domain tabs need one consistent AppButton placement and one consistent unread-attention truth while retaining independent expanded or collapsed panels. Edge-relative placement must remain meaningful across different window sizes, and an incoming remote text must remain visible as attention on every collapsed surface until one collapsed same-domain tab is expanded.

## What Changes

- Give each WebChat domain one shared AppButton status containing position and unread attention while keeping every tab's expanded or collapsed shell state independent.
- Represent position from the bottom-left edge while the AppButton is in the left half of the viewport and from the bottom-right edge while it is in the right half. Crossing the midpoint changes the anchor without moving the rendered button away from the pointer.
- Reproject the saved edge-relative position against each viewport and keep the AppButton visible through bounds derived from the current viewport. Resizing leaves the shared position unchanged and performs no persistence write.
- Preserve the current hand-control drag interaction: continuous animation-frame pointer following, bounded movement, selection suppression, and grab cursor, with no snap, rebound, easing, or release-behavior change.
- Mark the domain unread for each first-delivered remote text regardless of which same-domain tab wins durable insertion or whether that winning tab is already expanded.
- Show the AppButton badge only in same-domain tabs whose own panel is collapsed. An already expanded tab shows no badge and does not clear badges from collapsed siblings merely by remaining expanded.
- Treat a user-driven collapsed-to-expanded transition as reading the domain and clear the shared attention from every same-domain tab. Other domains remain unchanged.
- Preserve zero unread attention for self-authored text, history application, and duplicate delivery. Browser-notification enabled/type settings do not participate in unread eligibility.
- Keep the AppButton indicator count-free: a top-right orange ping with an opaque orange center and a short opacity presence transition.
- Make position and unread writes field-scoped so either shared fact can change without overwriting the other.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define domain-shared AppButton position and unread attention, tab-local open and badge projection, responsive edge anchoring, read clearing, eligibility, and the fixed interaction and indicator results.

## Impact

- Affected behavior: AppButton placement, dragging, unread attention, and badge visibility across multiple tabs and viewport sizes of the same or different WebChat domains.
- Affected implementation: the existing AppStatus owner, its same-domain synchronization boundary, the draggable position projection, and the existing AppButton badge projection.
- Affected verification: deterministic same-domain position synchronization, responsive edge projection, midpoint crossing, drag continuity, multi-tab delivery, read clearing, field-write isolation, exclusion, settings-independence, and indicator-presentation controls.
- Unchanged: message content and history, notification eligibility and presentation, barrage, Runtime networking, peer protocol, public APIs, permissions, dependencies, and cross-domain isolation.
