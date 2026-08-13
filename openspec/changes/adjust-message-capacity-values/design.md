## Context

The current implementation already has separate owners for authored-message size, final wire representation, decoded JSON materialization, History page construction, decode admission, and inbound delivery admission. This change replaces three fixed capacity values and removes one History-session cumulative budget without changing those owners or their control flow.

## Goals / Non-Goals

**Goals:**

- Replace `48KiB` with `192KiB`, `64KiB` with `256KiB`, and decoded `256KiB` with `1MiB` at the existing constants and consumers.
- Let History pages continue to share the final `256KiB` wire boundary and retain at most 100 messages per Push.
- Delete the History-session `10,000`-message/`8MiB` cumulative limits while retaining all existing completion and failure termination.
- Keep every unchanged value explicit so implementation cannot silently expand adjacent buffers or UI behavior.

**Non-Goals:**

- No Blob, hash, object URL, UUID, Map, image conversion, or editor lifecycle work.
- No schema, validation-boundary, namespace, protocol-shape, History-phase, persistence, or delivery refactor.
- No compatibility, migration, negotiation, fragmentation, fallback, new guard, test case, test abstraction, or shared capacity abstraction.

## Decisions

### 1. Replace values at their existing owners

`MAX_CHAT_EVENT_BYTES` becomes `192 * 1024`, `MAX_WIRE_BYTES` becomes `256 * 1024`, and `MAX_DECODED_JSON_BYTES` becomes `1024 * 1024`. Existing authoring, declarative field, codec encode, and codec decode consumers keep their current responsibilities; this change does not move, duplicate, or add validation.

The existing `500` JavaScript-unit text limit and `30KiB` per-image compression target remain independent. Several images may fit in a `192KiB` authored payload, but there is no fixed image-count promise; the existing authored-message and final-wire checks remain the deciding boundaries.

### 2. History pages continue to use the shared wire value

History Pull and Push pages keep using the common `MAX_WIRE_BYTES`, now `256KiB`, and Push pages keep the existing 100-message ceiling. No separate History wire constant or message fragmentation is introduced. This allows one legal larger message to remain representable when replayed through History.

### 3. Remove only the History-session cumulative budget

Delete the `10,000`-message and `8MiB` constants, option plumbing, counters, truncation, and failure branches that exist solely to cap one complete History synchronization. Do not replace them with another aggregate count, byte, object, or page guard.

The fixed 180-day snapshots and bounded pages continue until data exhaustion and `done`. Disconnect, cancellation, source replacement, invalid input, supplier or insertion failure, and the existing 10-second no-progress owner remain terminal. The 512-record/`8MiB` volatile inbound buffer remains an independent instantaneous delivery bound rather than a History-session total.

### 4. Synchronize existing evidence mechanically

Change only existing literals, fixture sizes, assertions, names, and copy made stale by the new values or removed cumulative budget. Delete obsolete cumulative-budget expectations rather than replacing them with a new case. Add no standalone capacity test, browser test, helper, abstraction, or fallback path.

## Risks / Trade-offs

- **One full wire frame consumes the unchanged per-source byte queue** -> This is intentional: the decode queue remains 8 frames and `256KiB` total, so a maximum frame occupies the byte allowance by itself.
- **Removing the History cumulative budget permits longer synchronization** -> Fixed snapshots, bounded pages, one-shot connection ownership, data exhaustion/`done`, disconnection, cancellation, errors, and the 10-second no-progress deadline remain the termination model.
- **Larger decoded frames cost more CPU and memory** -> Streaming materialization remains capped at `1MiB`; no other decode or buffer boundary changes.
