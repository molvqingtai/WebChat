## ADDED Requirements

### Requirement: AppButton identifies the latest eligible remote author

Each WebChat domain SHALL own one same-domain AppButton author projection derived only from first-delivered remote text. An eligible delivery SHALL contain the complete remote author identity used by message presentation. Self-authored text, history application, duplicate delivery, reactions, and system notices SHALL NOT select or extend the projection. Browser-window focus, active/highlighted tab state, and browser-notification enabled/type settings SHALL NOT gate, redirect, clear, or extend it.

When the shared shell is expanded, an eligible delivery SHALL select that author immediately on every surface observing the accepted delivery and SHALL start a Motion opacity fade from the AppButton's daily logo to that author's avatar. Author ownership SHALL end exactly `1,000ms` after that delivery, when the Motion fade back to the daily logo begins unless a newer eligible delivery owns the projection. Every newer eligible delivery, from the same or a different author, SHALL select the current author immediately and start a fresh exact `1,000ms` lifetime. When it changes the rendered author identity, it SHALL start fading to the current avatar immediately without waiting for or queueing behind an earlier lifetime or fade. An earlier timeout or animation settlement SHALL NOT clear or restore content over a newer author after the newer state is observed.

When the shared shell is collapsed, an eligible delivery SHALL mark the domain unread, select that author immediately, and start a Motion opacity fade from the daily logo to the author avatar on every surface observing that accepted delivery. The latest collapsed unread author SHALL have no one-second expiry and SHALL remain current until the shared shell expands. Every newer eligible collapsed delivery SHALL select the current author immediately and, when the rendered identity differs, start fading to it without adding a count or queue. Expanding SHALL clear unread and the persistent author together and SHALL start the Motion fade back to the daily logo on every synchronizing same-domain AppButton. Collapsing without a later eligible delivery SHALL NOT create or retain persistent author identity; an expanded transient author still current at collapse SHALL clear and start fading to the daily logo rather than become unread.

The selected author and a live expanded deadline SHALL use the domain's one field-scoped same-domain status synchronization boundary and SHALL remain isolated from every other domain. A synchronizing surface SHALL project the latest accepted same-domain state. A surface whose document, event loop, hydration, or synchronization is paused or delayed MAY temporarily retain its last observed author, open, and unread result. Once current synchronization or hydration reaches that surface, it SHALL converge to the latest accepted state; its older observation SHALL NOT remain current or overwrite that later state.

A same-domain surface that receives current state during an expanded lifetime SHALL show only its remaining portion. A surface that receives it at or after expiry, or after reading, SHALL show the daily logo and SHALL NOT start another `1,000ms` lifetime. A collapsed unread author SHALL survive same-domain remount or hydration until expansion. After current same-domain state arrives, delayed hydration, older synchronization, and stale timeouts SHALL NOT replace, extend, restore, or clear the current generation. Same-domain synchronization SHALL NOT require instantaneous agreement with a paused or delayed surface, another persistence owner, or an author-presentation queue.

The avatar SHALL replace only the day-specific logo inside the unchanged circular launcher content area. It SHALL use the message author's avatar image and the existing author name-initial fallback when the image is empty or fails. The AppButton's button, shimmer, shadow, size, hit target, open/close label, context menu, drag behavior, geometry, stacking, and daily-logo selection SHALL remain unchanged. The existing count-free orange unread badge SHALL remain visible with the persistent avatar exactly when `!open && unread`, and SHALL remain absent while expanded. No author queue, message preview, unread count, text label, layout shift, or browser-specific result SHALL be added.

Every normal-motion change between distinct inner identities SHALL use the project's existing Motion runtime to fade opacity. This SHALL cover daily logo to author avatar, one author avatar to another, and author avatar back to the daily logo; none of these normal-motion identity changes SHALL be an instantaneous replacement. A repeated delivery whose rendered author identity is unchanged MAY refresh its lifetime without replaying the fade.

The current identity SHALL start fading in from the same state update in which the outgoing identity starts fading out. Every newer delivery, clear, collapse, or expiry SHALL start its current fade immediately and SHALL supersede rather than queue behind an active fade. Animation activity SHALL NOT change, delay, restart, or extend author order, unread truth, or the exact expanded deadline, and stale animation settlement SHALL NOT restore an older identity. Motion SHALL apply only to the inner daily-logo/avatar content and SHALL NOT animate or capture the button, unread badge, shell, menu, Danmaku, MediaPreview, or host page. Reduced-motion preference SHALL settle the current inner identity directly with the same final DOM and state, no queue, and no lifetime extension.

#### Scenario: Expanded delivery shows one exact transient author

- **GIVEN** actively synchronizing same-domain AppButtons A, B, and C are expanded and tab D belongs to another domain
- **WHEN** author Alpha's remote text is first-delivered at time `0ms`
- **THEN** A, B, and C SHALL select Alpha immediately and start fading from the daily logo to Alpha's avatar, D SHALL remain unchanged, the unread badge SHALL remain absent, Alpha ownership SHALL remain current before `1,000ms`, and the fade back to the daily logo SHALL begin at exactly `1,000ms`

#### Scenario: A newer expanded author supersedes without waiting

- **GIVEN** Alpha owns an expanded transient lifetime that has not expired
- **WHEN** author Beta's eligible text is delivered at time `600ms`
- **THEN** every observing same-domain AppButton SHALL select Beta and start fading to Beta immediately without waiting for Alpha's fade, Alpha's `1,000ms` timeout SHALL NOT clear or restore content over Beta, Beta ownership SHALL remain current before `1,600ms`, and the fade back to the daily logo SHALL begin at exactly `1,600ms` unless another delivery supersedes it

#### Scenario: Repeated text from the same author refreshes the lifetime

- **GIVEN** Alpha is visible for an expanded delivery and its deadline has not arrived
- **WHEN** another eligible Alpha text is first-delivered
- **THEN** Alpha SHALL remain the visible author and SHALL receive a fresh exact `1,000ms` lifetime from the newer delivery

#### Scenario: Collapsed delivery persists the latest unread author

- **GIVEN** actively synchronizing same-domain AppButtons A, B, and C are collapsed and read
- **WHEN** Alpha's eligible text and then Beta's eligible text are first-delivered
- **THEN** the AppButtons SHALL start fading to Alpha immediately and then start fading to Beta immediately without waiting for Alpha's fade, Beta SHALL remain current without a one-second expiry, every observing same-domain AppButton SHALL show the unchanged count-free unread badge with Beta, and every other domain SHALL remain unchanged

#### Scenario: Reopening clears persistent identity and unread together

- **GIVEN** collapsed, actively synchronizing same-domain AppButtons show Beta with unread attention
- **WHEN** the user expands WebChat through any same-domain AppButton
- **THEN** every observing same-domain shell SHALL expand, unread and Beta SHALL clear together, every observing launcher SHALL start fading from Beta to its daily logo, and another domain SHALL remain unchanged

#### Scenario: Collapse does not turn a read transient author into unread

- **GIVEN** Alpha is visible inside an expanded one-second lifetime
- **WHEN** the user collapses the shared shell before that lifetime expires and no later eligible text has arrived
- **THEN** Alpha SHALL clear, the collapsed AppButtons SHALL start fading to the daily logo without unread attention, and only a later eligible collapsed delivery MAY create a persistent author

#### Scenario: Current hydration preserves only current identity

- **GIVEN** one same-domain surface receives current state during a live expanded lifetime, another receives it after its deadline, and a third receives it while a collapsed unread author is current
- **WHEN** each surface hydrates or synchronizes its AppButton status
- **THEN** the first SHALL show only the remaining expanded lifetime, the second SHALL show the daily logo, the third SHALL show the current persistent author until expansion, and no expired, read, or older author SHALL reappear

#### Scenario: A delayed same-domain surface converges

- **GIVEN** surface B is paused with an earlier collapsed author while synchronizing surfaces A and C accept a later open that clears that author and unread attention
- **WHEN** B resumes same-domain synchronization and receives the current accepted state
- **THEN** B MAY have shown its earlier observation before synchronization resumed, but SHALL then start fading to the daily logo in normal motion or settle it directly under reduced motion, SHALL NOT keep or rewrite the earlier author, unread, or open result, and SHALL converge without a second persistence owner or presentation queue

#### Scenario: Resuming synchronization does not restart a transient

- **GIVEN** surface B pauses during an expanded author's absolute `1,000ms` lifetime
- **WHEN** B resumes and receives current same-domain state before or after the deadline
- **THEN** B SHALL show only the remaining lifetime when the deadline is still live, SHALL show the daily logo at or after the deadline, and SHALL NOT start a fresh `1,000ms` lifetime because synchronization resumed

#### Scenario: Non-delivery paths do not select an author

- **WHEN** a text is self-authored, applied from history, or duplicate, or the inbound value is a reaction or system notice
- **THEN** no AppButton author or lifetime SHALL be created, replaced, or extended because of that value

#### Scenario: Avatar replacement preserves the launcher

- **GIVEN** an eligible author has an avatar image or requires the existing name-initial fallback
- **WHEN** the AppButton projects that author
- **THEN** only the daily logo SHALL be replaced inside the circular content area, while the button, fallback, unread badge rule, shimmer, shadow, size, label, hit target, menu, drag behavior, geometry, and stacking SHALL retain their defined results

#### Scenario: Motion fades every inner identity direction

- **GIVEN** normal motion is enabled and the launcher currently renders either the daily logo or an author avatar
- **WHEN** accepted state changes the rendered identity from daily logo to Alpha, Alpha to Beta, or an author back to the daily logo
- **THEN** Motion SHALL fade opacity from the outgoing inner identity to the current inner identity, the current fade SHALL begin without waiting for the outgoing fade to finish, and no button, unread badge, shell, menu, Danmaku, MediaPreview, or host-page surface SHALL animate because of that identity change

#### Scenario: A current fade supersedes without changing state time

- **GIVEN** an inner identity fade is active
- **WHEN** a newer delivery, clear, collapse, or expiry selects another current identity
- **THEN** the current identity SHALL start fading in immediately without queueing, stale animation settlement SHALL NOT restore an older identity, and author order, unread truth, and the absolute expanded deadline SHALL remain unchanged by animation progress

#### Scenario: Reduced motion settles the current identity directly

- **GIVEN** reduced-motion preference is active
- **WHEN** accepted state changes the AppButton's inner identity
- **THEN** the launcher SHALL settle the current daily logo or author avatar directly with the same state, scope, and lifetime result and without an animation queue
