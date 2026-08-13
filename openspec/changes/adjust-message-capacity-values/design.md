## Context

The implementation has separate owners for the declarative Text body ceiling, final wire representation, decoded JSON materialization, History page construction, decode admission, and inbound delivery admission. The final capacity contract keeps those owners and their control flow intact while removing the duplicate producer-side/footer whole-value authored-message preflight.

## Goals / Non-Goals

**Goals:**

- Set `MAX_CHAT_EVENT_BYTES` to `192KiB` as the static declarative Text body ceiling, `MAX_WIRE_BYTES` to `256KiB`, and `MAX_DECODED_JSON_BYTES` to `1MiB` at their owning boundaries.
- Keep History pages on the shared final `256KiB` wire boundary with at most 100 messages per Push.
- Keep History free of any session-wide cumulative message-count or canonical-content-byte limit while retaining all completion and failure termination.
- Keep every unchanged value explicit so implementation cannot silently expand adjacent buffers or UI behavior.

**Non-Goals:**

- No Blob, hash, object URL, UUID, Map, image conversion, or editor lifecycle work.
- No schema, validation-boundary, namespace, protocol-shape, History-phase, persistence, or delivery refactor.
- No compatibility, migration, negotiation, fragmentation, fallback, new guard, test case, test abstraction, or shared capacity abstraction.

## Decisions

### 1. Capacity values have one owner each

`MAX_CHAT_EVENT_BYTES` is `192 * 1024`, `MAX_WIRE_BYTES` is `256 * 1024`, and `MAX_DECODED_JSON_BYTES` is `1024 * 1024`. The static Text schema alone consumes `MAX_CHAT_EVENT_BYTES`; codec encode and decode retain their respective representation limits. No producer, footer, outbound, persistence-write, or History-supply path computes or enforces a whole-value authored-message budget.

The existing `500` JavaScript-unit text limit and `30KiB` per-image compression target remain independent. Several images may fit in a Text body below the `192KiB` declarative ceiling, but there is no fixed image-count promise; the Text schema and final-wire codec boundary remain the deciding limits.

### 2. History pages continue to use the shared wire value

History Pull and Push pages use the common `MAX_WIRE_BYTES = 256KiB`, and Push pages keep the 100-message ceiling. There is no separate History wire constant or message fragmentation. One legal message therefore remains representable when replayed through History.

### 3. History has no session-wide cumulative budget

One complete History synchronization has no session-wide cumulative message-count or canonical-content-byte limit. It also has no aggregate object or page guard.

The fixed 180-day snapshots and bounded pages continue until data exhaustion and `done`. Disconnect, cancellation, source replacement, invalid input, supplier or insertion failure, and the fixed 10-second operational timeout are terminal. The timeout uses its established arm points and identity fencing; accepted progress does not re-arm or replace it. The 512-record/`8MiB` volatile inbound buffer is an independent instantaneous delivery bound rather than a History-session total.

### 4. Synchronize existing evidence mechanically

Existing literals, fixture sizes, assertions, names, and copy reflect the final capacity values and the absence of a History session-wide cumulative limit. Verification uses the existing cases without a standalone capacity test, browser test, helper, abstraction, or fallback path.

## Risks / Trade-offs

- **One full wire frame consumes the unchanged per-source byte queue** -> This is intentional: the decode queue remains 8 frames and `256KiB` total, so a maximum frame occupies the byte allowance by itself.
- **A History synchronization may span many bounded pages** -> Fixed snapshots, bounded pages, one-shot connection ownership, data exhaustion/`done`, disconnection, cancellation, errors, and the fixed 10-second operational timeout define the termination model.
- **A decoded frame may consume up to `1MiB`** -> Streaming materialization is capped at `1MiB`; no other decode or buffer boundary changes.
