## Context

The Runtime connection Domain emits an `Error` in the host context. `PagePort` targets that failure to registered pages through the internal Runtime server callback. The callback crosses the browser-extension transport boundary before the Runtime-backed content `ChatRoom` publishes its public `Error` event.

## Goals / Non-Goals

**Goals:**

- Carry the exact failure message as one transport-safe scalar.
- Keep transport projection in the host `PagePort` and application `Error` construction in the content `ChatRoom`.
- Preserve one Runtime failure owner and the ChatRoom error API consumed by application feedback.
- Verify the real projection and reconstruction path without a test-side copy of production logic.

**Non-Goals:**

- Transporting an `Error` object, name, stack, cause, subclass, or custom metadata.
- Adding an error DTO, schema, wrapper, codec, status owner, retry state, or browser branch.
- Changing Runtime recovery, failure targeting, Toast copy, Toast lifetime, or public ChatRoom behavior.

## Decisions

### 1. PagePort owns transport projection

`PagePort.emitError(pageIds, error)` projects the host `Error` to `error.message` before invoking registered page listeners. Its internal listener map and the Runtime server `onError` callback therefore carry `string`. The primitive value is stable under the browser transport's JSON serialization.

This projection stays at `PagePort` because that class already owns page targeting and the host-to-page callback boundary. The connection Domain continues to own the original `Error`; no second failure state is introduced.

### 2. The content ChatRoom owns Error reconstruction

The Runtime-backed content `ChatRoom` receives the message string, constructs `new Error(message)`, and publishes it through its ChatRoom error event. Application consumers continue to receive an `Error` from the same public boundary.

The transport contract remains a string and does not depend on `Error` serialization. Content reconstruction occurs exactly once, at the adapter that owns the application-facing type.

### 3. Message is the complete transport contract

Only `error.message` crosses this boundary. Name, stack, cause, subclasses, enumerable custom fields, and the host object identity are not transported. Toast wording and diagnostics consume the reconstructed Error through their established application path; the transport adds no presentation or normalization policy.

### 4. Verification follows the production ownership path

PagePort coverage serializes the delivered callback value through JSON and requires the exact string. Runtime-backed ChatRoom coverage feeds the string through `RuntimeServer.onError` and requires one reconstructed `Error` with the same message. Higher-level Runtime controls observe `adapter.onError` so tests do not construct a second Error or maintain another message truth.

## Risks / Trade-offs

- [Host-only Error metadata is unavailable in content] -> The message is the deliberate complete transport contract; diagnostics that require other metadata remain in the host context.
- [A future consumer treats the callback as an Error object] -> The internal Runtime server type fixes the callback to `string`, while the content ChatRoom fixes its public event to `Error`.
- [Tests could pass by duplicating reconstruction] -> Final controls observe the Runtime-backed ChatRoom adapter rather than rebuilding the Error in fixtures.
