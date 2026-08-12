## Why

The current 48KiB message budget and 64KiB final frame budget leave little room for multiple images even though each image is already compressed toward 30KiB. The same 64KiB frame ceiling also governs History Push, so a larger live message must be replayable under the same physical contract rather than becoming a live-only value.

The current editor additionally converts every inserted image to Base64 immediately, assigns a NanoID-backed `hash:` placeholder, and retains a hash-to-content map until send. A draft-local Blob URL can own the same temporary reference with less conversion and state while the sent, stored, and replayed message remains a data URL.

History currently stops after 10,000 records or 8MiB even when the fixed 180-day snapshot still contains data. Those cumulative caps are not needed when every page, decode, delivery buffer, supplier job, and no-progress period remains independently bounded and all terminal paths release their owned work.

## What Changes

- Keep visible text input at 500 JavaScript string/UTF-16 code units and keep each image compression target at 30KiB.
- Enforce 192KiB UTF-8 for one complete canonical `ChatMessage`, including every field, expanded image data URL, mention, avatar, and range.
- Enforce 8KiB UTF-8 for one complete canonical `ChatUser`, while retaining the 5KiB avatar compression target.
- Increase the final `Base64(deflate(UTF8(JSON)))` frame ceiling from 64KiB to 256KiB and the streaming decompressed JSON ceiling from 256KiB to 1MiB. No application-level fragmentation is added.
- Keep History Push at most 100 messages and raise every History Pull/Push page to the same 256KiB final-frame ceiling so every legal live message remains replayable.
- Remove the 10,000-entry and 8MiB cumulative History synchronization budgets. Retain the 180-day fixed snapshots, 10-second no-progress timeout, bounded pages, source/domain lifecycle cancellation, supplier admission, physical abort/settlement, and terminal resource release.
- Keep the per-source decode queue at 8 frames and 256KiB aggregate wire bytes, and keep the per-domain inbound un-ACK buffer at 512 records and 8MiB.
- Replace editor `hash:` image placeholders, image NanoIDs, and the hash-to-Base64 content map with editor-owned `blob:` Markdown references. Convert live owned Blobs to data URLs only when sending; Blob URLs never enter wire, persistence, or History.
- Deliver one clean capacity cut through v6 Chat and World physical namespaces. Older peers with the v5 48/64/256 limits are intentionally isolated and incompatible; no fallback, dual path, negotiation, migration, or compatibility logic is introduced.
- Add no repository test case. Mechanically update only existing assertions or fixtures made stale by the new values and removed hash path. Validate 64/128/192/256KiB frames externally in both directions across Chrome-to-Chrome, Chrome-to-Firefox, and Firefox-to-Firefox, including an oversize failure that does not disconnect the room.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `peer-wire-protocol`: Set the complete canonical object, final frame, decompressed JSON, and History page budgets while narrowly authorizing pure canonical UTF-8 resource guards alongside schema-owned structure.
- `webrtc-runtime`: Remove cumulative History session caps while preserving explicit termination/release, and replace editor hash placeholders with owned Blob URL draft references that resolve to data URLs at send.

## Impact

- Affected protocol modules: v6 Chat/World namespace inputs, public limits, canonical UTF-8 byte guards for `ChatMessage`/`ChatUser`, `NativeWireCodec`, strict peer acceptance, and existing protocol/codec expectations.
- Affected application modules: Footer text/image composition, send-time validation, Blob URL lifecycle, and existing affected editor assertions.
- Affected Runtime modules: History Pull/Push paging, requester/provider cumulative accounting removal, terminal cleanup, existing History expectations, and comments that encode obsolete 64KiB behavior.
- Unchanged: message/user fields and discriminants, 500-code-unit text UI rule, 30KiB image target, 5KiB avatar target, 100-message History page count, 180-day History window, 10-second History no-progress timeout, per-source decode queue, per-domain inbound un-ACK buffer, databases, permissions, dependencies, signaling, `master`, deployment, and production.
