## ADDED Requirements

### Requirement: Persisted shell state restores independently of application initialization

After the content script obtains its configured DOM anchor, WebChat SHALL mount the one launcher and openable panel component tree before waiting for locally persisted shell state. The shell SHALL then restore the user's locally persisted expanded or collapsed choice without waiting for browser-sync preparation, page-local application configuration, MessageStore/IndexedDB preparation, Runtime initialization, or full application readiness. Status hydration and application readiness SHALL NOT gate that component tree.

Pending, rejected, timed-out, canceled, or unavailable application initialization SHALL NOT skip the shell-state read, clear the saved choice, overwrite it with the default, or prevent a new shell choice from being persisted. Initialization outcome MAY gate only the capabilities that depend on it. Restoring a saved expanded state SHALL NOT count as automatic opening; when no saved state exists, the existing default collapsed state SHALL remain authoritative.

The mounted root and `App` SHALL own exactly one current hydration and persistence lifecycle. Retry, dependency recovery, and ready capability activation SHALL reuse that same `AppStatus` state and SHALL NOT create another storage read owner, persistence watcher, state mirror, root, or shell effect. Existing storage key, record shape, version, and the semantics of other stored status fields SHALL remain unchanged.

A user expansion or collapse accepted before hydration settles SHALL be newer than the pending stored snapshot. The accepted choice SHALL remain visible, SHALL be persisted through the shell-owned lifecycle, and SHALL NOT be overwritten by late hydration. A result from a superseded shell or document generation SHALL NOT mutate or repersist the current shell. Initialization readiness, failure, Retry, and late settlement SHALL never independently change expanded/collapsed state.

#### Scenario: Persisted expanded state restores while initialization is pending

- **GIVEN** the current document has mounted its normal component tree, local shell state records expanded, and an application initialization dependency remains pending
- **WHEN** shell-state hydration settles before that dependency
- **THEN** the same shell SHALL become expanded, the pending Runtime-dependent operation SHALL remain correctly gated, and application readiness SHALL NOT be required for restoration

#### Scenario: Persisted expanded state survives every initialization terminal

- **GIVEN** local shell state records expanded and the current shell has begun hydration
- **WHEN** browser-sync, page-local configuration, IndexedDB, or Runtime initialization rejects, times out, is canceled, or settles unavailable
- **THEN** the same shell SHALL restore or retain expanded state and SHALL NOT write collapsed merely because initialization failed

#### Scenario: Persisted collapsed state remains collapsed

- **GIVEN** local shell state records collapsed
- **WHEN** the shell hydrates while initialization is pending, succeeds, fails, times out, or later recovers
- **THEN** the shell SHALL remain collapsed until a user expands it, and neither restoration nor initialization transition SHALL automatically open it

#### Scenario: Missing persisted state keeps the existing default

- **GIVEN** no local shell-state record exists for the current page context
- **WHEN** shell hydration completes
- **THEN** the existing default collapsed state SHALL remain in effect without changing initialization operation, feedback, or Refresh eligibility

#### Scenario: Pre-hydration interaction wins over a late snapshot

- **GIVEN** a shell-state read is pending and the user expands or collapses the mounted shell
- **WHEN** the older stored snapshot later settles with the opposite value
- **THEN** the user's accepted choice SHALL remain visible and become the persisted choice, and the late snapshot SHALL NOT overwrite or repersist the opposite state

#### Scenario: Retry reuses one shell-state lifecycle

- **GIVEN** the shell has started or completed its one hydration and application initialization has failed
- **WHEN** the user invokes Refresh and the next initialization generation succeeds or fails
- **THEN** the same root, shell state, hydration owner, and persistence owner SHALL remain in use, with no duplicate storage watcher or expanded/collapsed transition caused by Retry

#### Scenario: Superseded hydration cannot alter a replacement shell

- **GIVEN** an old document or shell generation has an unsettled shell-state read
- **WHEN** a reload or genuine document replacement mounts a new shell and the old read later settles
- **THEN** the old result SHALL NOT mutate or persist state for the replacement shell, whose own hydration and later user choices SHALL remain authoritative

### Requirement: AppStatusDomain is the single app-status owner

`AppStatusDomain` SHALL be the one Remesh owner for persisted `open`, `unread`, and `position`; non-persisted initialization phase `connecting | unavailable | ready`; the initialization Retry command and event; and incoming-message unread processing. Only `open`, `unread`, and `position` SHALL enter the AppStatus storage record.

The unread effect SHALL consume ChatRoom text-message events and current UserInfo through their Domain boundaries. It SHALL increment unread exactly once when the panel is closed and the author is not the current user. It SHALL not increment for an open panel, a self-authored message, or a non-text event.

`Initialization.ts` SHALL perform the bounded sequential initialization attempt as plain lifecycle orchestration. It SHALL obtain `AppStatusDomain` from the store, update its phase, subscribe to its Retry event, activate application dependencies, detach Runtime when required, and issue matching Toast commands. It SHALL declare no Remesh Domain and own no parallel phase, Retry, or readiness state.

The root `RemeshScope` SHALL mount exactly one `AppStatusDomain()` together with `NotificationDomain()`, `ToastDomain()`, and `AppFeedbackDomain()`. `App`, `AppButton`, `AppFeedbackDomain`, and the initialization lifecycle SHALL consume `AppStatusDomain` directly. Nested business Domains MAY be obtained by the Domain that owns the corresponding behavior; they SHALL not create another app-status owner.

#### Scenario: Root mounts one AppStatusDomain

- **WHEN** the content script creates the Remesh root
- **THEN** the root Scope SHALL contain exactly `AppStatusDomain()`, `NotificationDomain()`, `ToastDomain()`, and `AppFeedbackDomain()`, with exactly one app-status owner

#### Scenario: Initialization uses AppStatusDomain

- **GIVEN** `Initialization.ts` starts a current bounded attempt
- **WHEN** the attempt becomes ready, unavailable, or accepts Retry
- **THEN** the lifecycle SHALL read or update `AppStatusDomain`, SHALL preserve one phase and Retry authority, and SHALL declare no Remesh Domain or parallel state

#### Scenario: Incoming message updates the owned unread state

- **GIVEN** the panel is closed and `AppStatusDomain` observes an incoming text message
- **WHEN** the author differs from the current user
- **THEN** the same Domain SHALL increment its unread state exactly once and persist the updated AppStatus record through its one storage path

#### Scenario: Unread exclusions remain exact

- **WHEN** the panel is open, the text author is the current user, or the event is not a text message
- **THEN** `AppStatusDomain` SHALL not increment unread

#### Scenario: Consumers share one status authority

- **WHEN** App gates Runtime-dependent joins, AppButton derives Refresh context, AppFeedback derives Runtime feedback, or the lifecycle settles initialization
- **THEN** each consumer SHALL use `AppStatusDomain` directly and SHALL not maintain another initialization phase, Retry, open, unread, or position truth

### Requirement: Application composition is stable across readiness

The content root SHALL be `StrictMode -> RemeshRoot(store) -> RemeshScope -> App`, and `<App />` SHALL receive no initialization dependency props. No intermediate business component, readiness-selected Scope, controller, Provider, or fallback root SHALL intervene.

Inside themed `div#app`, `AppMain` SHALL precede `AppButton`, followed by `DanmakuContainer` at the app level. `AppMain` SHALL directly receive `Header`, `Main`, `Footer`, conditional `Setup`, and the one generic `Toaster` in that order. `AppMain` SHALL use `AnimatePresence -> appOpenStatus && motion.div -> children -> resize handle`, so the Toaster's actual DOM ancestry includes that positioned visual panel. Status hydration and initialization phase SHALL NOT add a condition around this hierarchy. Readiness MAY gate only a specific Runtime-dependent operation at its use site.

`App`, `AppMain`, `AppButton`, and other business components SHALL consume their hooks, Domains, stores, and services at the point of use. Initialization functions, deferred-capability activation, business-state bundles, ownership callbacks, and test-only timeout controls SHALL NOT be threaded through these components as props. Tests SHALL mock the actual use-site boundary. Among WebChat-owned components, only pure presentation components under `components` MAY receive the minimal display values and callbacks they require; a Provider, context, service locator, controller, or dependency object SHALL NOT duplicate those business boundaries. Structural `children` composition and the fixed third-party Toaster configuration do not constitute dependency bundles.

The generic `Toaster` SHALL be the last business child of `AppMain`, directly after conditional `Setup`. It SHALL NOT be passed separately into `AppMain`, rendered as the panel's sibling, hoisted to a shell with `display: contents`, mounted in another root or portal, or externalized merely to remain mounted while the panel is collapsed. Operation truth MAY outlive Toaster rendering; that independence SHALL NOT create a second or external renderer.

Source regressions SHALL use the fixed test stack: `vitest`, `happy-dom`, the complete `@testing-library/*` and `@vitest/*` families as needed, and `vitest-browser-react`. DOM/component tests SHALL use happy-dom and the applicable Testing Library packages; browser-rendered tests SHALL use Vitest Browser Mode with `@vitest/browser-playwright` and the React integration. `linkedom`, custom DOM parsers, and alternate test frameworks SHALL NOT be used for these controls. Test-only development dependencies MAY change only as required to establish this fixed stack.

Stable selectors required to verify this production hierarchy MAY be declared directly as literal `data-testid` attributes on its JSX elements. Selectors SHALL NOT be dynamically injected, passed through test-only props, hosted by test-only wrappers, or added by runtime DOM rewriting, and they SHALL NOT select or create an alternate hierarchy.

#### Scenario: Content root has one direct App chain

- **WHEN** the content script mounts WebChat
- **THEN** the root chain SHALL be `StrictMode -> RemeshRoot(store) -> RemeshScope -> App`, `<App />` SHALL have no initialization dependency props, and no intermediate business component, readiness-selected Scope, Provider, controller, or fallback root SHALL intervene

#### Scenario: App tree remains mounted during initialization

- **GIVEN** local shell-state hydration or browser-sync, page-local configuration, IndexedDB, or Runtime initialization is pending, rejected, timed out, or unavailable
- **WHEN** `App` renders
- **THEN** `AppMain` followed by `AppButton`, the ordered `Header`, `Main`, `Footer`, conditional `Setup`, `Toaster` children, and the separate `DanmakuContainer` SHALL keep one hierarchy while only exact Runtime-dependent operations remain unavailable

#### Scenario: Business components consume dependencies at use sites

- **WHEN** the production component boundary is inspected
- **THEN** `App`, `AppMain`, `AppButton`, and other business components SHALL receive no initialization function bundle, dependency activator, business-state projection, ownership callback, or test-only timeout prop; hook, Domain, store, and service boundaries SHALL be used directly, with no duplicate injection abstraction

#### Scenario: Toaster remains inside the positioned visual panel

- **GIVEN** the normal `AppMain` visual panel is rendered
- **WHEN** its ordered children mount
- **THEN** exactly one Toaster SHALL follow `Header`, `Main`, `Footer`, and conditional `Setup`, its DOM ancestor chain SHALL include the positioned `motion.div`, and it SHALL NOT be a sibling of that panel or a child of only a `display: contents` shell

#### Scenario: Stable structure selectors need no injection mechanism

- **GIVEN** a regression requires stable selectors for the root, panel, or Toaster ancestry
- **WHEN** the production JSX is instrumented
- **THEN** literal `data-testid` attributes MAY exist on current elements, while test-only props, wrappers, dynamic selector injection, and runtime DOM rewriting SHALL be absent

#### Scenario: Structure controls use the fixed test stack

- **GIVEN** the hierarchy and actual Toaster ancestor chain require DOM/component and browser-rendered regression coverage
- **WHEN** those controls execute
- **THEN** they SHALL use the applicable fixed-stack tools, `linkedom` SHALL be absent, and a custom parser or alternate test framework SHALL NOT stand in for happy-dom, Testing Library, or Vitest Browser Mode

#### Scenario: Collapsing the panel does not externalize the Toaster

- **GIVEN** initialization or another business operation owns current Toast feedback state
- **WHEN** the `AppMain` visual panel collapses or later expands
- **THEN** operation truth SHALL continue independently, while no Toaster SHALL be hoisted, duplicated, or mounted outside the visual panel to preserve visibility

## MODIFIED Requirements

### Requirement: Domain-scoped manual reconnect

The existing AppButton actions menu SHALL remain reachable from the mounted normal shell before initialization-dependent application capabilities are ready and SHALL retain one familiar Refresh slot. Before that readiness boundary, the slot SHALL represent only the current whole-initialization operation as specified by `Refresh control projects current connection loading`; unrelated menu actions MAY retain their existing individual dependency eligibility. After readiness, the same slot SHALL return atomically to the existing current-domain ChatRoom contract described below. No second initialization Retry button or ready-state reconnect control SHALL be added.

In ready application context, the actions menu SHALL include "Reconnect this site", which SHALL recover only the current domain's ChatRoom connection and re-publish that domain's presence. The `ChatRoom` extern exposes `leaveRoom()` and `joinRoom(command)`. When the current domain is joined, activation SHALL call `leaveRoom()` then `joinRoom(retainedCommand)`. When the configured domain is unjoined because its initial connection/join has not completed or terminally failed, activation SHALL build the current user/site join command and invoke `joinRoom(command)` directly without first calling `leaveRoom()`. The ready application Domain SHALL expose one derived availability truth: required user identity is configured, the initial join is not actively loading, and no Refresh-owned recovery request is active. Availability SHALL NOT require `joined`, SHALL NOT depend on Runtime readiness, and SHALL NOT read or modify the panel's expanded/collapsed state in Chrome or Firefox.

One enabled ready-context activation SHALL create one authoritative request identity and pending fact. It SHALL atomically fence another initial join or recovery, immediately invoke the selected retry/reconnect operation, preserve the main panel's current expanded/collapsed state, disable the Refresh control, and spin that control's own icon. A successful unjoined retry SHALL retain the accepted join input, reload current messages, set application join status finished, and emit the existing self-join application fact before the matching request terminal settles. A failed unjoined retry SHALL return application join status to its retryable initial state and record the same request-local error. The button SHALL expose no Ready text, success region, result badge, or second terminal state: it SHALL return to its ordinary eligible icon when the matching request terminal settles. Every callback SHALL validate the request identity so stale work cannot clear a newer request's spin or feedback. Toaster mount, paint, dismissal, failure, unmount, or absence SHALL NOT delay, cancel, reject, or redefine recovery dispatch or the independently captured network operation outcome. The request SHALL own the accepted minimum 300ms loading interval independently of DOM observation; after that interval, success SHALL cancel only the matching loading Toast without publishing `Ready to chat` or another success Toast, while failure SHALL publish the request-local error. Feedback absence SHALL NOT strand the button or duplicate gate. This pending lifetime SHALL reject duplicates only and SHALL NOT become Runtime or network authority.

The application SHALL expose one generic Toast feedback capability through `Toast.ts -> ToastExtern -> ToastImpl -> Sonner`. Initialization loading and terminal errors, reconnect, join Retry, Runtime readiness, and unrelated application notifications SHALL use that capability and the one application Toaster. Feedback sources SHALL publish commands directly through this capability and SHALL own no presenter, renderer, mounted-surface state, descriptor bus, acknowledgement, DOM-paint observer, or parallel Toast lifecycle truth. Stable IDs, dismissibility, and presentation options SHALL belong to the Toast input/command. The matching initialization or ready application request SHALL be the sole owner of operation outcome, duplicate rejection, button pending state, minimum interval, and stale-generation/request fencing. Toast state SHALL NOT become a second initialization, recovery pending, or network truth.

The one Toaster SHALL be inside the positioned `AppMain` visual panel as a direct React sibling of `Header`, `Main`, `Footer`, and conditional `Setup`. It SHALL not be an `AppMain` prop, panel sibling, second root, host-page portal, or external renderer. It SHALL use `richColors`, current `themeMode`, `offset="70px"`, `visibleToasts={1}`, `position="top-center"`, and `dark:bg-slate-950 border dark:border-slate-600` Toast classes. Initialization-specific and reconnect-specific renderers, source-specific restyling, and custom geometry, width, content-fit, placement, pointer, opacity-tracking, pseudo-element, or eligibility styles SHALL be absent. Neither initialization success, normal Runtime ready, nor successful manual Refresh SHALL publish a success Toast. Cleanup SHALL address only a matching current ID, SHALL NOT use unscoped/global dismissal, and SHALL preserve unrelated Toasts.

The App/AppMain tree SHALL keep `Header`, `Main`, `Footer`, conditional `Setup`, and the generic Toaster in one composition throughout initialization and SHALL render no independent loading, busy, unavailable, error, result, alert, or Retry status component. A current initial or user-retried initialization operation SHALL issue one `Preparing WebChat` loading command through `Toast.ts`. A current, non-superseded rejection, deadline, or unavailable result SHALL leave the page, launcher, actions menu, and current expanded/collapsed state intact; end only that attempt's control/loading ownership; cancel only its matching loading Toast; and issue one normalized `WebChat unavailable` error command. Superseded-generation and unmount cancellation SHALL publish no user error. The generic error SHALL use the default lifetime and user-dismissal/replacement rules. Ordinary Retry, ready settlement, or panel state change SHALL NOT actively dismiss the current error merely because business state changed. Raw exceptions remain diagnostic rather than user-facing copy.

Runtime lifecycle SHALL retain its immediate-replay `connecting | ready | unavailable` state for recovery and send preconditions after required initialization settles. ReadinessDomain SHALL remain the sole ready-application readiness-transition authority. Its State-setting Command SHALL compare every mapped extern input to current State: equal input SHALL perform no State write and emit no `StateChangedEvent`, while a different input SHALL update State and emit exactly one Event. The current Query SHALL remain immediately available independently of transition Events. The pre-ready initialization attempt owner SHALL remain separate from Runtime readiness and SHALL NOT add a duplicate readiness State to ClientLease, the Readiness implementation adapter, AppFeedback, or Toast feedback.

The ClientLease watchdog SHALL retain its existing five-second cadence, page lease renewal before the Coordinator's 15-second TTL, host availability probe, generation/host-id/page-attachment comparison, and real replacement/loss recovery. Equal healthy host-phase callbacks MAY still reach the Readiness extern boundary, but after mapping they SHALL NOT become application transitions. This heartbeat SHALL remain liveness infrastructure rather than proof of a new readiness fact.

Normal Runtime `connecting` MAY issue the stable loading command through `Toast.ts`, and `unavailable` MAY issue the stable error command. A genuine transition to `ready`, or an immediate current ready Query when feedback attaches, SHALL cancel only a current matching loading ID; it SHALL NOT publish `Ready to chat` or any other success Toast and SHALL NOT actively dismiss a current error. Periodic equal-state ready health samples SHALL produce neither a `StateChangedEvent` nor any AppFeedback/Toast command. Toast dismissal or automatic close SHALL NOT publish another readiness Toast or create a loop. These rules SHALL NOT change Runtime recovery or send preconditions or alter the independently request-correlated retry/reconnect operation outcome. Refresh SHALL NOT rebuild the shared WorldRoom; the Runtime SHALL auto-reconnect WorldRoom only on its own connection failure. The Options page SHALL NOT gain a global reconnect entry.

#### Scenario: Pre-ready actions menu exposes initialization Refresh

- **GIVEN** the normal shell is mounted and the ready application is not available
- **WHEN** the user opens the existing AppButton actions menu
- **THEN** the same Refresh slot SHALL be present with initialization-context eligibility and an accessible setup-retry label, while no separate panel Retry control SHALL exist and no ChatRoom reconnect SHALL be dispatched

#### Scenario: Terminal failed join is recoverable

- **GIVEN** the ready application has configured user identity, the current domain is not joined after a terminal connection/join failure, and no join or recovery request is active
- **WHEN** the actions menu renders and the user activates Refresh
- **THEN** Refresh SHALL be enabled, one request SHALL enter pending, `joinRoom()` SHALL start immediately with current user/site input, and `leaveRoom()` SHALL NOT be called

#### Scenario: Initial join remains single-flight

- **GIVEN** the automatic initial site-chat join or a ready-context Refresh-owned retry/reconnect request is actively in flight
- **WHEN** the actions menu renders or another activation is attempted
- **THEN** Refresh SHALL be disabled, the Domain SHALL admit no second request, and no concurrent `joinRoom()` or `leaveRoom()` composition SHALL start

#### Scenario: Missing identity is not an executable ready-context recovery

- **GIVEN** the ready application exists but required user identity is not configured
- **WHEN** the actions menu renders Refresh
- **THEN** Refresh SHALL be visibly disabled with an accessible non-actionable label and SHALL dispatch no ChatRoom recovery request; this ready-context rule SHALL NOT prevent pre-ready initialization Retry

#### Scenario: Successful failed-join retry establishes joined state

- **GIVEN** an enabled ready-context unjoined retry owns the current request identity
- **WHEN** `joinRoom()` accepts the current user/site command
- **THEN** the application SHALL retain that input, reload current messages, set join status finished, emit the existing self-join fact once, and record success on the same request before bounded feedback settlement returns Refresh to its eligible icon

#### Scenario: Failed retry becomes retryable again

- **GIVEN** an enabled ready-context unjoined retry owns the current request identity
- **WHEN** `joinRoom()` rejects
- **THEN** the application SHALL record the normalized error on that request, return join status to initial, settle only matching button/Toast feedback, and re-enable Refresh after the request terminal without starting an automatic loop

#### Scenario: Manual domain reconnect

- **GIVEN** the ready application's current domain is joined and no join or recovery request is active
- **WHEN** a user activates "Reconnect this site"
- **THEN** only that domain's ChatRoom connection and presence SHALL be rebuilt through the existing leave/join composition, while other domains and the WorldRoom remain undisturbed

#### Scenario: Runtime unavailable does not recreate the joined gate

- **GIVEN** the ready application has configured user identity, no join or recovery request is active, and Runtime readiness is unavailable
- **WHEN** the actions menu derives Refresh availability
- **THEN** availability SHALL depend on the recovery single-flight prerequisites rather than successful joined/readiness state, and an accepted request SHALL surface its real operation outcome through the existing request feedback

#### Scenario: Button and generic Toast entry share one ready recovery request

- **GIVEN** the ready application uses the `Toast.ts` capability and panel-owned Toaster
- **WHEN** an enabled user activates retry/reconnect and the current-domain operation succeeds or fails
- **THEN** one request identity SHALL immediately invoke the selected operation, disable and spin Refresh, and correlate one generic loading ID that is canceled on success or followed by the matching error on failure; the bounded request terminal SHALL stop only the matching spin, no success Toast SHALL be published, and neither Toast state nor the button SHALL create a second recovery state owner

#### Scenario: Reconnect does not wait for Toast rendering

- **GIVEN** the Toast library defers its subscriber update or fails to render loading
- **WHEN** an enabled ready-context user activates Refresh
- **THEN** the selected join or leave/join ports SHALL be invoked immediately, the Refresh icon SHALL represent the same pending request, and no Toaster mount, paint, or Toast state SHALL delay or alter the operation terminal or strand the icon

#### Scenario: Fast terminal reconnect respects the request interval

- **GIVEN** the join or leave/join ports settle before the request-owned 300ms minimum loading interval ends
- **WHEN** the operation outcome reaches the shared request
- **THEN** the operation outcome SHALL be captured immediately, while the matching Refresh icon and loading Toast ID remain tied to that request until the interval ends and the loading ID is canceled on success or followed by the matching error on failure, without inspecting DOM paint

#### Scenario: Stale terminal work cannot clear a newer request

- **GIVEN** one ready-context recovery has settled and a later recovery owns a newer request identity
- **WHEN** delayed minimum-interval or terminal cleanup from the older request completes
- **THEN** it SHALL NOT stop the newer Refresh spin, dismiss the newer loading or error Toast, emit a newer error, or alter the newer recovery operation

#### Scenario: AppMain owns one generic Toaster

- **WHEN** the AppMain panel renders before or after ready capability activation
- **THEN** its positioned `motion.div` SHALL contain exactly one generic Toaster after `Header`, `Main`, `Footer`, and conditional `Setup`, with `richColors`, current theme, `offset="70px"`, `visibleToasts={1}`, `position="top-center"`, and the existing dark Toast classes, without an initialization wrapper, panel sibling, portal, second renderer, or custom geometry/pointer styling

#### Scenario: Generic Toast surface carries independent business sources

- **GIVEN** unrelated application Toast feedback exists before or during initialization recovery, ready-context recovery, or a Runtime readiness transition
- **WHEN** the current source publishes or settles feedback
- **THEN** every source SHALL use the same `Toast.ts` command capability and generic Toaster, source lifecycles SHALL own no presenter, adapter, or renderer, source-local cleanup SHALL preserve unrelated IDs, and no unscoped dismissal SHALL occur

#### Scenario: Initialization failure uses Toast instead of panel error

- **GIVEN** the AppMain panel and its generic Toaster are mounted and a browser-sync, page-local configuration, IndexedDB, or Runtime initialization stage is current
- **WHEN** that stage rejects, times out, or settles unavailable while its attempt remains current
- **THEN** the panel SHALL contain no `WebChat unavailable`, alert/error/result page, or Retry button; one normalized generic error Toast SHALL present for its existing default lifetime; the shell state SHALL remain unchanged; and the actions-menu Refresh SHALL become retryable

#### Scenario: Readiness emits only actual transitions

- **GIVEN** ready-application Readiness State already equals the mapped extern input
- **WHEN** the five-second heartbeat or any other source repeats that same `connecting`, `ready`, or `unavailable` value
- **THEN** Readiness SHALL perform no State write, emit no `StateChangedEvent`, trigger no ChatRoom recovery, and publish or dismiss no Toast

#### Scenario: Real readiness transitions remain observable once

- **GIVEN** ready-application Readiness currently exposes one state through its Query
- **WHEN** the mapped extern input changes to a different `connecting`, `ready`, or `unavailable` value
- **THEN** Readiness SHALL update its State and emit exactly one matching `StateChangedEvent`, while current-state Query/replay remains available without manufacturing a duplicate transition

#### Scenario: Runtime watchdog retains lease and recovery behavior

- **GIVEN** a page lease requires renewal and the shared Runtime host may be lost or replaced without a reliable terminal event
- **WHEN** the ClientLease watchdog runs
- **THEN** it SHALL retain the five-second lease/probe/snapshot checks and initiate recovery only for a real unavailable, generation, host-id, or page-attachment change; Readiness transition dedup SHALL NOT disable or delay that liveness behavior

#### Scenario: Runtime ready dismisses only current loading without success replay

- **GIVEN** the Runtime readiness Toast uses stable ID `webchat-runtime-readiness`
- **WHEN** readiness genuinely enters ready or feedback first reads the current ready Query
- **THEN** application feedback SHALL cancel that ID only if the current feedback is matching loading, SHALL NOT publish `Ready to chat` or another success Toast, SHALL NOT actively dismiss a current error, and SHALL NOT dismiss unrelated Toasts

#### Scenario: Runtime ready settlement cannot form a Toast loop

- **GIVEN** the Runtime readiness loading ID was canceled or a prior Toast automatically closed
- **WHEN** readiness remains ready without a later connecting or unavailable transition
- **THEN** no Toast lifecycle fact SHALL republish a ready success Toast, while Runtime recovery, immediate-replay readiness truth, and request-local manual recovery outcome SHALL remain unchanged

#### Scenario: Initialization status uses only Toast.ts and the AppMain Toaster

- **GIVEN** required application initialization has not reached ready
- **WHEN** the current initial or retried attempt is active or has terminally failed
- **THEN** the App/AppMain tree SHALL keep its normal composition without any independent loading, busy, unavailable, error, result, or Retry status component; an active attempt SHALL use one matching `Preparing WebChat` command through `Toast.ts`, terminal failure SHALL use its matching `WebChat unavailable` error command, and recovery SHALL use actions-menu Refresh

#### Scenario: Closed panel retains operation ownership without an external Toaster

- **GIVEN** the main panel is collapsed and its panel-owned Toaster is not externally mounted
- **WHEN** initialization fails or an enabled user activates initialization or ready-context Refresh
- **THEN** the panel SHALL remain collapsed, the matching operation SHALL start or settle independently, Refresh SHALL project only that operation, and no second or external Toaster SHALL be created to change panel visibility behavior

#### Scenario: Ready and result feedback use generic Toast only

- **GIVEN** the AppMain Toaster is mounted for a ready-context recovery request
- **WHEN** that request captures success or failure
- **THEN** the request-correlated generic loading ID SHALL be canceled on success without `Ready to chat` or another success Toast and SHALL be followed by the matching error on failure, while Refresh SHALL expose no Ready text, success region, error region, result badge, or second result state

#### Scenario: Panel remount does not replay terminal feedback

- **GIVEN** initialization or ready-context recovery has already terminated and its generic Toast has been dismissed, expired, or replaced
- **WHEN** the panel expands, collapses, or remounts the existing Toaster
- **THEN** the terminated feedback SHALL NOT replay, no operation SHALL restart, and no new outcome owner SHALL be created

#### Scenario: Reconnect unavailable state is not a silent action

- **GIVEN** the ready application lacks required user identity, its initial join is loading, or a ready-context Refresh request is active
- **WHEN** the actions menu renders "Reconnect this site"
- **THEN** the action SHALL be visibly disabled with an accessible state label, SHALL NOT dispatch activation, and SHALL NOT accept a click that silently produces neither feedback nor an operation

#### Scenario: Panel state does not externalize Toast rendering

- **WHEN** the main plugin panel expands or collapses during initialization or ready-context recovery
- **THEN** the same operation and matching Refresh projection SHALL continue without cancellation, replay, or restart, while the Toaster SHALL follow the AppMain panel lifecycle without hoisting or duplication

#### Scenario: Reconnect cleanup is request-local

- **GIVEN** unrelated Toast feedback exists before or during ready-context recovery
- **WHEN** retry/reconnect succeeds, fails, or the main panel changes state
- **THEN** cleanup SHALL address only the generic Toast ID correlated to the matching recovery request, SHALL NOT invoke an unscoped/global dismissal, SHALL preserve all unrelated Toast feedback, and SHALL NOT affect a newer request

#### Scenario: WorldRoom self-recovery

- **WHEN** the WorldRoom connection itself fails
- **THEN** the Runtime SHALL reconnect it automatically without requiring the domain Refresh action

### Requirement: Refresh control projects current connection loading

The existing AppButton Refresh control SHALL project exactly one current operation owner for its lifecycle context. Before initialization-dependent application capabilities are ready, the current initial or user-retried initialization attempt SHALL own the control: while that attempt is active, Refresh SHALL be present in the existing actions menu, disabled, and continuously rotating; after a matching terminal failure, it SHALL become enabled and static so the user can retry the whole initialization; and after initialization success, its authority SHALL end atomically as ready capabilities activate inside the existing shell. A pre-ready Refresh SHALL NOT require configured user identity and SHALL NOT dispatch ChatRoom/WorldRoom reconnect directly.

After ready activation, the same Refresh control SHALL resume the sole fixed Runtime readiness owner rather than a local click state. Its `Connected to the chat.` Toast entry and control SHALL remain strictly aligned: whenever that ready-context owner is `loading`, including direct/automatic connection or join, Runtime reattachment, host rebuild, recovery, manual Refresh, and any accepted minimum loading dwell, Refresh SHALL be disabled and its icon SHALL rotate continuously. Passive polling or a health probe without an actual connection operation SHALL create no loading owner and SHALL not disable or rotate Refresh. If polling promotes into real connection or recovery, both projections SHALL begin once at that transition. A control that mounts or re-renders while the current owner is already loading SHALL immediately project the same disabled rotating state. Repeated activation SHALL issue no concurrent Refresh while disabled.

One accepted pre-ready activation SHALL start one fresh bounded initialization generation in the same root/store, issue its matching generic loading command through `Toast.ts` without changing the normal composition, and fence every late result from the failed or superseded generation. Matching success SHALL enable ready capabilities in place, switch Refresh to ready-context semantics, cancel only matching loading, and publish no success Toast. A current, non-superseded matching failure SHALL end rotation, restore initialization Retry eligibility, cancel only matching loading, and issue one normalized generic error through `Toast.ts` without adding any panel status view. Superseded-generation and unmount cancellation SHALL remain silent. The error SHALL use its default lifetime; business readiness or Retry SHALL NOT actively dismiss it absent an explicit successor command.

When a ready-context logical operation reaches ready, logically final failure, cancellation, or another defined terminal outcome, the fixed owner's Toast entry SHALL leave `loading` and its control loading SHALL end in the same transition. Success dismisses only current matching loading. Only a logically final connection failure replaces it with exact `Connection failed` and does not actively hide that error; an intermediate attempt, cancellation with continuation, retry/handoff, or obsolete completion SHALL not end or replace current loading. The icon SHALL stop and ordinary Refresh eligibility SHALL be recomputed atomically. Settlement from an expired, detached, aborted, stale-deadline, or superseded initialization or ready generation SHALL not stop the icon, enable the button, change context, or clear/replace feedback while a newer or continuing logical operation remains current. The control SHALL add no second loading owner, timer, connection truth, or browser-specific behavior.

#### Scenario: Initial initialization projects disabled rotation

- **GIVEN** the shell and actions-menu Refresh are mounted before ready
- **WHEN** the current initial initialization attempt is active
- **THEN** Refresh SHALL be disabled and rotate continuously, another activation SHALL start nothing, one matching generic loading Toast SHALL present, and the normal shell SHALL expose no independent status component

#### Scenario: Initialization failure restores the same Refresh

- **GIVEN** a current pre-ready initialization attempt owns disabled rotating Refresh
- **WHEN** that attempt rejects, times out, or settles unavailable while it remains current
- **THEN** only the matching rotation SHALL stop, the same Refresh SHALL become eligible for whole-initialization Retry, one matching generic error Toast SHALL present, and the panel SHALL gain no status or second Retry control

#### Scenario: Pre-ready Refresh owns one fresh initialization generation

- **GIVEN** initialization is terminally unavailable and the existing Refresh action is enabled
- **WHEN** the user activates it
- **THEN** exactly one fresh bounded initialization generation SHALL start in the same root/store, Refresh SHALL disable and rotate, one matching generic loading Toast SHALL present without changing the normal shell, and no ChatRoom or WorldRoom reconnect command SHALL dispatch

#### Scenario: Initialization success switches Refresh context without replay

- **GIVEN** a current initialization generation owns Refresh and every required dependency becomes ready
- **WHEN** ready capabilities activate inside the already mounted normal shell
- **THEN** initialization ownership SHALL terminate once, Refresh SHALL switch to existing ready-context eligibility without a success Toast, and late initialization results SHALL NOT regain control or dispatch ready operations

#### Scenario: Toast loading and ready Refresh cannot diverge

- **GIVEN** the ready-context fixed Runtime readiness owner's `Connected to the chat.` entry exists in `loading`
- **WHEN** the existing Refresh control is rendered for any manual or direct/automatic Chat connection flow
- **THEN** the button SHALL be disabled and its icon SHALL rotate for the complete same interval, with no owner transition that leaves loading Toast feedback beside an enabled or static Refresh control

#### Scenario: Polling leaves ready Refresh unchanged

- **GIVEN** the ready-context Refresh control is mounted and no connection loading owner is active
- **WHEN** polling or a health probe completes without promoting into an actual connect, join, attachment recovery, or host rebuild
- **THEN** it SHALL create no Toast loading entry, SHALL not disable or rotate Refresh, and SHALL leave ordinary eligibility unchanged

#### Scenario: Manual ready Refresh owns disabled rotation until loading ends

- **GIVEN** ready-context Refresh is ordinarily available and no connection operation is active
- **WHEN** the user activates Refresh
- **THEN** the button SHALL become disabled and its icon SHALL rotate from accepted dispatch through the same owner's complete Toast loading interval, including the accepted minimum dwell, and repeated activation SHALL start no parallel Refresh

#### Scenario: Direct Chat connection projects the same ready control state

- **GIVEN** ready-context Refresh is mounted or becomes mounted while direct/automatic Chat connection or join is active
- **WHEN** no Refresh click created that loading owner
- **THEN** the button SHALL still be disabled and the refresh icon SHALL rotate continuously until the current direct connection owner terminates

#### Scenario: Logical terminal connection failure restores ready retry

- **GIVEN** a current ready connection loading owner has disabled and rotated Refresh
- **WHEN** the logical connection operation truly terminates with no current automatic continuation, retry, or handoff capable of succeeding
- **THEN** the Toast SHALL leave loading by becoming exact `Connection failed`, rotation SHALL stop in the same owner-scoped transition, ordinary availability SHALL be recomputed so a valid retry can be enabled, and that terminal error SHALL retain its generic default lifetime

#### Scenario: Stale settlement cannot stop newer rotation

- **GIVEN** one initialization or ready loading owner was superseded and a newer current owner is active
- **WHEN** the older owner later succeeds, fails, cancels, detaches, or reaches its minimum dwell
- **THEN** it SHALL not stop the icon, enable Refresh, switch its dispatch context, clear or replace current feedback, publish a terminal error, or otherwise alter the newer owner's disabled rotating state
