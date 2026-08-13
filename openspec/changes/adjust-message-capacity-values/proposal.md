## Why

WebChat needs authored messages to accommodate several images at the established per-image compression target. The capacity contract must remain explicit without changing the editor, schema, protocol, or History designs.

## What Changes

- `MAX_CHAT_EVENT_BYTES` is `192KiB` as the static declarative Text body ceiling. The producer-side/footer whole-value authored-message preflight is absent.
- `MAX_WIRE_BYTES` is `256KiB` for every final encoded frame. History Pull and Push pages use that same shared wire limit.
- `MAX_DECODED_JSON_BYTES` is `1MiB` for streaming decoded JSON before parse.
- History has no session-wide cumulative message-count or canonical-content-byte limit. It continues across bounded pages until its fixed 180-day snapshot is exhausted and `done`, or until the current connection ends, the operation is canceled, an error occurs, or the fixed 10-second operational timeout expires.
- The `500` JavaScript-unit text input limit, `30KiB` per-image compression target, `5KiB` avatar target, `8KiB` `ChatUser` limit, 100-message History Push page limit, 8-frame/`256KiB` per-source decode queue, and 512-record/`8MiB` inbound un-ACK buffer remain authoritative.
- Existing affected tests, fixtures, and active OpenSpec state reflect these values and the absence of the whole-value preflight. The contract adds no test case, test abstraction, compatibility behavior, or additional resource guard.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `peer-wire-protocol`: Define the three message/codec capacity values while retaining the protocol shapes and validation boundaries.
- `webrtc-runtime`: Define History without a session-wide cumulative count/byte limit while retaining per-page, queue, buffer, lifecycle, and termination boundaries.

## Impact

- Affected source: protocol limit constants and declarative consumers, removal of the footer whole-value preflight, and History session-limit state and branches.
- Affected verification: exact-value, codec-limit, authoring-size, and History no-cumulative-limit expectations only.
- Unchanged: editor image representation and lifecycle, schemas and protocol structures, v5 namespaces, History messages/phases/pagination, 180-day snapshots, timeout ownership, persistence, delivery, identity, dependencies, public APIs, and every unlisted resource boundary.
