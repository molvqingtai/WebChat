## ADDED Requirements

### Requirement: Browser notifications follow the currently viewed tab domain

For each first-delivered remote text, the existing notification-enabled setting SHALL remain authoritative: when disabled, no browser notification SHALL be created. When enabled, the existing `All message` mode SHALL admit every remote text and `Only @self` SHALL admit only a remote text that mentions the current user.

For an admitted text, WebChat SHALL compare the text's WebChat domain with the WebChat domain of the single tab the user is currently viewing: the current highlighted tab in the focused browser window at evaluation time. Exact domain equality SHALL suppress the browser notification. Different domains, no focused browser window, no current highlighted tab, or no valid comparable current-tab domain SHALL create exactly one browser notification. A highlighted tab in another unfocused window SHALL NOT count as the tab the user is currently viewing.

The highlighted tab SHALL be comparison input only. Evaluating, suppressing, or creating a notification SHALL NOT activate, highlight, focus, create, close, reload, navigate, or otherwise mutate a tab or window. Existing tab behavior initiated by the user's later interaction with a created notification SHALL remain unchanged.

Self-authored messages, history application, and duplicate delivery SHALL create no browser notification. A browser-notification failure SHALL remain request-local, SHALL NOT affect message persistence or presentation, and SHALL NOT prevent a later eligible message from creating its notification.

#### Scenario: Disabled notification setting wins

- **WHEN** the notification-enabled setting is off and any remote text is first delivered
- **THEN** WebChat SHALL create no browser notification

#### Scenario: All-message mode admits a remote text

- **WHEN** notifications are enabled in `All message` mode, a remote text is first delivered, and its domain differs from the currently viewed highlighted tab's domain
- **THEN** WebChat SHALL create exactly one browser notification

#### Scenario: Only-self mode filters by mention

- **WHEN** notifications are enabled in `Only @self` mode and a first-delivered remote text does not mention the current user
- **THEN** WebChat SHALL create no browser notification regardless of the currently viewed tab

#### Scenario: Only-self mention remains eligible

- **WHEN** notifications are enabled in `Only @self` mode, a first-delivered remote text mentions the current user, and its domain differs from the currently viewed highlighted tab's domain
- **THEN** WebChat SHALL create exactly one browser notification

#### Scenario: Currently viewed domain suppresses notification

- **WHEN** an eligible remote text's domain equals the domain of the highlighted tab in the focused browser window
- **THEN** WebChat SHALL create no browser notification and SHALL perform no tab or window operation

#### Scenario: Unfocused-window tab does not suppress notification

- **WHEN** an eligible remote text matches a highlighted tab in an unfocused browser window but differs from the highlighted tab the user is viewing in the focused browser window
- **THEN** WebChat SHALL create exactly one browser notification and SHALL leave both windows and all tabs unchanged

#### Scenario: No comparable current tab remains eligible

- **WHEN** an eligible remote text is first delivered and no focused browser window, current highlighted tab, or valid comparable current-tab domain exists
- **THEN** WebChat SHALL create exactly one browser notification

#### Scenario: Non-delivery paths create no notification

- **WHEN** a text is self-authored, applied from history, or rejected as a duplicate rather than first-delivered remotely
- **THEN** WebChat SHALL create no browser notification and SHALL perform no tab or window operation

#### Scenario: Notification failure remains isolated

- **WHEN** one eligible browser-notification request fails and a later eligible request succeeds
- **THEN** the failure SHALL produce only its existing request-local diagnostic, the message SHALL remain persisted and presented once, and the later request SHALL create exactly one notification
