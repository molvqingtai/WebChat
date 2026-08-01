## Why

An incoming remote text needs to remain visible as attention on every collapsed WebChat surface for its domain. An already expanded same-domain tab must neither show a badge nor consume the attention needed by collapsed sibling tabs, and reading from one collapsed tab must clear that attention consistently across the domain.

## What Changes

- Give each WebChat domain one shared unread-attention truth while keeping every tab's expanded or collapsed shell state independent.
- Mark the domain unread for each first-delivered remote text regardless of which same-domain tab wins durable insertion or whether that winning tab is already expanded.
- Show the AppButton badge only in same-domain tabs whose own panel is collapsed. An already expanded tab shows no badge and does not clear badges from collapsed siblings merely by remaining expanded.
- Treat a user-driven collapsed-to-expanded transition as reading the domain and clear the shared attention from every same-domain tab. Other domains remain unchanged.
- Preserve zero unread attention for self-authored text, history application, and duplicate delivery. Browser-notification enabled/type settings do not participate in unread eligibility.
- Keep the AppButton indicator count-free: a top-right orange ping with an opaque orange center and a short opacity presence transition.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define domain-shared unread attention, tab-local badge projection, read clearing, eligibility, and the fixed AppButton indicator result.

## Impact

- Affected behavior: unread attention and AppButton badge visibility across multiple tabs of the same or different WebChat domains.
- Affected implementation: the existing AppStatus owner, its origin-local synchronization boundary, and the existing AppButton badge projection.
- Affected verification: deterministic multi-tab/domain delivery, read clearing, concurrency, exclusion, settings-independence, and indicator-presentation controls.
- Unchanged: message content and history, notification eligibility and presentation, barrage, Runtime networking, peer protocol, public APIs, permissions, dependencies, and cross-domain isolation.
