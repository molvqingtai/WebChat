## Why

Qualified remote messages need attention only when the user is not already viewing that message's WebChat domain. Browser notifications must honor the existing notification settings and the currently viewed highlighted tab without manipulating tabs or distracting the user with duplicate notifications.

## What Changes

- Keep the existing notification-enabled switch authoritative and preserve the existing `All message` / `Only @self` eligibility modes.
- For each first-delivered eligible remote text, compare its WebChat domain with the domain of the tab the user is currently viewing: the highlighted tab in the focused browser window at evaluation time.
- Suppress the browser notification only when those domains are equal. When they differ, or no valid currently viewed tab domain exists, create exactly one browser notification.
- Treat the highlighted tab only as comparison input. Notification eligibility does not activate, highlight, focus, create, reload, or otherwise mutate any tab or window.
- Preserve zero notifications for self-authored messages, history application, duplicate delivery, a disabled notification switch, and non-matching messages under `Only @self`.
- Preserve request-local notification failure isolation and later healthy notification delivery while keeping user-initiated notification clicks outside message eligibility evaluation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define browser-notification eligibility and current-tab domain suppression while preserving exactly-once delivery and failure isolation.

## Impact

- Affected behavior: browser notification eligibility for delivered remote text in Chrome MV3 and Firefox MV2.
- Affected implementation: the existing Notification domain/service boundary and its focused-window/current-tab lookup.
- Affected verification: deterministic controls for the settings gates, current highlighted tab domain comparison, exactly-once notification creation, zero tab mutation, and request-local failure recovery.
- Unchanged: peer protocol, Runtime networking, message persistence, message projection, public APIs, permissions, Options UI, notification content, dependencies, and stored data.
