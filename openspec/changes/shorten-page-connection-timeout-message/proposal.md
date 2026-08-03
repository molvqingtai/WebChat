## Why

A content connection-timeout Toast should state the outcome in concise user language. Page and prerequisite pipeline details are internal implementation context and do not help the user understand the failure.

## What Changes

- Standardize the content Toast text as exactly `Connection timed out`.
- Keep page, prerequisite, lifecycle, deadline, and other internal implementation terms out of this user-facing message.
- Preserve the existing trigger, Toast surface and presentation, operation settlement, timeout threshold, retry eligibility, connection state, and recovery behavior.
- Change only the existing copy; add no tests for this message reduction, and mechanically sync an existing literal expectation only when the direct replacement makes it stale.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define the concise content Toast text for the existing page connection prerequisite timeout.

## Impact

- Affected behavior: user-facing text on the existing content connection-timeout Toast.
- Affected implementation: only the existing timeout feedback copy; any test diff is limited to mechanically synchronizing an existing literal expectation.
- Outside this change: trigger conditions, deadline duration, connection prerequisites, Runtime state, request settlement, retry/recovery, Toast identity/lifetime/severity/icon/placement/accessibility, UI structure, protocol, persistence, schema, dependencies, permissions, and browser-specific behavior.
