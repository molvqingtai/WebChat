## MODIFIED Requirements

### Requirement: Domain-scoped manual reconnect

The actions menu SHALL include "Reconnect this site", which SHALL recover only the current domain's ChatRoom connection and re-publish that domain's presence. Because the frozen `ChatRoom` has no `reconnect` method, the application Domain SHALL use only the exact public `leaveRoom()` and `joinRoom(command)` methods rather than extending the extern. When the current domain is joined, activation SHALL retain the existing `leaveRoom()` then `joinRoom(retainedCommand)` composition. When the configured domain is unjoined because its initial connection/join has not completed or terminally failed, activation SHALL build the current user/site join command and invoke `joinRoom(command)` directly without first calling `leaveRoom()`. The application Domain SHALL expose one derived availability truth: required user identity is configured, the initial join is not actively loading, and no Refresh-owned recovery request is active. Availability SHALL NOT require `joined`, SHALL NOT depend on Runtime readiness, and SHALL NOT read or modify `panelOpen` in Chrome or Firefox.

One enabled activation SHALL create one authoritative request identity and pending fact. It SHALL atomically fence another initial join or recovery, immediately invoke the selected retry/reconnect operation, preserve the main panel's current open/closed state, disable the Refresh control, and spin that control's own icon. A successful unjoined retry SHALL retain the accepted join input, reload current messages, set application join status finished, and emit the existing self-join application fact before the matching request terminal settles. A failed unjoined retry SHALL return application join status to its retryable initial state and record the same request-local error. The button SHALL expose no Ready text, success region, result badge, or second terminal state: it SHALL return to its ordinary eligible icon when the matching request terminal settles. Every callback SHALL validate the request identity so stale work cannot clear a newer request's spin or feedback. Toast subscription, mount, paint, dwell, failure, unmount, or absence SHALL NOT delay, cancel, reject, or redefine recovery dispatch or the independently captured network operation outcome. A visibly painted request-correlated generic loading Toast SHALL contribute the accepted minimum 300ms dwell; feedback absence, unmount, or presentation failure SHALL settle boundedly and SHALL NOT strand the button or duplicate gate. This pending lifetime SHALL reject duplicates only and SHALL NOT become Runtime or network authority.

The application SHALL expose one generic Toast feedback capability, not a reconnect-owned presenter. Reconnect, join retry, Runtime readiness, and unrelated application notifications SHALL publish through the existing generic Toast APIs and share the original direct `AppMain -> <Toaster>` surface. `src/app/content/components/reconnect-toast.tsx`, `useReconnectToast`, reconnect-specific presenter/renderer naming, and any independent reconnect Toast lifecycle truth SHALL remain absent. Any presentation adapter SHALL consume only generic Toast descriptors, stable IDs, and presentation acknowledgements; it SHALL NOT directly import or own ChatRoom, Readiness, Runtime, network, or panel behavior. Business Domain effects MAY map source events to generic Toast entries, but the recovery request SHALL remain the only owner of operation outcome, duplicate rejection, button pending state, and stale-request fencing. Generic Toast state SHALL NOT become a second recovery pending or network truth.

The Toaster SHALL remain a direct `AppMain` child using the existing AppMain Motion translate containing mechanism. There SHALL be no wrapper, reconnect-specific Toaster, always-mounted launcher layer, host-page global overlay, second renderer, or source-specific Toast restyling. The direct Toaster SHALL retain `richColors`, current `themeMode`, `offset="70px"`, `visibleToasts={1}`, `position="top-center"`, and `dark:bg-slate-950 border dark:border-slate-600` Toast classes. No source SHALL add custom geometry, width, content-fit, placement, pointer, opacity-tracking, pseudo-element, or eligibility styles. While mounted, generic entries MAY present retry/reconnect loading/result, Runtime connecting loading, Runtime unavailable error, and unrelated feedback through that same surface. Normal Runtime ready SHALL NOT publish a success descriptor. One recovery request SHALL correlate only its own generic Toast ID for visible-paint acknowledgement, the accepted 300ms minimum loading dwell, terminal update, and cleanup. Absence, unmount, or presentation failure SHALL settle boundedly without delaying bootstrap, Runtime, recovery, or the matching button. Opening during an active recovery MAY present only its current pending entry; terminal recovery SHALL NOT replay later. Cleanup SHALL address only the correlated ID, SHALL NOT use unscoped/global dismissal, and SHALL preserve unrelated Toasts.

`App.tsx` SHALL NOT render a fixed readiness output, and `content/index.tsx` SHALL NOT render a pre-App loading, unavailable, Retry, status, or result fallback when client bootstrap fails. Runtime lifecycle SHALL retain its immediate-replay `connecting | ready | unavailable` state for recovery and send preconditions; only the independent presentation authority is removed. ReadinessDomain SHALL be the sole application readiness-transition authority. Its State-setting Command SHALL compare every mapped extern input to current State: equal input SHALL perform no State write and emit no `StateChangedEvent`, while a different input SHALL update State and emit exactly one Event. The current Query SHALL remain immediately available independently of transition Events. No duplicate filter or second readiness State SHALL be added to ClientLease, the Readiness implementation adapter, AppFeedback, or Toast presentation.

The ClientLease watchdog SHALL retain its existing five-second cadence, page lease renewal before the Coordinator's 15-second TTL, host availability probe, generation/host-id/page-attachment comparison, and real replacement/loss recovery. Equal healthy host-phase callbacks MAY still reach the Readiness extern boundary, but after mapping they SHALL NOT become application transitions. This heartbeat SHALL remain liveness infrastructure rather than proof of a new readiness fact.

While AppMain/Toaster exists, normal Runtime `connecting` MAY publish the stable loading entry and `unavailable` MAY publish the stable error entry. A genuine transition to `ready`, or an immediate mounted-surface ready Query, SHALL issue only an ID-scoped dismissal for `webchat-runtime-readiness` if present; it SHALL NOT publish `Ready to chat` or any other success descriptor. Periodic equal-state ready health samples SHALL produce neither a `StateChangedEvent` nor any AppFeedback/Toast command. Toast dismissal, automatic close, acknowledgement, and presentation settlement SHALL NOT publish another readiness descriptor or create a loop. These rules SHALL NOT change Runtime recovery or send preconditions or alter the independently request-correlated retry/reconnect success result. If Toast cannot render because App/Toaster is absent, the application SHALL NOT create an alternate loading, unavailable, Retry, status, or result view. Presentation absence SHALL NOT redefine bootstrap, Runtime, or network truth. Refresh SHALL NOT rebuild the shared WorldRoom; the Runtime SHALL auto-reconnect WorldRoom only on its own connection failure. The Options page SHALL NOT gain a global reconnect entry.

#### Scenario: Terminal failed join is recoverable

- **GIVEN** user identity is configured, the current domain is not joined after a terminal connection/join failure, and no join or recovery request is active
- **WHEN** the actions menu renders and the user activates Refresh
- **THEN** Refresh SHALL be enabled, one request SHALL enter pending, `joinRoom()` SHALL start immediately with current user/site input, and `leaveRoom()` SHALL NOT be called

#### Scenario: Initial join remains single-flight

- **GIVEN** the automatic initial site-chat join or a Refresh-owned retry/reconnect request is actively in flight
- **WHEN** the actions menu renders or another activation is attempted
- **THEN** Refresh SHALL be disabled, the Domain SHALL admit no second request, and no concurrent `joinRoom()` or `leaveRoom()` composition SHALL start

#### Scenario: Missing identity is not an executable recovery

- **GIVEN** required user identity is not configured
- **WHEN** the actions menu renders Refresh
- **THEN** Refresh SHALL be visibly disabled with an accessible non-actionable label and SHALL dispatch no recovery request

#### Scenario: Successful failed-join retry establishes joined state

- **GIVEN** an enabled unjoined retry owns the current request identity
- **WHEN** `joinRoom()` accepts the current user/site command
- **THEN** the application SHALL retain that input, reload current messages, set join status finished, emit the existing self-join fact once, and record success on the same request before bounded feedback settlement returns Refresh to its eligible icon

#### Scenario: Failed retry becomes retryable again

- **GIVEN** an enabled unjoined retry owns the current request identity
- **WHEN** `joinRoom()` rejects
- **THEN** the application SHALL record the normalized error on that request, return join status to initial, settle only matching button/Toast feedback, and re-enable Refresh after the request terminal without starting an automatic loop

#### Scenario: Manual joined-domain reconnect

- **GIVEN** the current domain is joined and no join or recovery request is active
- **WHEN** a user activates "Reconnect this site"
- **THEN** only that domain's ChatRoom connection and presence SHALL be rebuilt through the existing leave/join composition, while other domains and the WorldRoom remain undisturbed

#### Scenario: Runtime unavailable does not recreate the joined gate

- **GIVEN** user identity is configured, no join or recovery request is active, and Runtime readiness is unavailable
- **WHEN** the actions menu derives Refresh availability
- **THEN** availability SHALL depend on the recovery single-flight prerequisites rather than successful joined/readiness state, and an accepted request SHALL surface its real operation outcome through the existing request feedback

#### Scenario: Button and generic Toast entry share one recovery request

- **GIVEN** `AppMain` and its original Toaster are mounted
- **WHEN** an enabled user activates retry/reconnect and the current-domain operation succeeds or fails
- **THEN** one request identity SHALL immediately invoke the selected operation, disable and spin the Refresh button, and correlate one generic loading-to-ready/success-or-failure Toast entry; the bounded request terminal SHALL stop only the matching spin, and neither the generic Toast layer nor the button SHALL create a second recovery state owner

#### Scenario: Recovery does not wait for Toast presentation

- **GIVEN** the Toast library defers its subscriber update or fails to render loading
- **WHEN** an enabled user activates Refresh
- **THEN** the selected join or leave/join ports SHALL be invoked immediately, the Refresh icon SHALL represent the same pending request, no Toast state SHALL delay or alter that operation, and a bounded presentation-failure outcome SHALL allow the shared request terminal rather than strand the icon or duplicate gate

#### Scenario: Fast terminal recovery respects mounted feedback

- **GIVEN** `AppMain` remains mounted and the join or leave/join ports settle before the request-owned loading Toast receives its first visible paint
- **WHEN** the operation outcome reaches the shared request
- **THEN** the operation outcome SHALL be captured without waiting for feedback, while the matching Refresh icon and loading Toast SHALL remain tied to that request until the visible Toast completes its 300ms minimum dwell and transitions to the matching terminal Toast result

#### Scenario: Stale terminal work cannot clear a newer request

- **GIVEN** one recovery has settled and a later recovery owns a newer request identity
- **WHEN** delayed Toast paint, dwell, or terminal cleanup from the older request completes
- **THEN** it SHALL NOT stop the newer Refresh spin, dismiss the newer loading Toast, emit a newer error, or alter the newer recovery operation

#### Scenario: Original AppMain Toaster structure and visuals are preserved

- **WHEN** the main panel renders application feedback
- **THEN** `AppMain` SHALL contain the direct original Toaster with `richColors`, current theme, `offset="70px"`, `visibleToasts={1}`, `position="top-center"`, and the existing dark Toast classes, without an added wrapper, launcher layer, reconnect-specific Toaster component, or custom geometry/pointer styling

#### Scenario: Generic Toast surface carries independent business sources

- **GIVEN** unrelated application Toast feedback exists before or during recovery or a Runtime readiness transition
- **WHEN** recovery or Runtime status publishes feedback
- **THEN** all sources SHALL use the same generic Toaster and generic descriptor contract, retry/reconnect/Readiness SHALL own no presenter or renderer, source-local cleanup SHALL preserve unrelated entries, and no unscoped dismissal SHALL occur

#### Scenario: Readiness emits only actual transitions

- **GIVEN** Readiness State already equals the mapped extern input
- **WHEN** the five-second heartbeat or any other source repeats that same `connecting`, `ready`, or `unavailable` value
- **THEN** Readiness SHALL perform no State write, emit no `StateChangedEvent`, trigger no ChatRoom recovery, and publish or dismiss no Toast

#### Scenario: Real readiness transitions remain observable once

- **GIVEN** Readiness currently exposes one state through its Query
- **WHEN** the mapped extern input changes to a different `connecting`, `ready`, or `unavailable` value
- **THEN** Readiness SHALL update its State and emit exactly one matching `StateChangedEvent`, while current-state Query/replay remains available without manufacturing a duplicate transition

#### Scenario: Runtime watchdog retains lease and recovery behavior

- **GIVEN** a page lease requires renewal and the shared Runtime host may be lost or replaced without a reliable terminal event
- **WHEN** the ClientLease watchdog runs
- **THEN** it SHALL retain the five-second lease/probe/snapshot checks and initiate recovery only for a real unavailable, generation, host-id, or page-attachment change; Readiness transition dedup SHALL NOT disable or delay that liveness behavior

#### Scenario: Runtime ready dismisses loading without success replay

- **GIVEN** the Runtime readiness Toast uses stable ID `webchat-runtime-readiness`
- **WHEN** readiness genuinely enters ready or a newly mounted Toast surface reads the current ready Query
- **THEN** application feedback SHALL only dismiss that ID if present, SHALL NOT publish `Ready to chat` or another success descriptor, and SHALL NOT dismiss unrelated Toasts

#### Scenario: Runtime ready settlement cannot form a presentation loop

- **GIVEN** the Runtime readiness loading entry was dismissed or a prior Toast automatically closed, acknowledged, or settled
- **WHEN** readiness remains ready without a later connecting or unavailable transition
- **THEN** no Toast lifecycle fact SHALL republish the ready success descriptor, while Runtime recovery, immediate-replay readiness truth, and manual recovery feedback SHALL remain unchanged

#### Scenario: No independent readiness or bootstrap status view

- **WHEN** Runtime is connecting or unavailable, or client bootstrap fails before App/Toaster exists
- **THEN** `App.tsx` and `content/index.tsx` SHALL render no fixed loading, unavailable, Retry, status, or result view; mounted normal-runtime feedback MAY use generic Toast, while absent Toast presentation SHALL create no replacement UI and SHALL NOT become bootstrap or Runtime authority

#### Scenario: Closed-panel recovery has no Toast prerequisite

- **GIVEN** the main panel is closed and `AppMain` plus Toaster are unmounted
- **WHEN** an enabled user activates Refresh
- **THEN** the panel SHALL remain closed, the selected join or leave/join operation SHALL start immediately, the matching Refresh icon SHALL remain disabled and spinning while pending, and Toast absence SHALL neither queue nor strand the operation

#### Scenario: Ready and result feedback use generic Toast only

- **GIVEN** `AppMain` and Toaster are mounted for the recovery request
- **WHEN** that request captures success/readiness or failure
- **THEN** the request-correlated generic Toast entry SHALL present the matching terminal result, while the Refresh button SHALL expose no Ready text, success region, error region, result badge, or second result state

#### Scenario: Active request may enter a newly mounted Toaster once

- **GIVEN** recovery began while the panel was closed and the same request remains pending
- **WHEN** the user opens the panel
- **THEN** the original generic Toaster MAY present that request-correlated loading-to-terminal entry once, SHALL NOT restart recovery, and SHALL NOT replay any request that had already terminated

#### Scenario: Recovery unavailable state is not a silent action

- **GIVEN** required user identity is absent, the initial join is loading, or a Refresh-owned request is active
- **WHEN** the actions menu renders "Reconnect this site"
- **THEN** the action SHALL be visibly disabled with an accessible state label, SHALL NOT dispatch activation, and SHALL NOT accept a click that silently produces neither feedback nor an operation

#### Scenario: Panel state changes only Toast availability

- **WHEN** the main plugin panel opens or closes during an active recovery
- **THEN** the same operation and matching button spin SHALL continue without cancellation, replay, restart, duplication, or panel mutation; opening MAY mount the request-correlated generic Toast entry once, while closing MAY unmount it and SHALL settle feedback absence boundedly

#### Scenario: Recovery cleanup is request-local

- **GIVEN** unrelated Toast feedback exists before or during recovery
- **WHEN** retry/reconnect succeeds, fails, or the main panel changes state
- **THEN** cleanup SHALL address only the generic Toast ID correlated to the matching recovery request, SHALL NOT invoke an unscoped/global dismissal, SHALL preserve all unrelated Toast feedback, and SHALL NOT affect a newer request

#### Scenario: WorldRoom self-recovery

- **WHEN** the WorldRoom connection itself fails
- **THEN** the Runtime SHALL reconnect it automatically without requiring the domain Refresh action
