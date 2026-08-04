## ADDED Requirements

### Requirement: New Danmaku requires a visible local document

Each WebChat content document SHALL call its existing Danmaku push behavior for an otherwise-eligible new live message only when the existing Danmaku configuration is enabled and exact `document.visibilityState === 'visible'` at that delivery. Every other document visibility state SHALL reject that new Danmaku push.

The configuration SHALL remain authoritative: document visibility SHALL NOT enable Danmaku while the setting is off. Visibility SHALL be read directly at the existing local push boundary without a visibility listener, state copy, lifecycle effect, browser-window focus, browser tab active/highlighted state, tab/window enumeration, a background query, cross-tab coordination, persistence, protocol traffic, or an additional shared state owner.

#### Scenario: Visible configured document presents a new eligible delivery

- **GIVEN** the existing Danmaku setting is enabled and the local content document has exact `document.visibilityState === 'visible'`
- **WHEN** one otherwise-eligible new live message reaches the Danmaku projection
- **THEN** the local document SHALL push that message once through the existing Danmaku behavior

#### Scenario: Non-visible configured document presents nothing

- **GIVEN** the existing Danmaku setting is enabled and the local content document has any visibility state other than `visible`
- **WHEN** one otherwise-eligible new live message reaches the Danmaku projection
- **THEN** the local document SHALL perform no Danmaku push and SHALL retain no queue, deferred work, or replay authority for that delivery

#### Scenario: Visibility cannot override a disabled setting

- **GIVEN** the local content document is visible and the existing Danmaku setting is disabled
- **WHEN** one otherwise-eligible new live message reaches the Danmaku projection
- **THEN** the local document SHALL present no Danmaku and SHALL NOT change the setting or its persistence

#### Scenario: Same-domain documents apply their own visibility

- **GIVEN** same-domain content documents A and B receive the same otherwise-eligible new live message, A is non-visible, B is visible, and the Danmaku setting is enabled
- **WHEN** the message reaches each local Danmaku projection
- **THEN** A SHALL perform no push and retain no replay work, B SHALL push the message once, and neither result SHALL alter shared message, panel, open, unread, or notification truth

### Requirement: Visibility changes preserve accepted Danmaku without replaying hidden deliveries

The existing Danmaku configuration and content lifecycle SHALL remain the only owners of the local Danmaku manager lifecycle. A document visibility change SHALL NOT cause WebChat to mount, unmount, clear, pause, resume, restart, or replace that manager or any already accepted rendered or pending item. An item accepted while the document was visible SHALL remain governed only by the existing Danmaku runtime; visibility changes SHALL NOT clear, reconstruct, restart, or duplicate it.

An otherwise-eligible live delivery observed while the local document is non-visible SHALL produce no Danmaku item, queue, buffer, deferred work, or replay authority. When the document later becomes visible, WebChat SHALL NOT inspect Chat history or resubmit that dropped projection; only a later new eligible live delivery may be pushed. Message receipt, persistence, Chat history/list presentation, WebChat panel state, AppButton state, unread attention, and browser notifications SHALL remain unchanged by this Danmaku-only decision.

WebChat SHALL NOT add a document-visibility observer or visibility-owned Danmaku resource lifecycle for this behavior. Existing setting changes and content disposal SHALL retain their current manager lifecycle semantics.

#### Scenario: Losing and regaining visibility preserves an accepted item

- **GIVEN** the setting is enabled, the document is visible, and one or more Danmaku items are rendered or pending
- **WHEN** the document becomes non-visible and then visible again before an item otherwise completes
- **THEN** WebChat SHALL perform no manager or item lifecycle action because of either visibility change and SHALL NOT clear, restart, reconstruct, or duplicate the already accepted item

#### Scenario: Hidden deliveries are never replayed

- **GIVEN** the setting is enabled and the document remains non-visible while one or more otherwise-eligible live messages reach the Danmaku projection
- **WHEN** the document later becomes visible before any newer message arrives
- **THEN** WebChat SHALL perform no history lookup, queue drain, delayed push, or replay of those messages, while any independently accepted earlier item remains governed by the unchanged Danmaku runtime

#### Scenario: Only a later new delivery appears after visibility returns

- **GIVEN** an eligible message was dropped for Danmaku while the configured document was non-visible and the document then becomes visible
- **WHEN** a later new otherwise-eligible live message reaches the Danmaku projection
- **THEN** only the later message SHALL be eligible for one new Danmaku presentation

#### Scenario: Repeated visibility changes do not churn the manager

- **GIVEN** the configured content document changes repeatedly between visible and non-visible states
- **WHEN** no new live message reaches the Danmaku projection
- **THEN** WebChat SHALL issue no visibility-driven Danmaku command and SHALL NOT create, replace, clear, pause, resume, restart, or duplicate the existing manager or its accepted items
