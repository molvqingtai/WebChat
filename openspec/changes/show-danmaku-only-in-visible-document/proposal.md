## Why

A WebChat domain can be open in several browser tabs while the user is viewing only one of their content documents. Danmaku belongs to the locally visible page surface, so a non-visible document must neither keep presenting existing Danmaku nor retain messages for presentation when it becomes visible again.

## What Changes

- Enable a local Danmaku surface only when the existing Danmaku configuration is enabled and that content document reports exact `document.visibilityState === 'visible'`.
- Clear every current Danmaku item as soon as the local document becomes non-visible and admit no Danmaku while it remains non-visible.
- Drop otherwise-eligible live Danmaku deliveries observed while non-visible instead of queueing or replaying them.
- When the document becomes visible again, allow only later new eligible deliveries and continue to respect the existing configuration setting.
- Derive the result inside each content document without browser-tab enumeration, background tab queries, cross-tab coordination, persistence, or protocol changes.
- Preserve message delivery and history, WebChat panel state, unread attention, browser notifications, and the existing Danmaku setting UI and persistence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define document-local Danmaku eligibility, immediate clearing on loss of visibility, and no hidden-delivery replay.

## Impact

- Affected behavior: Danmaku presentation in visible and non-visible content documents, including several same-domain tabs.
- Affected implementation: one content-document visibility observation and the existing Danmaku activation, clear, and live-message projection boundary.
- Affected verification: initial visibility, visibility transitions, hidden delivery, return to visibility, configuration precedence, same-domain tab independence, and listener cleanup.
- Unchanged: Danmaku setting UI and persistence, eligible message classes and content, Chat list/history, AppButton and shell open state, unread attention, notifications, Runtime networking, peer protocol, public APIs, extension permissions, and dependencies.
