## Why

Every current initialization attempt uses one stable Toast identity. When a retried attempt fails, its terminal error must replace that attempt's loading feedback directly and remain visible under the generic Toast lifetime instead of being removed by delayed cleanup for the same identity.

## What Changes

- Keep `webchat-initialization` as the sole initialization Toast identity for initial attempts and Retry.
- On genuine current-page failure, replace the matching loading descriptor directly with a same-ID error descriptor containing exactly the original `error.message`; do not decorate, map, normalize, or replace that copy. A no-page or user-irrelevant failure uses direct `console.error(error)` and creates no Toast destination.
- Do not issue a matching cancellation before the failure replacement. Success still cancels the matching loading descriptor.
- Preserve generation fencing: superseded, aborted, or unmounted attempts publish no terminal error and cannot settle a newer attempt.
- Preserve the existing shell, AppStatus owner, generic Toaster, default error lifetime, actions-menu Refresh, and all Runtime/storage behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define atomic same-identity loading-to-error settlement for current initialization failure.

## Impact

- Affected behavior: generic Toast feedback after a current initial or retried initialization attempt fails.
- Affected implementation: the terminal failure command batch in the existing initialization lifecycle.
- Affected verification: initial failure, Retry failure, success, stale generation, unmount, default lifetime, and unrelated Toast preservation.
- Unchanged: initialization stages and deadline, shell structure, AppStatus ownership, Retry availability, Toast identity and presentation lifecycle, Runtime, persistence, protocol, public APIs, dependencies, and permissions. Failure copy follows the current-owner route above without changing those boundaries.
