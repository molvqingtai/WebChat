## Why

Merged `develop@8419cf36e14a679c83e0b77f84a5a81006871292` now mounts a launcher and panel shell before asynchronous bootstrap, but two product boundaries are wrong. The existing `AppStatus` read/write lifecycle starts only inside the ready application, so refresh cannot restore a saved expanded state while any bootstrap stage is pending or unavailable. The same bootstrap layer also added a panel-local `WebChat unavailable + Retry` error surface.

The Owner confirmed the unified correction: refresh first mounts the normal loading shell and restores its locally persisted expanded/collapsed state; a bootstrap failure is generic application feedback presented by Toast, not a second shell error page; and the user retries from the existing Refresh action in the AppButton actions menu. This is a corrective requirement on its own branch and PR, not a rewrite of the already merged PR #85 history.

## What Changes

- Keep one normal shell mounted before bootstrap. The open panel retains the existing `Preparing WebChat` loading content while an initial or retried bootstrap attempt is active.
- Make the existing `AppStatus` hydration and persistence lifecycle shell-owned. It SHALL restore saved expanded or collapsed state without waiting for browser-sync, page-local configuration, IndexedDB, Runtime, or ready application activation.
- Move the one existing generic Toast presentation lifecycle to the shell lifetime so it can present bootstrap errors before the application is ready and while the panel is collapsed. Do not add a bootstrap-specific Toaster, presenter, or feedback state.
- Remove the panel-local bootstrap error and Retry presentation. A current, non-superseded bootstrap rejection, timeout, or unavailable result SHALL preserve the shell and current expanded/collapsed state, publish one normalized generic error Toast with the existing default lifetime, and expose no `WebChat unavailable` panel page or separate Retry button. Superseded or unmounted work SHALL remain silent.
- Keep the existing AppButton actions menu reachable before readiness. Its existing Refresh slot SHALL retry the whole bootstrap while the application is not ready; after readiness, the same slot SHALL retain its existing current-site ChatRoom retry/reconnect behavior.
- Project the current accepted operation through one Refresh control: disabled and rotating while its bootstrap or ready-application operation is in flight, duplicate activations rejected, stale generations fenced, and ordinary eligibility restored at the matching terminal. Success SHALL publish no success Toast.
- Keep one root/store, one status owner, and one Toast surface across failure, Retry, and ready activation. A pre-hydration user expand/collapse SHALL win over an older stored snapshot, and old document/bootstrap work SHALL not overwrite the current shell.
- Add deterministic parent FAIL-before and candidate controls for the combined shell-status, Toast, actions-menu, context-sensitive Refresh, single-flight, and stale-result contract.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Replace the panel-local bootstrap unavailable/Retry surface with the shell-level generic Toast and existing AppButton Refresh, while restoring persisted shell state independently of bootstrap.

## Impact

- Affected implementation after authority approval: content shell/bootstrap composition, shell-lifetime `AppStatus` and generic Toast ownership, AppButton actions-menu availability, context-sensitive Refresh dispatch, and focused regressions.
- Affected behavior: refresh restores the saved expanded/collapsed choice during every bootstrap outcome; initial/retry loading keeps `Preparing WebChat`; bootstrap failure shows a Toast and is retried from AppButton Refresh rather than a panel error page.
- Superseded behavior: the `settle-connection-completion` bootstrap-specific clauses that require a panel-local `WebChat unavailable + Retry` terminal. Its shell-first mount, dependency gating, bounded generations, same-root recovery, launcher, loading shell, and ready-application behavior remain in force.
- Unchanged: the `AppStatus` storage key/record/version and no-record default; unread/position semantics; ready-state ChatRoom Refresh scope; Runtime/protocol/public APIs; bootstrap dependency order and deadlines; generic error default lifetime; no-success-Toast policy; visual theme/configuration; browser permissions and dependencies.
- The Chromium cross-world preload warning, mandatory bootstrap stage logging, timeout redesign, raw diagnostic copy, new error page, automatic opening, and visual redesign are outside this change.
- QA, QC, and UX are not part of this task unless the Owner later requests them explicitly. Merge follows the established acceptance and authorization flow.
