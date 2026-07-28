## Why

Refresh is the user's recovery action for a failed site-chat connection or join, but the current `joined && !reconnecting` gate disables it whenever the initial join has failed. The action is therefore unavailable in the state where it is most needed.

## What Changes

- Remove successful `joined` state as a prerequisite for Refresh availability.
- Keep Refresh disabled while an initial join or a Refresh-owned recovery request is actively in flight, and while required user identity is not configured.
- Retry an unjoined or terminally failed site-chat join directly without first leaving a room that was never joined.
- Preserve the existing leave/join behavior for an already joined domain.
- Route both retry and reconnect paths through the same request identity, pending button, stale fencing, and generic Toast feedback lifecycle; success dismisses the request loading entry without a `Ready to chat` Toast, while genuine failure remains visible.
- Keep panel state, the shared WorldRoom, Runtime recovery, public ports, protocol, persistence, and presentation structure unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Change the domain-scoped Refresh/reconnect requirement so terminal join failure is recoverable and `joined` is not an availability prerequisite.

## Impact

- Application ChatRoom Domain recovery composition and focused tests.
- Content actions-menu Refresh eligibility, accessible label, and focused tests.
- A new OpenSpec delta for the existing `webrtc-runtime` capability.
- No `ChatRoomExtern` expansion, Runtime/protocol/persistence/dependency change, WorldRoom rebuild, panel mutation, new Toast renderer, or bootstrap fallback.
