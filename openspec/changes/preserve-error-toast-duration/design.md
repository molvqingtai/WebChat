## Context

The generic feedback system intentionally reuses stable Toast IDs so one source can move from loading to a terminal descriptor without adding another surface. In the confirmed failure, manual reconnect publishes `error(webchat-runtime-readiness)` while request settlement also returns aggregate readiness to `ready`. The ready reaction then emits `DismissCommand(webchat-runtime-readiness)` without distinguishing the error that now occupies that ID from the earlier loading entry.

Task #450 isolated the boundary on exact `87e93e3a...`: `error` and `dismiss` occur in the same millisecond; the Toast surface stays mounted; an unrelated Toast remains; and the runtime error is already absent from Sonner's store. The report SHA-256 is `0f2a47484f778bbba72b07f400a36211cf03738aba7a803be2a4a6ae9b285fe7`, the deterministic trace SHA-256 is `dd562f0fc0c72cec04974eb2948cd2257e8298070893a83924c84ba82f1a12d9`, and the browser observation SHA-256 is `094bda789ca2a0de5016509ee665eed59aef95765971d2a0c2af65662fb02ce2`.

The defect is therefore neither a short Sonner default duration, a successor descriptor, a Toaster remount, nor global cleanup. It is an application-owned dismissal racing its own terminal error.

## Goals / Non-Goals

**Goals:**

- Give every presented error the existing generic Toast default duration unless a user closes it or an explicit successor descriptor replaces it.
- Prevent readiness, recovery, bootstrap, panel, and request-settlement transitions from actively dismissing an error.
- Preserve active cleanup of successful/ready loading feedback without adding a success Toast.
- Keep cleanup ID-scoped, request/generation-safe, and isolated from unrelated feedback.
- Preserve existing surface teardown and terminal non-replay behavior.
- Establish deterministic FAIL-before and candidate regressions at the real Remesh-to-Sonner presentation boundary.

**Non-Goals:**

- Making errors permanent, changing the Toast library default duration, adding a custom timer, or adding persistence/replay for terminal feedback.
- Adding a second Toaster, status region, Retry control, notification, panel fallback, close button, or source-specific Toast UI.
- Changing whether a reconnect succeeds or fails, Runtime readiness truth, request settlement, button pending state, network lifecycle, or panel open state.
- Changing Toast visuals, placement, animation, stacking, theme, pointer behavior, or unrelated feedback.
- Changing protocol, storage, public APIs, dependencies, browser build behavior, PR #85, or any merge/Ready state.

## Decisions

### 1. The currently presented descriptor type controls active cleanup

A stable ID identifies the presentation slot; it does not authorize every later business state to dismiss whatever currently occupies that slot. An ID-scoped business `DismissCommand` may settle only a matching loading entry whose success/ready lifecycle owns that cleanup. If an error descriptor currently occupies the ID, no readiness, request settlement, bootstrap, panel, or ordinary application transition may actively dismiss it.

This is a behavioral boundary, not a required implementation shape. The implementation may preserve descriptor type, fence the command at its producer, or use another minimal private representation, but it SHALL retain one generic Toast authority and SHALL NOT add a second feedback state machine.

### 2. Error lifetime remains presentation-owned and finite

An error uses the existing generic Toast default duration. It receives no custom duration and is not made indefinite. While the same Toast surface remains mounted, the error may end only by:

1. the user using an existing supported manual dismissal;
2. the generic Toast default duration expiring; or
3. a later explicit descriptor replacing the same ID.

An implicit ready state or a bare `DismissCommand` is not a successor descriptor. A successor is an actual later generic Toast descriptor with the same ID and its own content/type. Replacement starts the successor's ordinary presentation lifecycle and remains allowed because the user can understand the new visible state.

### 3. Actual surface teardown removes presentation without replay

Closing the panel or ending the page/extension context may physically unmount the direct generic Toaster. The visible error naturally ceases with that surface; this is not business-driven active dismissal and SHALL NOT require a synthetic dismiss command. A terminal error that ended only because its surface disappeared SHALL NOT be replayed when a later panel surface mounts. Normal state changes while the same surface remains mounted SHALL NOT impersonate teardown.

### 4. Success and ready still clean up loading only

The existing request-correlated loading dwell and no-success-Toast policy remain unchanged. When retry/reconnect succeeds, or genuine Runtime readiness reaches ready, the business flow may dismiss only the matching current loading entry after its required dwell. It may not target a terminal error that replaced that loading entry, and delayed cleanup from an older request may not affect a newer descriptor with the same ID.

Failure still updates the matching loading entry to the error descriptor selected by its current owning route. For a genuine current-page initialization failure governed by caught-error observability, that descriptor uses exactly the original `error.message` without prefix, suffix, wrapper, mapping, normalization, or replacement copy; an initialization failure with no current affected page/live route or no user impact calls `console.error(error)` directly and creates no Toast. Other operation-specific copy, including the existing ready-context `Connection failed`, remains governed by its own authority. Once an error descriptor is published, request settlement may clear button/pending state without clearing the error presentation.

### 5. Accessibility and recovery stay independent

The existing generic Toaster continues to announce and render the error using its established accessibility and visual configuration. Removing the same-millisecond dismiss prevents the error from becoming a silent exit-animation flash; this change adds no new accessibility surface or custom dwell.

Toast lifetime does not own retryability. Existing Refresh/reconnect controls and any separately specified unavailable/Retry surface keep their own accessible state and operation semantics whether the Toast is present, manually dismissed, naturally expired, replaced, or unmounted. An error Toast is not a durable status store and its expiry SHALL NOT start a retry or change Runtime truth.

### 6. Evidence is deterministic and source-bound

The parent FAIL-before SHALL reproduce a mounted generic Toaster, a reconnect/manual connection terminal error, underlying readiness still `ready`, and the stable ID sequence `loading -> error -> dismiss`. It SHALL prove the error is removed from the Sonner store immediately while the surface and an unrelated Toast remain.

The candidate SHALL prove the same input publishes `loading -> error` with no business dismiss of that error, keeps it in the immediate mounted-store window, and permits natural default-duration expiry. Controls SHALL also prove loading-only success/ready cleanup, explicit same-ID replacement, user dismissal, real surface unmount with no terminal replay, stale-request fencing, and unrelated Toast preservation.

## Risks / Trade-offs

- [A recovered connection can coexist briefly with its preceding error Toast] -> This is intentional: the error describes the failed attempt and remains for only the existing default duration unless the user closes it or a later descriptor replaces it.
- [A shared stable ID can be reused by several connection states] -> Gate active cleanup by the currently presented semantic type and keep successor replacement explicit.
- [A panel close removes the error before duration expiry] -> Physical surface absence remains allowed and terminal feedback is not replayed; the prohibition is against business dismissal while the surface remains mounted.
- [A broad ban could strand loading forever] -> The ban applies only to current error descriptors; matching loading entries retain success/ready cleanup and existing bounded presentation settlement.
- [Error duration can vary if the generic library default changes later] -> That default is the deliberate single authority; this requirement forbids a second error-specific timer.

## Migration Plan

1. Publish this requirements-only authority from `develop@d7fa3d386250aee22a740ca84e3cd29dadbbc724` on its own requirement branch and Draft PR.
2. Add the deterministic parent FAIL-before and one minimum source child on the same branch/PR; do not modify or rebase the already-reviewed PR #85 candidate to absorb this defect.
3. Run the affected source tests and repository static/type/lint/format/build/OpenSpec gates on one immutable exact, then obtain fresh Review.
4. Do not route QA, QC, or UX unless the Owner explicitly requests one of those roles. Merge only after separate explicit Owner authorization.

No data or protocol migration exists. Before merge, rollback is the normal branch revert; after merge, reverting restores the prior active-dismiss behavior but changes no persisted state.

## Open Questions

None. The Owner explicitly selected the existing default duration rather than manual-close-only persistence and forbade business-driven active closure of error Toasts.
