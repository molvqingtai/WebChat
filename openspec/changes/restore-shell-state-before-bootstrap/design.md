## Context

WebChat requires asynchronous browser-sync preparation, page-local configuration preparation, MessageStore/IndexedDB preparation, and shared Runtime initialization before particular Runtime-backed operations can execute. Those dependencies are not page-rendering inputs. Business components obtain them through their existing hooks, Domains, stores, and services at the use site.

Remote release tag `v1.9.7` resolves to exact `b5f1b0183a80ba089ad8e51f15f40dabd8089a50` and is the frozen component-composition reference. Its content root is `StrictMode -> RemeshRoot(store) -> RemeshScope -> App`; the example Domain list is not a contract and this change does not replace the current business-required set. `App` receives no initialization dependency props and there is no `Application` middle layer. The original component order and panel-owned Toaster placement remain unchanged, but historical whole-page gates are not frozen: `appStatusLoadIsFinished` is removed alongside initialization `ready` gating.

## Goals / Non-Goals

**Goals:**

- Keep the frozen `v1.9.7` content-root, `App`, and `AppMain` composition through initialization, terminal failure, user Retry, ready capability activation, and later recovery.
- Render the page independently of `ready`; use readiness only at the specific Runtime-dependent business operation.
- Remove initialization, activation, business-state, and test-only dependency props from business components and consume existing capabilities where they are used.
- Start local shell-status hydration/persistence and the existing `Toast.ts` feedback path from that shell lifetime.
- Remove every initialization wrapper, alternate shell, fallback view, and independent loading/error/result component.
- Express initialization loading and failure only through the original Toaster inside the `AppMain` visual panel.
- Make the existing Refresh control dispatch the current lifecycle operation and project its single-flight state.
- Preserve newer shell interaction and fence late initialization, hydration, and old-document results.

**Non-Goals:**

- Removing the required initialization sequence, its deadlines/cancellation, dependency gating, Runtime detach behavior, or attempt identity.
- Adding an error page, second Toaster, second Retry control, success Toast, automatic open, raw exception text, or visual redesign.
- Replacing dependency props with a new Provider, context, controller, service locator, or injection abstraction.
- Adding a second Toast Domain or presentation adapter instead of using the existing `Toast.ts` capability.
- Changing generic error duration/replacement/dismissal rules, ready-state ChatRoom reconnect scope, WorldRoom recovery, or Runtime readiness truth.
- Changing storage schema/version/key, unread/position semantics, initialization stage order/deadlines, protocol, public APIs, permissions, or production dependencies.
- Repairing the WXT/Chromium preload warning or requiring stage-specific production logging.

## Decisions

### 1. The content root has one exact composition

The content-script root preserves the `v1.9.7` component hierarchy `StrictMode -> RemeshRoot(store) -> RemeshScope(existing required Domains) -> App`. There is no other component between those ownership layers, no `Application` middle layer, no additional root-level Scope selected by initialization, and no initialization prop on `<App />`. The Domain list remains the current business composition and is not narrowed to the sample list from `v1.9.7`. This freezes component ownership, not historical whole-tree rendering gates.

Inside the themed `#app`, render `AppMain` then `AppButton`, followed by `DanmakuContainer` at the app level. `AppMain` directly receives `Header`, `Main`, `Footer`, conditional `Setup`, and the generic `Toaster` in that order. Remove the historical `appStatusLoadIsFinished` condition and every initialization `ready` condition around this tree. Failure or Retry changes operation availability and feedback, never page identity or composition.

### 2. Business components own dependencies at their use sites

`App`, `AppMain`, `AppButton`, and other business components do not receive initialization functions, deferred-capability activators, business-state bundles, ownership callbacks, or test-only timeout controls as props. They use existing hooks, Domains, stores, and services where the capability is needed. Tests mock those boundaries rather than changing the production component API. The `Application` component introduced after `v1.9.7` is not part of the frozen hierarchy.

Among WebChat-owned components, pure presentation components under `components` may receive the minimal values and callbacks required to render. This exception does not permit repackaging business dependencies or adding a Provider, context, controller, service locator, or injection layer to preserve the same indirection. Ordinary structural `children` composition and the fixed third-party Toaster configuration are not dependency bundles.

### 3. Initialization is lifecycle logic, not presentation

Keep one bounded current attempt for the required sequential dependency preparation. Each attempt retains its deadline, cancellation, Runtime-start/detach boundary, duplicate rejection, and generation fencing. A stale, aborted, unmounted, or superseded result cannot mutate current feedback, Refresh eligibility, capability availability, or shell state.

This orchestration may be implemented as a hook/service or equivalent non-presentational owner invoked from the normal shell lifecycle. It must not return or select an alternate shell/status tree. The product contract does not preserve a wrapper component or source filename.

### 4. The original panel-owned Toaster is the only status surface

The frozen `AppMain` children are `Header`, `Main`, `Footer`, conditional `Setup`, and exactly one generic `Toaster` as direct React siblings. `AppMain` retains `AnimatePresence -> appOpenStatus && motion.div -> children -> resize handle`, so the Toaster's DOM ancestry includes that positioned `motion.div` visual panel. It is not passed separately into `AppMain`, rendered beside the panel, mounted as a second root or host-page portal, or moved to an external container to remain visible while the panel is collapsed.

`Toast.ts -> ToastExtern -> ToastImpl -> Sonner` is the sole Toast capability. `ToastPresentation.ts` and `toast-presentation.tsx` are removed. If initialization or reconnect requires a stable ID, dismissibility, or another presentation option, extend the existing Toast command/input minimally rather than creating a second Domain, mounted-surface state, descriptor bus, acknowledgement protocol, or DOM-paint observer.

An active initial or user-retried initialization attempt issues one `Preparing WebChat` loading command through `Toast.ts`. A current terminal rejection, timeout, or unavailable result cancels only that attempt's matching loading ID and issues one normalized `WebChat unavailable` error command. Superseded-generation and unmount cancellation remain silent. Success cancels only matching loading and publishes no success Toast.

There is no independent loading, unavailable, error, result, alert, busy, or Retry status component. Toaster rendering, unmount, default expiry, or user dismissal cannot redefine attempt truth or Refresh eligibility. Ready Runtime/reconnect and unrelated sources use the same existing Toast commands and retain source-local operation ownership.

### 5. Shell-local state starts before dependencies

Mount the normal component tree and start the existing local `AppStatus` hydration/persistence without making the read or any application dependency a rendering prerequisite. The panel may first show its historical default while the read is pending, then apply the saved expanded or collapsed choice independently of browser-sync, page-local configuration, IndexedDB, or Runtime.

Keep one state authority and one storage record. If a current combined effect includes Chat, World, database, Runtime, unread, or other dependency-backed work, isolate or gate that work rather than igniting it early merely to reach shell-local behavior. A second React state mirror, durable timestamp, storage key, or parallel shell store is rejected.

### 6. Refresh is a shell action adapter with two exclusive contexts

Keep one familiar Refresh slot in the existing AppButton actions menu. Before dependent application capabilities are ready, its availability and dispatch come only from the current initialization attempt: active attempt means disabled/rotating; terminal failure means enabled/static; activation starts one fresh bounded attempt in the same shell. It does not require user identity and does not call ChatRoom, WorldRoom, or Runtime reconnect directly.

After ready capability activation, the slot switches atomically to the existing current-site ChatRoom retry/reconnect contract, including its identity, join/rejoin scope, fixed readiness owner, and WorldRoom exclusion. The initialization owner is then terminal and cannot regain dispatch authority. Context-specific accessible labels distinguish setup Retry from current-site reconnect without adding another visible control.

### 7. Operation state is single-flight and presentation-independent

Initial initialization and each accepted initialization Refresh have one current generation. The Refresh icon projects only that current attempt while pre-ready. A duplicate click starts nothing; the matching terminal stops its rotation and recomputes eligibility; stale completion cannot stop or enable a newer attempt. Success enables ready capabilities in the existing shell and publishes no success Toast. Failure publishes the matching generic error independently, leaving Refresh retryable.

The ready-application connection owner continues to control its own loading/Toast/Refresh interval after the context switch. Initialization and ChatRoom owners never run as competing Refresh authorities.

### 8. A newer user shell choice wins hydration

The initial stored snapshot is older than an expansion or collapse accepted while the read is unresolved. Preserve the accepted current `open` value when hydration settles and persist it through the single shell-owned write path. Existing fields untouched by that interaction retain their current hydration semantics. Retry and ready capability activation do not repeat the initial read or mount another watcher.

A genuine document replacement owns a new shell lifecycle. Cancellation or an equivalent live-generation guard prevents an old asynchronous hydration, persistence, or initialization continuation from mutating the replacement.

### 9. Evidence binds final ownership

Regression controls record only the final result: the content root, `App`, and `AppMain` match the frozen `v1.9.7` component hierarchy; `<App />` has no initialization props or `Application` middle layer; neither `appStatusLoadIsFinished` nor initialization `ready` creates a composition branch; the sole Toaster is a sibling of the page content and a descendant of the positioned `AppMain` panel; all feedback uses `Toast.ts` without a presentation Domain/adapter; and business dependencies are consumed at use sites without replacement injection. The same suite covers every initialization stage class, expanded/collapsed/no-record hydration, pre-hydration interaction, loading/error Toast delivery, initial and manual single-flight, same-page success, context switch to ChatRoom reconnect, duplicate effects, and stale generations.

Run those unchanged final-result assertions against the implementation parent to establish fail-before; do not add an assertion that accepts or preserves the parent's transitional structure. Because collapsed equals the default, its control must also prove the stored snapshot was consumed rather than passing because hydration did not run. Structure-sensitive controls must inspect the real rendered ancestry: sharing a React root or Shadow root is insufficient, and the Toaster being a sibling of `[data-webchat-panel]` is a failure.

The fixed test stack is `vitest`, `happy-dom`, the complete `@testing-library/*` and `@vitest/*` families as needed, and `vitest-browser-react`. DOM/component controls use happy-dom and the applicable Testing Library packages; browser-rendered controls use Vitest Browser Mode through `@vitest/browser-playwright` and the React integration. `linkedom`, a custom DOM parser, and an alternate test framework are not accepted substitutes. Test-only development dependencies may change only to establish this fixed stack.

Stable test selectors may be literal `data-testid` attributes on the existing production JSX. Do not dynamically inject selectors, add test-only component props or wrappers, or rewrite the runtime DOM. A selector is static observability only; it cannot create another structure or behavior.

## Risks / Trade-offs

- [Normal application composition can touch unavailable dependencies] -> Keep the page mounted and guard only the exact Runtime-dependent operation at its use site.
- [Removing dependency props reduces test injection points] -> Mock the existing hook/Domain/store/service boundary; do not preserve a production prop solely for tests.
- [The normal tree briefly renders the default before asynchronous hydration] -> Apply the saved choice as soon as the independent read settles and preserve a newer user choice; never block component creation on storage.
- [A panel-owned Toaster is hoisted to remain visible while collapsed] -> Keep operation truth independent of Toaster rendering, and never externalize or duplicate the renderer to change panel lifecycle.
- [One Refresh can dispatch the wrong operation during transition] -> Use an exclusive initialization/ready context boundary and fence old attempts before enabling ChatRoom dispatch.
- [Toast settlement can be mistaken for operation truth] -> Keep attempt outcome and eligibility in lifecycle logic; existing Toast commands only project feedback.
- [A late read or attempt can overwrite current UI] -> Preserve newer interaction and current-generation checks at each asynchronous settlement.

## Migration Plan

1. Publish this corrected requirements authority as a docs-only child on the existing branch and Draft PR.
2. Add deterministic structure-sensitive final-result controls for the frozen `v1.9.7` root/App/AppMain component tree, prop-free `App`, absence of an `Application` middle layer or whole-tree `appStatusLoadIsFinished` / initialization-ready branch, real panel ancestry, and single `Toast.ts` path; establish fail-before on the parent without encoding its transitional behavior as expected output.
3. Replace that composition on the same branch/PR: restore the frozen `v1.9.7` component hierarchy, consume dependencies inside business components, remove both whole-tree rendering gates and the `ToastPresentation` layer, and route every status through existing `Toast.ts` and the original panel-owned Toaster.
4. Run focused and repository source gates, strict OpenSpec, exact identity checks, CI, and fresh independent Review on one immutable candidate.
5. Do not route QA, QC, or UX unless the Owner explicitly requests that role. Follow the established Owner acceptance and conditional merge-authorization flow.

No persisted-data migration exists. Reverting the source repair changes rendering and lifecycle ownership only; it does not change stored data format.
