## ADDED Requirements

### Requirement: Danmaku requires a visible local document

Each WebChat content document SHALL enable its local Danmaku presentation only when the existing Danmaku configuration is enabled and exact `document.visibilityState === 'visible'`. Every other document visibility state SHALL be Danmaku-disabled. The same derived eligibility SHALL control the local Danmaku surface lifecycle and every otherwise-eligible live-message push.

The configuration SHALL remain authoritative: document visibility SHALL NOT enable Danmaku while the setting is off. Visibility SHALL be read and observed inside the local content document without browser-window focus, browser tab active/highlighted state, tab/window enumeration, a background query, cross-tab coordination, persistence, protocol traffic, or an additional shared state owner.

#### Scenario: Visible configured document presents a new eligible delivery

- **GIVEN** the existing Danmaku setting is enabled and the local content document has exact `document.visibilityState === 'visible'`
- **WHEN** one otherwise-eligible new live message reaches the Danmaku projection
- **THEN** the local Danmaku surface SHALL present that message once through the existing Danmaku behavior

#### Scenario: Non-visible configured document presents nothing

- **GIVEN** the existing Danmaku setting is enabled and the local content document has any visibility state other than `visible`
- **WHEN** one otherwise-eligible new live message reaches the Danmaku projection
- **THEN** the local document SHALL perform no Danmaku push, render no item, and retain no work for that delivery

#### Scenario: Visibility cannot override a disabled setting

- **GIVEN** the local content document is visible and the existing Danmaku setting is disabled
- **WHEN** one otherwise-eligible new live message reaches the Danmaku projection
- **THEN** the local document SHALL present no Danmaku and SHALL NOT change the setting or its persistence

#### Scenario: Same-domain documents apply their own visibility

- **GIVEN** same-domain content documents A and B receive the same otherwise-eligible new live message, A is non-visible, B is visible, and the Danmaku setting is enabled
- **WHEN** the message reaches each local Danmaku projection
- **THEN** A SHALL show nothing and retain no replay work, B SHALL present the message once, and neither result SHALL alter shared message, panel, open, unread, or notification truth

### Requirement: Non-visible Danmaku clears without replay

When a local content document's Danmaku eligibility changes from true to false, WebChat SHALL immediately clear every rendered and pending Danmaku item from that document. No cleared item SHALL finish, pause for later, resume, or reappear. Repeated ineligible observations SHALL be idempotent.

An otherwise-eligible live delivery observed while the local document is Danmaku-ineligible SHALL produce no Danmaku item, queue, buffer, deferred work, or replay authority. When eligibility later becomes true, the surface SHALL remain empty until a later new eligible live delivery arrives. Message receipt, persistence, Chat history/list presentation, WebChat panel state, AppButton state, unread attention, and browser notifications SHALL remain unchanged by this Danmaku-only decision.

The local visibility listener and Danmaku resources SHALL be cleaned up with the content document lifecycle so remounting produces one current observer and one current presentation lifecycle without stale clear or push authority.

#### Scenario: Losing visibility clears moving Danmaku immediately

- **GIVEN** the setting is enabled, the document is visible, and one or more Danmaku items are rendered or pending
- **WHEN** the document changes to a visibility state other than `visible`
- **THEN** every current item SHALL be cleared in that accepted transition and none SHALL continue, pause, resume, or reappear

#### Scenario: Hidden deliveries are never replayed

- **GIVEN** the setting is enabled and the document remains non-visible while one or more otherwise-eligible live messages reach the Danmaku projection
- **WHEN** the document later becomes visible before any newer message arrives
- **THEN** the Danmaku surface SHALL remain empty with no history lookup, queue drain, delayed push, or replay of those messages

#### Scenario: Only a later new delivery appears after visibility returns

- **GIVEN** an eligible message was dropped for Danmaku while the configured document was non-visible and the document then becomes visible
- **WHEN** a later new otherwise-eligible live message reaches the Danmaku projection
- **THEN** only the later message SHALL be eligible for one new Danmaku presentation

#### Scenario: Repeated visibility events and remount stay singular

- **GIVEN** the content document receives repeated visible and non-visible observations and its WebChat application is disposed and mounted again
- **WHEN** one later eligible live message arrives in the visible configured document
- **THEN** exactly one current visibility observer and Danmaku lifecycle SHALL act, the message SHALL be pushed at most once, and no disposed observer SHALL clear or push
