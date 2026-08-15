## Why

WebChat needs one normal shell whose local status and initialization status have one owner. Shell rendering and persisted status are available immediately, while Runtime-dependent capabilities remain gated until their required initialization completes. A single owner prevents duplicate phase, Retry, unread, hydration, and effect lifecycles.

## What Changes

- The content root is `StrictMode -> RemeshRoot(store) -> RemeshScope -> App`. The root Scope mounts exactly `NotificationDomain()` and `AppFeedbackDomain()`; `AppFeedbackDomain` owns its nested `AppStatusDomain` and `ToastDomain` dependencies.
- `AppStatusDomain` is the single owner of one aggregate `open`, `unread`, and `position` business truth; non-persisted initialization phase and Retry; and the incoming non-self text-message effect that marks boolean unread attention while the panel is closed.
- `AppStatusDomain` exposes only production-consumed queries, commands, and events. Hydration, persistence, and unread mutation actions plus storage synchronization events remain file-local, and tests exercise real storage and public projections without test-only exports.
- `Initialization.ts` performs only the bounded initialization lifecycle: ordered dependency preparation, deadline and cancellation, generation fencing, application dependency activation, Runtime detach, and matching feedback commands. It reads and updates `AppStatusDomain` without declaring another Domain. A genuine failure owned by the current page uses the existing Toast route with its original `error.message`; no-page or user-irrelevant failures use direct `console.error(error)` diagnostics.
- `App`, `AppButton`, and `AppFeedbackDomain` consume `AppStatusDomain` directly. Readiness gates only the Runtime-dependent operation at its use site.
- The normal `AppMain`, `AppButton`, and `DanmakuContainer` composition mounts independently of status hydration and initialization. `AppMain` contains `Header`, `Main`, `Footer`, conditional `Setup`, and one panel-owned generic `Toaster`.
- The AppButton actions menu exposes one Refresh slot. It owns initialization Retry before ready and the current-Domain retry/reconnect result after ready, with one disabled/rotating single-flight projection and matching generic Toast feedback; the active ready-state manual-refresh contract starts a separately fenced World replacement without giving that child UI ownership.
- Shell hydration, initialization, Retry, and unread processing share the one mounted `AppStatusDomain` lifecycle. A user open/close choice accepted while hydration is pending wins over the stored snapshot.
- Deterministic tests verify the final root Domain list, single ownership, plain lifecycle orchestration, direct consumers, component ancestry, hydration races, unread rules, Refresh contexts, and stale-result fencing with the fixed Vitest stack.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Defines one AppStatus owner for shell state, initialization state, Retry, and unread effects while preserving independent shell rendering and Runtime-dependent capability gating.

## Impact

- Affected source: `AppStatusDomain`, `Initialization.ts`, the content root Scope, `App`, `AppButton`, `AppFeedbackDomain`, and their focused tests.
- Affected behavior: persisted shell state is available independently of initialization; initialization feedback uses the panel Toaster; Refresh changes context at readiness; incoming non-self messages mark boolean unread attention only while the panel is closed.
- Unchanged by this shell change: the field-scoped open, position, and unread key identities and semantics; initialization stage order and deadlines; Runtime/protocol/public APIs; automatic ChatRoom and WorldRoom recovery ownership; pre-ready Retry dispatch; Toast identity, presentation, and lifetime; visual theme; browser permissions; production dependencies. Initialization failure copy follows the current-owner routing above without decoration or replacement. The active manual-refresh contract governs the ready-state sibling World replacement.
- QA, QC, and UX are outside this task unless the Owner explicitly requests a corresponding role.
