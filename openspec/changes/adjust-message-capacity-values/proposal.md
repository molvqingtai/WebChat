## Why

The current message and codec values constrain one authored message to `48KiB`, one final wire frame to `64KiB`, and one decoded JSON frame to `256KiB`. WebChat needs more room for several images that retain the existing per-image compression target, without reopening the editor, schema, protocol, or History designs.

## What Changes

- Change `MAX_CHAT_EVENT_BYTES` from `48KiB` to `192KiB` at its existing consumers and enforcement points.
- Change `MAX_WIRE_BYTES` from `64KiB` to `256KiB` for every final encoded frame. History Pull and Push pages continue to use that same shared wire limit.
- Change `MAX_DECODED_JSON_BYTES` from `256KiB` to `1MiB` for streaming decoded JSON before parse.
- Remove the History-session cumulative `10,000`-message and `8MiB` limits. History continues across bounded pages until its fixed 180-day snapshot is exhausted and `done`, or until the current connection ends, the operation is canceled, an error occurs, or the existing 10-second no-progress deadline expires.
- Retain the `500` JavaScript-unit text input limit, `30KiB` per-image compression target, `5KiB` avatar target, `8KiB` `ChatUser` limit, 100-message History Push page limit, 8-frame/`256KiB` per-source decode queue, and 512-record/`8MiB` inbound un-ACK buffer.
- Mechanically synchronize only existing affected tests, fixtures, user-facing size copy, and active OpenSpec values. Add no test case, test abstraction, compatibility behavior, or additional resource guard.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `peer-wire-protocol`: Replace only the three message/codec capacity values while retaining the current protocol shapes and validation boundaries.
- `webrtc-runtime`: Remove only the History-session cumulative message/byte limits while retaining per-page, queue, buffer, lifecycle, and termination boundaries.

## Impact

- Affected source: existing protocol limit constants and consumers, the current History-session cumulative-limit constants/options/checks, and the existing footer size copy.
- Affected verification: existing exact-value, codec-limit, authoring-size, and History cumulative-budget expectations only.
- Unchanged: editor image representation and lifecycle, schemas and protocol structures, v5 namespaces, History messages/phases/pagination, 180-day snapshots, timeout ownership, persistence, delivery, identity, dependencies, public APIs, and every unlisted resource boundary.
