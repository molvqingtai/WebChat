## Why

A WebChat domain can be open in several browser tabs while the user is viewing only one content document. New Danmaku belongs only to the locally visible page, but document visibility must not become another Danmaku lifecycle owner: switching away and immediately back must not clear an item that was already playing.

## What Changes

- At each otherwise-eligible live delivery, push to the local Danmaku manager only when the existing Danmaku configuration is enabled and exact `document.visibilityState === 'visible'`.
- Drop Danmaku deliveries observed while the document is non-visible instead of queueing or replaying them.
- Let visibility changes perform no mount, unmount, clear, pause, resume, or restart action on the existing manager or any already accepted Danmaku.
- When the document becomes visible again, allow only later new eligible deliveries while already accepted items remain governed by the unchanged Danmaku runtime.
- Read visibility directly inside each content document at admission time without a visibility lifecycle owner, browser-tab enumeration, background tab queries, cross-tab coordination, persistence, or protocol changes.
- Preserve message delivery and history, WebChat panel state, unread attention, browser notifications, and the existing Danmaku setting UI and persistence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Gate each new Danmaku push by document-local visibility without changing the existing Danmaku lifecycle.

## Impact

- Affected behavior: admission of new Danmaku in visible and non-visible content documents, including several same-domain tabs.
- Affected implementation: one direct content-document visibility read at the existing live-message push boundary.
- Affected verification: visible and non-visible admission, preservation of already accepted items across visibility changes, hidden delivery, return to visibility, configuration precedence, and same-domain tab independence.
- Unchanged: Danmaku setting UI and persistence, eligible message classes and content, Chat list/history, AppButton and shell open state, unread attention, notifications, Runtime networking, peer protocol, public APIs, extension permissions, and dependencies.
