## Why

Runtime failures cross a browser-extension transport boundary before reaching the content ChatRoom. JavaScript `Error` fields are not reliable transport values, so the boundary must carry the user-relevant message explicitly and reconstruct the content-side `Error` at its owning application adapter.

## What Changes

- Project each host Runtime `Error` to its exact `message` string in `PagePort` before extension transport.
- Define the transported Runtime error callback as a message string.
- Reconstruct `new Error(message)` in the content Runtime-backed `ChatRoom` before publishing the ChatRoom error event.
- Transport no `Error` object, name, stack, cause, or additional error metadata.
- Preserve the ChatRoom error API, Toast copy and presentation, Runtime failure ownership, page targeting, and listener-failure isolation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define the transport-safe Runtime error message boundary and content-side Error reconstruction.

## Impact

- Affected behavior: Runtime failure feedback delivered from the shared host to a content page.
- Affected implementation: `PagePort`, the internal Runtime server callback contract, and the Runtime-backed content `ChatRoom` adapter.
- Affected verification: exact message projection, JSON-safe transport, content Error reconstruction, and final consumer observation.
- Outside this change: Runtime lifecycle and recovery, Toast wording and lifetime, persistence, protocol, notifications, public ChatRoom APIs, dependencies, permissions, and browser-specific behavior.
