## Context

The authority base is `develop@b49951189f25530153ee098aa08947fcde28b55f`. WebChat uses Trystero 0.25.3 as its sole Room transport. `TrysteroRoomTransport` currently forwards every active Room `onJoinError` detail as a generic `Error`; application ownership then shows it through the existing Toast path.

Trystero exposes no typed code for its post-SDP connection failure. Its stable callback text starts with `could not connect to peer ` and includes `roomId` and `peerId` separately. The callback return value has no provider control semantics. A Room for the same `(appId, roomId)` retains the callback from its first composition, so provider classification must be installed at that initial adapter boundary.

Existing `preserve-caught-error-observability` authority forbids using error content to decide general UI silence. This change creates one explicit provider-local exception for an upstream callback class that is peer-attempt-scoped, non-attributable, and non-actionable. It does not weaken the generic error rule or permit text classification outside the Trystero adapter.

The same base contains six executable non-error console calls, all `console.warn`, and three commented `console.log` examples. The Owner requires all of them removed and permits only existing `console.error` output in production source.

## Goals / Non-Goals

**Goals:**

- Make every Trystero post-SDP peer-connect callback completely silent in UI and console.
- Keep the classifier inside the concrete Trystero adapter and leave generic contracts provider-neutral.
- Preserve every non-matching join error through its current one-owner route.
- Remove the complete current production warning/log inventory without converting warnings to Errors or changing surrounding behavior.
- Make the Error-only production console rule explicit in production source and cumulative static review.

**Non-Goals:**

- Determining whether this client, the remote peer, either network/NAT, signaling timing, or peer departure caused one connection failure.
- Stopping announce, negotiation, cleanup, reconnection, or later attempts.
- Silencing password, handshake, transport-send, leave, peer-error, relay, or other independent error channels.
- Adding rate limiting, deduplication, diagnostics state, telemetry, an outbox, a provider fork, or a typed generic error code.
- Reclassifying, renaming, or deleting existing `console.error` ownership.

## Decisions

### 1. One provider-local text exception

The adapter SHALL first retain its existing current-owner fence. For an active Room callback, it SHALL test only `details.error.startsWith('could not connect to peer ')`. A match SHALL return immediately. It SHALL publish no generic error event, show no Toast, write no console entry, and retain no state.

This exception is permitted only because pinned Trystero 0.25.3 provides no typed code for the callback class. The prefix SHALL NOT be copied into RoomTransport, Domain, Toast, protocol, persistence, or other provider-neutral code. If a later pinned Trystero exposes a stable typed code, the classifier SHOULD move to that code inside the same adapter and the product contract must be revalidated.

A callback from each later negotiation attempt is evaluated independently. WebChat SHALL NOT remember peer IDs, suppress provider work, rate-limit callbacks, or infer that either side failed its whole Room join.

### 2. Non-matching join errors preserve existing ownership

Incorrect password, handshake timeout, handshake rejection/failure, and any other non-matching active-Room `onJoinError` detail SHALL still become the same generic `Error` and reach each current error listener exactly once. The adapter SHALL NOT also log those errors, because their existing generic owner remains responsible for presentation and diagnostics.

A callback for an inactive, leaving, failed-leave, or disposed owner remains dropped by the existing current-owner fence. This change does not turn stale work into a product error.

### 3. Remove the frozen non-error console inventory

The implementation SHALL remove, not rename or promote, these six executable `console.warn` sites from the authority base:

| Site                                  | Existing warning                             | Preserved behavior after removal                                                                                                                  |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Notification.ts`                     | Notification push rejection                  | Notification remains an optional fire-and-forget side effect; the rejection is consumed without a Toast or replacement console output.            |
| `MessageStore.ts`                     | Failure to retain invalid-record diagnostics | The primary query still returns valid records and retains its existing abort behavior; secondary diagnostic retention adds no replacement output. |
| `IndexedDB.ts`                        | Message-store deletion `blocked` event       | The existing bounded timer and eventual `Message store deletion blocked` rejection remain the operation owner; only the early warning is removed. |
| `Wire.ts`                             | Dropped invalid/unsupported frame            | The frame remains dropped under the existing hostile-input/no-product-error rule, with no replacement output.                                     |
| `Background.ts` PresenceStore adapter | Port failure warning                         | Existing port lifecycle and caller behavior remain; the adapter adds no replacement warning or Error.                                             |
| `Background.ts` Offscreen relay       | Dropped relay rejection warning              | The relay item remains dropped under its existing rejection contract, with no replacement output.                                                 |

The three commented `console.log` examples in `src/lib/uglyAvatar/face_shape.js` SHALL also be deleted as source residue. Because they are non-executable, their removal changes no runtime behavior.

No removed warning SHALL become `console.error`, a Toast, a new event, or another logger. Existing `console.error` calls and their exact failure ownership SHALL remain byte-identical unless a source/test implementation dependency requires a minimal mechanical adjustment that does not change behavior.

Where an error/rejection callback is optional, implementation SHALL omit it instead of installing a no-op callback. Notification push is the one boundary that must observe a returned Promise to avoid an unhandled rejection; this change explicitly permits one adjacent inline rejection consumer for that optional notification side effect as the sole exception to the existing no-op rejection-consumer prohibition. That consumer SHALL remain specific to Notification push, add no generic swallow helper, retain no state, and have a direct control proving the rejection is quiet without affecting later notifications. No other caught-error or rejection site gains permission to discard a genuine failure.

### 4. Production console policy is Error-only

Executable non-test production files under `src` SHALL call no `console` method other than `console.error`, including but not limited to `warn`, `log`, `debug`, `info`, `trace`, `table`, `dir`, `group`, and timer methods. Test files MAY spy on or mock console methods solely to assert behavior. Comments SHALL NOT retain disabled non-error calls as examples.

This is a console-output policy, not permission to swallow arbitrary failures. Existing caught-error authority still requires a genuine failure to retain its caller-visible rejection, current-user route, or existing `console.error` owner unless this change explicitly classifies the exact site above as quiet or redundantly owned.

### 5. Tests verify current behavior; source review verifies deletion

Focused adapter controls SHALL invoke the captured first-composition callback directly and prove:

- one matching callback makes zero generic error calls and zero calls to every console method;
- repeated matching callbacks remain independently silent;
- matching remains silent without changing callback return/peer lifecycle behavior;
- password and handshake examples each reach the existing generic error listener exactly once with their original text and no adapter console output; and
- stale callback behavior remains unchanged.

Cumulative static review SHALL inspect the complete affected production source and implementation diff to confirm that the six warnings, three commented examples, and any replacement non-error output are absent. Tests SHALL NOT scan source files, generated bundles, comments, or old warning text solely to prove deleted code remains absent.

Focused behavior controls SHALL instead prove current observable behavior: the Trystero prefix remains silent, non-matching errors retain their owner, and the affected operations retain their bounded rejection, drop, abort, continuation, retry, or cleanup result. Console spies remain appropriate only where zero console output is itself part of the surviving product behavior, such as the Trystero silence exception.

## Risks / Trade-offs

- Prefix matching can become stale when Trystero changes its message. Pinning the exception to Trystero 0.25.3 and keeping it inside one adapter limits the blast radius; a dependency upgrade must revalidate it.
- Complete silence removes local diagnostics for this peer-attempt class and for the six warning sites. That is intentional product policy; actionable genuine failures must continue through existing `console.error` or application error ownership rather than warning-level output.
- Deletion completeness is reviewer-owned rather than test-owned. A future source change can reintroduce non-error output unless cumulative static review continues to enforce the explicit production policy.

## Open Questions

None.
