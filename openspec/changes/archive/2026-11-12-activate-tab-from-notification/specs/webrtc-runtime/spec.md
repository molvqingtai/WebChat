## ADDED Requirements

### Requirement: Notification clicks activate one matching WebChat tab

When the user clicks a WebChat browser notification whose associated message has a valid WebChat domain, WebChat SHALL take a fresh snapshot of currently open browser tabs and match tabs whose current valid WebChat domain exactly equals the notification domain.

If the currently focused browser window contains one or more matches, WebChat SHALL activate the matching tab with the greatest tab index, representing the last, rightmost matching tab in that window. Matching tabs in other windows SHALL NOT override a focused-window match.

If the focused window contains no match, WebChat SHALL choose the matching tab outside that window with the greatest API-provided `Tab.lastAccessed` value, activate it, and focus its containing window. If no browser window is focused, all matching tabs SHALL participate in this `lastAccessed` selection. `Tab.lastAccessed` SHALL mean most recently accessed or activated, not creation time.

If no matching tab exists, or the clicked notification has no valid WebChat domain context, WebChat SHALL create no tab and SHALL NOT navigate, reload, close, reorder, or otherwise mutate any tab or window. Selection SHALL use only current browser-provided tab/window facts and SHALL NOT add or persist a timestamp, maintain a `tabs.onCreated` ledger, cache custom ordering, or introduce any other ordering state.

Notification eligibility, creation, content, settings, and request-local creation failure isolation SHALL remain independent from the later user-initiated click action.

#### Scenario: Focused-window rightmost match wins

- **GIVEN** a clicked domain-A notification, a focused window with domain-A matches at tab indices 1 and 4, and any matching tabs in other windows
- **WHEN** the user clicks the notification
- **THEN** WebChat SHALL activate the focused window's domain-A tab at index 4 and SHALL create no tab

#### Scenario: Focused-window priority overrides recency elsewhere

- **GIVEN** the focused window has one matching tab and another window has a matching tab with a greater `Tab.lastAccessed` value
- **WHEN** the user clicks the notification
- **THEN** WebChat SHALL activate the focused-window match and SHALL leave the other window unfocused

#### Scenario: Other-window most recently accessed match wins

- **GIVEN** the focused window has no matching tab and other windows contain matching tabs with distinct API-provided `Tab.lastAccessed` values
- **WHEN** the user clicks the notification
- **THEN** WebChat SHALL activate the match with the greatest `Tab.lastAccessed` value and SHALL focus its containing window

#### Scenario: No focused window uses the same fallback

- **GIVEN** no browser window is focused and matching tabs have distinct API-provided `Tab.lastAccessed` values
- **WHEN** the user clicks the notification
- **THEN** WebChat SHALL activate the match with the greatest `Tab.lastAccessed` value and SHALL focus its containing window

#### Scenario: No matching tab creates nothing

- **GIVEN** a clicked domain-A notification and no currently open tab with domain A
- **WHEN** the user clicks the notification
- **THEN** WebChat SHALL create no tab and SHALL leave every current tab and window unchanged

#### Scenario: Invalid notification context creates nothing

- **GIVEN** a notification click whose associated WebChat domain is missing or invalid
- **WHEN** WebChat evaluates the click
- **THEN** WebChat SHALL create no tab and SHALL leave every current tab and window unchanged

#### Scenario: Browser facts are the only ordering input

- **GIVEN** the same current tab/window snapshot and the same browser-provided tab indices and `Tab.lastAccessed` values
- **WHEN** the click is evaluated without any prior click or tab-creation history
- **THEN** WebChat SHALL select the same tab without reading or writing a custom timestamp, persisted order, creation ledger, or ordering cache
