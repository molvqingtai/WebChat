## Why

Clicking a WebChat browser notification should return the user to an existing tab for that message's WebChat domain. The selection must follow the user's current browser context, avoid duplicate tabs, and require no application-maintained tab ordering state.

## What Changes

- Match the clicked notification's WebChat domain against the valid WebChat domain of every currently open tab.
- Prefer matches in the currently focused browser window. When that window has several matches, activate its last, rightmost match by tab index.
- When the focused window has no match, activate the matching tab in another window with the greatest API-provided `Tab.lastAccessed` value and focus that window.
- When no matching tab exists, create no tab and perform no navigation.
- Use only browser-provided tab/window facts at click time. Add no timestamp field, persisted order, `tabs.onCreated` ledger, ordering cache, or other tracking state.
- Preserve browser-notification eligibility, creation, content, settings, and failure isolation independently from the later click action.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define deterministic existing-tab activation for a user-initiated WebChat browser-notification click.

## Impact

- Affected behavior: tab and window activation after the user clicks a WebChat browser notification in Chrome MV3 and Firefox MV2.
- Affected implementation: the existing Notification service click listener and its browser tab/window lookup.
- Affected verification: focused-window priority, rightmost tab selection, `Tab.lastAccessed` fallback, exact domain matching, no-match behavior, and absence of custom ordering state.
- Unchanged: notification eligibility and creation, notification settings and content, message delivery and persistence, Runtime networking, peer protocol, unread attention, Options UI, permissions, dependencies, and stored application data.
