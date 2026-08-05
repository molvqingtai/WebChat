## Why

Refreshing the page, updating the extension, restarting the background worker, reconnecting across generations, or racing a room teardown can currently surface internal errors as user-visible error toasts (presence final-release rejections, untrusted-room rejections, signaling `id-taken`). These are transient states that the recovery flow should absorb. An error toast is justified only when a failure is genuinely unrecoverable, and then it shows the underlying error's original text.

## What Changes

- Define the transient recovery scenarios: page refresh or reopen, extension update or manual background restart, reconnect generation takeover (including signaling peer-ID occupation), and room teardown/final-release races. Operations in these windows are carried by recovery — held until ready or completed through recovery — and produce no user-visible error.
- Define the single failure scenario: a genuinely unrecoverable failure such as WebRTC being truly unable to connect. Its error toast presents the underlying error's original text verbatim, with no copy normalization or rewriting.
- Keep the existing error pass-through presentation; the change removes the erroneous production of errors in transient flows, not the display of genuine errors.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Recovery absorbs transient states without surfacing errors; only unrecoverable failures produce error toasts with the original error text.

## Impact

- Affected behavior: user-visible outcome of sending, reacting, and connecting during page refresh, extension/background restart, reconnect generation, and room teardown windows; the error toast shown on genuine connection failure.
- Affected verification: each transient scenario completes without any error toast and the operation eventually succeeds; the failure scenario produces one toast carrying the original error text.
- Unchanged: message delivery semantics for established connections, canonical message data and ordering, room trust rules themselves, Runtime networking protocols, permissions, dependencies, and browser-specific product behavior.
