## Why

Trystero 0.25.3 reports `could not connect to peer ... after exchanging SDP` through the Room's `onJoinError` callback whenever one peer-to-peer negotiation attempt fails after SDP exchange. The message identifies neither the responsible side nor a failed local Room join: another peer may have joined or re-announced, the direct path between that peer and this client may fail, and other peer connections may remain healthy. Repeated negotiation attempts can therefore create repeated WebChat Toasts that the user cannot act on.

WebChat also retains six executable `console.warn` calls in production source plus three commented `console.log` examples. They mix optional notification failure, secondary diagnostics, a bounded database warning, hostile-input drops, and internal port/relay rejection into the browser console. The product now requires production console output to be Error-only: existing `console.error` ownership remains, while non-error warning/log output is removed rather than renamed or promoted.

## What Changes

- Classify only Trystero 0.25.3 `onJoinError` details whose `error` starts with `could not connect to peer ` inside `TrysteroRoomTransport`, before the provider-specific text can enter the generic `RoomTransport.onError` boundary.
- Return immediately for that class with no generic error event, Toast, `console.error`, warning, log, diagnostic record, rate limiter, or retained state. Every later callback for another negotiation attempt follows the same stateless rule.
- Preserve every non-matching join error, including incorrect password and handshake timeout/rejection/failure, through the existing generic error route exactly once and without adapter-side duplicate output.
- Remove all six current executable `console.warn` calls from production source and the three commented `console.log` examples. Do not convert any of them to `console.error`; preserve the existing operation, rejection, timeout, drop, and recovery behavior around each site.
- Require executable production source to call no console method other than `console.error`. Existing `console.error` calls and the caught-error ownership rules remain unchanged except for the exact quiet sites named by this change.
- Add no Trystero field, text, or error code to generic RoomTransport, Domain, UI, protocol, persistence, or public types, and do not change callback return semantics, peer cleanup, announce, negotiation, reconnection, or relay behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Keep Trystero's post-SDP peer-connect failure private and completely silent while preserving every other join error and all connection behavior.
- `source-quality-tooling`: Remove the complete current non-error console-output inventory from production source and keep warning/log methods out of production through source review.

## Impact

- Affected implementation: `src/runtime/transports/trystero/TrysteroRoomTransport.ts` and the six current production `console.warn` sites in Notification, MessageStore, IndexedDB, Wire, and Background, plus the three commented avatar-library `console.log` examples.
- Affected tests: focused Trystero adapter controls for matching, repeated, stale, and non-matching callbacks, plus focused controls for the surviving operation results around removed warning sites. Deletion completeness is verified by source diff and cumulative static review, not by tests that scan for removed code, log text, or comments.
- Affected user behavior: `could not connect to peer ...` no longer creates a Toast or console record; other join failures remain visible through the existing error path.
- Unchanged: existing `console.error` sites and ownership, RoomTransport contracts, Domain/UI error types, peer identity, Room membership, cleanup, announce, signaling, handshake, retry/reconnection, protocols, persistence, manifests, dependencies, release, and deployment.
