## Why

WebChat must not have a separate initialization UI between the content-script root and the normal application shell. That extra rendering layer splits pre-ready and ready composition, allows feedback surfaces to sit outside the normal shell, and makes initialization decide whether the real application tree exists.

The Owner confirmed the final correction: the normal shell is the only root UI from first mount onward; initialization remains background lifecycle logic rather than a wrapper or alternate shell; every initialization loading or error state is presented through the one generic Toaster contained by that normal shell; and locally persisted expanded/collapsed state restores independently of initialization.

## What Changes

- Mount the one normal shell directly and keep the same shell, root, and store through initialization, failure, Retry, readiness, and later recovery. There is no separate initialization shell, wrapper, fallback tree, or UI phase.
- Make the existing `AppStatus` hydration and persistence lifecycle shell-owned. It SHALL restore saved expanded or collapsed state without waiting for browser-sync, page-local configuration, IndexedDB, Runtime, or ready-only capability activation.
- Keep exactly one generic Toaster inside the normal shell's React/DOM ownership. Initialization, Runtime readiness, reconnect, join retry, and unrelated application feedback SHALL use that surface; no feedback renderer may be mounted as a sibling or external surface to the normal shell.
- Represent active initialization and its current terminal failure only through generic Toast descriptors. Remove every independent loading, unavailable, error, result, or Retry status component from the panel.
- Keep the required initialization sequence, deadlines, cancellation, single-flight attempt identity, stale-result fencing, and Runtime detach behavior as non-presentational lifecycle logic. Initialization MAY gate only capabilities that depend on it and SHALL never gate or replace the shell.
- Keep the existing AppButton actions menu reachable before readiness. Its existing Refresh slot SHALL retry the whole initialization while dependent application capabilities are not ready; after readiness, the same slot SHALL retain its existing current-site ChatRoom retry/reconnect behavior.
- Project the current accepted operation through the same Refresh control: disabled and rotating while its initialization or ready-application operation is in flight, duplicate activations rejected, stale generations fenced, and ordinary eligibility restored at the matching terminal. Success SHALL publish no success Toast.
- Preserve one shell-status owner and one Toast presentation owner across failure, Retry, and readiness. A pre-hydration user expand/collapse SHALL win over an older stored snapshot, and old document or initialization work SHALL not overwrite the current shell.
- Add deterministic controls proving direct normal-shell ownership, the absence of alternate status UI, shell-contained Toaster ownership, context-sensitive Refresh, dependency gating, single-flight operation, and stale-result protection.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Make the normal shell the only UI root throughout initialization, carry every initialization status through its one generic Toaster, and restore persisted shell state independently of initialization.

## Impact

- Affected implementation after authority approval: content-root and normal-shell composition, initialization orchestration ownership, shell-lifetime `AppStatus` and generic Toast ownership, AppButton actions-menu availability, context-sensitive Refresh dispatch, and focused regressions.
- Affected behavior: refresh immediately mounts the normal shell, restores the saved expanded/collapsed choice during every initialization outcome, displays initialization loading/failure only as Toast feedback, and retries initialization from AppButton Refresh without any alternate status view.
- Superseded behavior: any clause that preserves an initialization-specific loading shell, panel-local status/Retry surface, or a wrapper that creates the normal application only after initialization succeeds.
- Unchanged: initialization dependency order and deadlines; dependency-based capability gating; the `AppStatus` storage key/record/version and no-record default; unread/position semantics; ready-state ChatRoom Refresh scope; Runtime/protocol/public APIs; generic Toast descriptor, accessibility, default lifetime, and no-success-Toast policies; visual theme/configuration; browser permissions and dependencies.
- The Chromium cross-world preload warning, mandatory initialization-stage logging, timeout redesign, raw diagnostic copy, new error page, automatic opening, and visual redesign are outside this change.
- QA, QC, and UX are not part of this task unless the Owner later requests them explicitly. Merge follows the established acceptance and authorization flow.
