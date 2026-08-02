## Context

The released application exposes Refresh through the content actions menu. Both the view and `ChatRoomDomain.ReconnectCommand` currently require a finished initial join, so a rejected initial `chatRoom.joinRoom()` resets join status to initial and leaves Refresh disabled. This contradicts the control's recovery purpose.

The existing application already has the required request lifecycle: one reconnect request ID owns duplicate rejection, the button pending state, generic Toast correlation, bounded presentation settlement, terminal outcome, and stale fencing. The repair must extend that same lifecycle to an unjoined retry without adding a second recovery owner.

The frozen eight-method `ChatRoomExtern` already provides `joinRoom()` and `leaveRoom()`. No Runtime, protocol, persistence, WorldRoom, or presentation API expansion is needed.

## Goals / Non-Goals

**Goals:**

- Make Refresh actionable after a configured user's initial site-chat join fails.
- Prevent concurrent activation while the initial join or a Refresh-owned recovery is active.
- Preserve the established joined-domain leave/join composition.
- Make retry success establish the same joined application state as a normal initial join.
- Make retry failure return to a visibly retryable action after the matching feedback lifecycle settles.
- Keep one derived eligibility truth and one existing request lifecycle.

**Non-Goals:**

- No global Runtime restart, WorldRoom rebuild, or cross-domain reconnect.
- No `ChatRoomExtern`, protocol, database, persistence, dependency, WXT, workflow, or browser-specific change.
- No panel mutation, bootstrap fallback, fixed readiness view, second Toast renderer, or reconnect-specific presenter.
- No automatic retry loop, background retry policy, or change to Runtime-owned recovery.
- No change to the existing joined-domain reconnect network outcome or logical-presence semantics; only its successful Toast result is removed by the cumulative repair.

## Decisions

### 1. ChatRoom Domain owns derived Refresh eligibility

`ChatRoomDomain` SHALL expose a derived eligibility Query computed from existing facts:

- current user identity is configured;
- the initial join status is not loading; and
- no Refresh-owned reconnect request exists.

The Query SHALL NOT require `JoinIsFinishedQuery`, inspect `panelOpen`, or create new stored state. `ReconnectCommand` SHALL guard on that Query, and the actions-menu button SHALL consume the same Query. This keeps rendering and command admission aligned without a second eligibility truth.

Alternative rejected: change only `isReconnectAvailable()` in the React view. The Domain would continue rejecting the command while unjoined, producing an enabled button that silently does nothing.

Alternative rejected: availability equals only `!reconnecting`. That would expose an actionable control before user identity exists and permit a second join while the automatic initial join is already active.

### 2. One command selects retry or reconnect from current join status

An accepted `ReconnectCommand` SHALL create the existing request identity and events exactly once, then capture one internal operation mode:

- **joined mode**: retain the existing `leaveRoom()` followed by `joinRoom(retainedInput)` composition;
- **unjoined retry mode**: atomically mark the join status loading, rebuild input from the current configured user and site, and call `joinRoom(input)` directly without `leaveRoom()`.

The operation mode is request-local internal routing data, not a public port or second pending state. Setting join status loading in the same command prevents the automatic initial-join effect or a second Refresh activation from starting a concurrent join.

Alternative rejected: call `leaveRoom()` unconditionally. A failed initial join has no joined room to leave, and a leave failure would prevent the intended retry.

Alternative rejected: dispatch the existing `JoinRoomCommand` separately from the reconnect request. That would split operation outcome from the button/Toast request identity and weaken duplicate and stale fencing.

### 3. Retry completion reuses normal join state transitions

Successful unjoined retry SHALL apply the same application completion as normal join: retain the accepted join input, reload the message list, set join status finished, and emit the existing self-join application event. The matching reconnect request then records success through its existing terminal command. The existing App effect can subsequently join WorldRoom; Refresh itself does not rebuild WorldRoom.

Failed unjoined retry SHALL apply the existing join-failure transition, returning join status to initial and emitting the existing error event, while also recording the same error on the matching reconnect request. Once request-correlated feedback settles or is boundedly omitted, the request clears and eligibility becomes true again.

Alternative rejected: treat an unjoined `joinRoom()` success only as reconnect-request success. That would leave application join status false and keep downstream Chat/World behavior inconsistent with the accepted connection.

### 4. Presentation ownership and panel contracts remain unchanged

The existing request ID continues to drive button disabled/spinning behavior and generic Toast loading/error feedback. Toast mount, paint, dwell, failure, or absence remains unable to delay or redefine the network operation. After an accepted 300ms visible loading dwell, success dismisses only that request's loading entry and publishes no `Ready to chat` or other success descriptor; genuine failure updates the matching entry to the request-local error. The action preserves the panel's open/closed state and uses the original direct `AppMain -> <Toaster>` surface when present.

The accessible label MAY distinguish an unjoined retry from an already joined reconnect, but no Ready region, result badge, fallback view, new renderer, or custom visual treatment is added.

### 5. Verification binds both recovery modes and admission fences

Focused Domain tests SHALL prove configured unjoined retry success and failure, absence of `leaveRoom()` on retry, normal join-state completion, retry re-eligibility, initial-join single-flight, missing-identity rejection, joined leave/join preservation, duplicate rejection, success dismissal without `Ready to chat`, request-local error Toast settlement, and stale fencing.

Focused view tests SHALL prove the button uses the Domain eligibility Query, remains panel-independent, is enabled for configured terminal unjoined state, is disabled for join/reconnect in-flight states, and retains pending icon behavior and accessible retry/reconnect labels.

## Risks / Trade-offs

- [A brief configured pre-join state is eligible before the automatic App effect runs] -> Command admission atomically sets join loading and starts the same valid join, so whichever path wins remains single-flight.
- [Retry success and reconnect success share existing `ReconnectFinishedEvent` naming] -> Preserve the stable internal feedback contract; mode remains request-local and does not justify a second lifecycle.
- [Join failure emits both the existing room error and request-correlated Toast error] -> Preserve existing error observability while the generic request feedback remains the only user-facing recovery result; do not add a success result.
- [A later refactor could reintroduce view/Domain drift] -> Remove joined-based view admission and test the shared derived Domain Query at both command and button boundaries.

## Migration Plan

1. Freeze this OpenSpec change as a clean docs-only child of `develop@ad874b18404c62bfc10556e21460949cb782142d`.
2. Implement the derived eligibility Query and mode-aware single-flight recovery in the application ChatRoom Domain.
3. Bind the actions-menu button to the Domain Query and update focused labels/tests without visual restructuring.
4. Run focused and full repository gates on one immutable source exact, followed by fresh independent Review.
5. Publish by normal fast-forward only after the live remote base is verified; stop on drift.

Rollback is code-only: revert the focused application/view repair. It changes no persisted data, protocol, manifest, schema, Runtime host, or user migration.

## Open Questions

None. The Owner has explicitly defined Refresh as the recovery action for failed connection/join, and the narrow behavior above follows that decision.
