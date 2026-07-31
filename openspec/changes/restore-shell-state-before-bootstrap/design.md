## Context

WebChat mounts a local shell before browser-sync preparation, page-local configuration preparation, MessageStore/IndexedDB preparation, and shared Runtime initialization finish. The shell has persisted `open`, `unread`, and `position` state. Initialization has an in-memory `connecting | unavailable | ready` phase and Retry action. Incoming messages can update unread. These are one app-status lifecycle and use one `AppStatusDomain`.

## Goals / Non-Goals

**Goals:**

- Keep one normal shell mounted independently of status hydration and application initialization.
- Make `AppStatusDomain` the sole owner of shell state, initialization state, Retry, and the incoming unread effect.
- Keep initialization sequencing as plain lifecycle orchestration in `Initialization.ts`.
- Let `App`, `AppButton`, and `AppFeedbackDomain` consume the same status authority directly.
- Keep one panel-owned generic Toaster and one context-sensitive Refresh control.
- Preserve user interaction and current-generation truth across asynchronous settlement.

**Non-Goals:**

- Changing the persisted AppStatus key, record shape, or field semantics.
- Changing initialization stage order, deadlines, cancellation, Runtime detach, or dependency activation.
- Changing ChatRoom, WorldRoom, Runtime, protocol, public APIs, permissions, production dependencies, or visual design.
- Adding another app-status store, initialization-status owner, Retry control, Toaster, success Toast, Provider, controller, or dependency-injection surface.
- Changing generic Toast lifetime, dismissal, or replacement behavior.

## Decisions

### 1. The root has one exact composition

The content root is `StrictMode -> RemeshRoot(store) -> RemeshScope -> App`. The root Scope mounts exactly `AppStatusDomain()`, `NotificationDomain()`, `ToastDomain()`, and `AppFeedbackDomain()`. Nested business dependencies remain owned by the Domains that consume them.

Inside themed `#app`, `AppMain` precedes `AppButton`, followed by `DanmakuContainer`. `AppMain` directly contains `Header`, `Main`, `Footer`, conditional `Setup`, and the generic `Toaster` in that order. Status hydration and initialization phase do not select or replace this component tree.

### 2. AppStatusDomain is the single app-status owner

`AppStatusDomain` owns persisted `open`, `unread`, and `position` in the one AppStatus storage record. It also owns the non-persisted initialization phase, the Retry command/event, and the effect that increments unread for an incoming text message from another user while the panel is closed.

Initialization phase never enters the persisted record. Unread processing uses the same `OpenQuery`, `UnreadQuery`, and update command as the rest of AppStatus. The Domain exposes only the queries, commands, and events required by its consumers.

### 3. Initialization.ts is lifecycle orchestration

`Initialization.ts` owns the ordered asynchronous attempt: browser-sync storage, local configuration storage, message database, Runtime initialization, application dependency activation, and Runtime detach. Each attempt has one deadline, AbortSignal, generation, and terminal.

The lifecycle obtains `AppStatusDomain` from the store, sends its phase commands, and subscribes to its Retry event. It issues `Preparing WebChat` and `WebChat unavailable` through `Toast.ts`. It declares no Remesh Domain and owns no phase state parallel to `AppStatusDomain`.

### 4. Consumers use AppStatusDomain directly

`App` reads the initialization-ready query before dispatching Runtime-dependent ChatRoom and WorldRoom operations. `AppButton` reads phase and sends Retry before ready, then uses the ChatRoom recovery contract after ready. `AppFeedbackDomain` reads readiness from `AppStatusDomain` before projecting Runtime feedback. The initialization lifecycle reads and updates the same Domain through the store.

Business components do not receive initialization functions, state bundles, ownership callbacks, or test-only timing controls as props. Tests mock the actual Domain, store, service, and extern boundaries.

### 5. Shell state is independent of dependencies

The normal component tree and AppStatus hydration start as soon as the configured DOM anchor is available. Browser-sync preparation, page-local configuration, IndexedDB, Runtime, and application readiness do not gate shell creation or persisted state restoration.

The mounted root owns one hydration and persistence lifecycle. If the user expands or collapses the panel while hydration is pending, that accepted choice wins over the stored snapshot and flows through the same persistence path. A stale document or attempt cannot mutate current shell state.

### 6. The panel Toaster is the only status surface

The generic `Toaster` is the final business child of `AppMain`, inside its positioned `motion.div`. `Toast.ts -> ToastExtern -> ToastImpl -> Sonner` is the one Toast capability for initialization, Runtime readiness, reconnect, join Retry, and unrelated notifications.

An active initialization attempt publishes one `Preparing WebChat` loading command. A current terminal failure cancels only its matching loading ID and publishes one `WebChat unavailable` error. Success cancels only matching loading and publishes no success Toast. Operation truth remains independent of Toaster mount and paint.

### 7. Refresh has two exclusive contexts

Before ready, the AppButton Refresh slot reflects the current initialization attempt: active is disabled and rotating; unavailable is enabled and static; activation starts one bounded Retry. It requires no configured user identity and does not dispatch ChatRoom or WorldRoom recovery.

At ready, the same slot switches atomically to current-site ChatRoom retry/reconnect. This context retains its identity, join/rejoin scope, minimum loading interval, and WorldRoom exclusion. Initialization cannot regain control after the switch.

### 8. Current operation identity fences asynchronous work

Initialization and ready-context recovery each admit one current operation in their exclusive context. Duplicate activation starts nothing. Matching terminal settlement updates only its own control and Toast ID. Aborted, detached, timed-out, unmounted, and stale generations cannot clear or replace current feedback, enable Refresh, switch context, or write shell state.

### 9. Tests bind final ownership

Regression controls verify the exact root Domain list, one `AppStatusDomain` declaration and mount, no additional app-status state owner, plain `Initialization.ts` orchestration, and direct App/AppButton/AppFeedback consumers. They also cover component ancestry, persisted expanded/collapsed/no-record state, pre-hydration interaction, incoming self/non-self/open/closed unread cases, initialization stage terminals, Retry contexts, single-flight behavior, and stale settlement.

The fixed stack is `vitest`, `happy-dom`, the applicable `@testing-library/*` and `@vitest/*` packages, `vitest-browser-react`, and `@vitest/browser-playwright`. Stable selectors may be literal `data-testid` attributes on production JSX. Tests do not add production dependency props, wrappers, dynamic selector injection, or runtime DOM rewriting.

## Risks / Trade-offs

- [One Domain spans durable and transient status] -> Keep persistence attached only to the AppStatus record; initialization phase remains in-memory.
- [Unread effect introduces ChatRoom/UserInfo dependencies] -> Keep the effect inside the Domain that owns unread and use the established nested Domain boundaries.
- [Normal shell can render while dependencies are unavailable] -> Gate only the exact Runtime-dependent operation at its use site.
- [One Refresh can dispatch the wrong operation at readiness] -> Use the single initialization phase as the exclusive context switch and fence attempt identity.
- [Late hydration or attempt settlement can overwrite current state] -> Preserve user-updated open state and validate the current shell/attempt generation before every asynchronous terminal.

## Validation

Validate the four OpenSpec artifacts strictly, format the repository, and verify the docs-only authority diff. The source exact must pass focused final-result controls, the complete repository source gates, fresh architecture-first Review against `The-Absolute-Code.md`, exact CI, and identity checks before Owner acceptance.
