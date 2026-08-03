## Why

An untrusted-room rejection needs a concise diagnostic that identifies the failure category without placing an opaque room identifier in the Error message. Room identity is operational context, not user-facing error copy.

## What Changes

- Standardize the rejection message as exactly `Untrusted room message`.
- Keep every room identifier, origin, encoded value, suffix, and fingerprint out of the Error message.
- Allow room identity only as separately structured internal debug metadata when an existing diagnostic boundary needs it.
- Preserve trusted-room validation, provider targeting, operation settlement, retry behavior, Runtime state, and all existing UI behavior.
- Change only the existing copy; add no tests for this message reduction, and mechanically sync an existing literal expectation only when the direct replacement makes it stale.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define the fixed concise message for an outbound send rejected by current trusted-room validation.

## Impact

- Affected behavior: the diagnostic message produced when an outbound Runtime send has no current trusted room.
- Affected implementation: only the existing trusted-room rejection copy; any test diff is limited to mechanically synchronizing an existing literal expectation.
- Outside this change: room identity, membership, validation timing, transport, wire payloads, provider calls, retries, persistence, connection state, UI surfaces, dependencies, permissions, schema, and browser-specific behavior.
