## Why

Refreshing the page, updating the extension, restarting the background worker, reconnecting across generations, or racing a room teardown can currently surface internal errors as user-visible error toasts (presence final-release rejections, untrusted-room rejections, signaling `id-taken`). Those failures are transient only while a code-owned recovery path can still reach success. Conversely, a browser-native failure such as `Extension context invalidated.` permanently disconnects the affected content generation from the extension Runtime; treating it as transient leaves that generation retrying forever and hides the actual failure. Recoverable interruptions must remain silent, while native failures that code cannot recover must surface once with their original text.

## What Changes

- Define recoverability by outcome: page refresh or reopen, a successful extension/background handoff, reconnect generation takeover (including signaling peer-ID occupation), and room teardown/final-release races remain silent only while the owning recovery flow can still settle successfully.
- Define terminal native failure behavior: when a browser-native error proves that the owning generation has no code-owned recovery path, that generation stops its futile retry/loading cycle and presents exactly one error toast with the native error's original text. A later loading update from that failed generation cannot replace the terminal error.
- Classify `Extension context invalidated.` as terminal for the affected old content generation because that generation's Runtime endpoint is permanently invalid.
- Keep the existing error pass-through presentation; the change removes the erroneous production of errors in transient flows, not the display of genuine errors.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Recovery absorbs only recoverable transient states without surfacing errors; terminal native and other unrecoverable failures produce one error toast with the original error text.

## Impact

- Affected behavior: user-visible outcome of sending, reacting, and connecting during page refresh, extension/background restart, reconnect generation, and room teardown windows; terminal behavior after a native Runtime endpoint failure; the error toast shown on genuine connection failure.
- Affected verification: each recoverable transient scenario completes without any error toast and the operation eventually succeeds; `Extension context invalidated.` and every other proven terminal failure produce one toast carrying the original error text, stop the failed generation's retry loop, and cannot be overwritten by loading feedback.
- Unchanged: message delivery semantics for established connections, canonical message data and ordering, room trust rules themselves, Runtime networking protocols, permissions, dependencies, and all other browser-specific product behavior.
