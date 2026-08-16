## Why

Current `develop` serializes local send completion behind both Runtime transport acceptance and local `MessageStore.insert`. Any post-validation Runtime failure in that awaited chain can therefore reject before the application receives the allocated message. The current text stays in the draft, later sends wait behind the same serialized effect, and successful recovery can make the accumulated messages appear together.

That ordering contradicts the product rule: complete message-protocol conformance is the gate for local text display. Once a locally authored text message is protocol-valid, RTC, peer readiness, transport, persistence, History, and other later runtime failures must not block or queue its current-page projection.

## What Changes

- Keep allocation and the existing single full `ChatMessageSchema` boundary before any local projection, transport, or persistence side effect. A protocol-invalid message still produces no projection or side effect, preserves the draft, and reports only the existing `Invalid message.` error.
- After a locally authored text message passes that protocol boundary, return its exact allocated `TextMessage` for immediate current-page projection and clear the accepted text draft without waiting for transport or `MessageStore.insert` settlement.
- Start transport and local persistence as independent post-validation work. Failure of either one must not prevent the other attempt, undo or delay the accepted local projection, restore the cleared draft, or hold later protocol-valid sends in a delivery/persistence queue.
- Decide local-display eligibility only from full protocol acceptance. No later error message, name, type, code, constructor, subsystem, or operation may be matched or classified to decide whether local display is allowed.
- Preserve each genuine later failure through its existing scoped error owner and unchanged user-visible message. Local visibility does not claim remote receipt or durable persistence.
- Preserve the exact eight-method `ChatRoom` extern, the single protocol-validation boundary, protocol values and limits, MessageStore schema, direct provider send semantics, remote message handling, and absence of outbound retry, outbox, delivery status, ACK, or fallback.
- Make no v2.5.0 comparison or backport; the sole baseline is `develop@83719009ab88e909ec8e4bb7d14b70cb693e31ea`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Decouple protocol-valid locally authored text projection from fallible transport and persistence settlement while retaining their independent attempts and error ownership.

## Impact

- Affected implementation: the application `ChatRoom` send adapter, Runtime local-send acceptance/settlement, application send-effect scheduling, local persistence observation, and focused send controls.
- Affected user behavior: a protocol-valid local message appears immediately in the current page despite any later Runtime failure; later messages do not accumulate behind that failure. Existing error feedback remains visible.
- Failure boundary: protocol-invalid input still does not appear. A transport failure may leave a locally visible message that remote peers never receive; a persistence failure may leave a current-page message that does not survive reload or converge to other local pages.
- Unchanged: public/protocol/persistence shapes, validation count and limits, peer receive and History semantics, provider recipient selection, reactions and remote projections outside the affected local acceptance path, recovery, browser manifests, dependencies, and release/deployment behavior.
