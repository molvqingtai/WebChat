## Why

A Content document can either end permanently or be suspended and later restored by browser history while the shared Runtime remains healthy. Page-scoped connection feedback and the page lease need one document-lifecycle contract so cleanup cannot appear as a new connection attempt and a restored document cannot retain stale local readiness.

## What Changes

- Give the Content composition boundary one owner for terminal exit, BFCache suspension, and BFCache restoration.
- Stop page-scoped Runtime feedback before releasing a departing or suspended page lease so lifecycle cleanup creates no connection loading Toast.
- Restore a BFCache document exactly once and reconcile its UI from the current Runtime truth.
- Keep terminal exit final, idempotent, and unable to schedule restoration.
- Add cross-layer regressions for terminal navigation, BFCache restoration, repeated history cycles, and hard refresh.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Page lease ownership and Runtime readiness feedback follow the active Content document lifetime across terminal exit and BFCache restoration.

## Impact

- Affected behavior: Content document lifecycle, page lease attach/detach, page-scoped Runtime readiness feedback, and history restoration.
- Affected verification: terminal navigation, hard refresh, BFCache suspend/restore, current-ready reconciliation, and duplicate-owner prevention.
- Unchanged: shared Runtime and Room lifecycles, wire protocol, persistence, connection truth, permissions, dependencies, and public UI structure, controls, and copy.
