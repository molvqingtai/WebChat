## Why

The current 48KiB declarative body-field ceiling and 64KiB final frame budget leave little room for multiple images even though each image is already compressed toward 30KiB. The same 64KiB frame ceiling also governs History Push, so live send and replay must share the same larger physical codec contract.

The current editor additionally converts every inserted image to Base64 immediately, assigns a NanoID-backed `hash:` placeholder, and retains a hash-to-content map until send. A session-only `blob:<id>` token can instead locate the compressed `Blob` in an editor-owned map while the sent, stored, and replayed message remains a data URL.

History currently stops after 10,000 records or 8MiB even when the fixed 180-day snapshot still contains data. Those cumulative caps are not needed when every page, decode, delivery buffer, supplier job, and no-progress period remains independently bounded and all terminal paths release their owned work.

## What Changes

- Keep visible text input at 500 JavaScript string/UTF-16 code units and keep each image compression target at 30KiB.
- Raise the declarative wire `body` field ceiling from 48 × 1024 to 192 × 1024 JavaScript string/UTF-16 code units. Retain the existing declarative `ChatUser` field limits and 5KiB avatar compression target.
- Preserve the existing protocol-validation contract: the same pure static Schema validates protocol values exactly at peer receive, outbound send, and local persistence load. Define no complete-`ChatMessage` or complete-`ChatUser` UTF-8 budget or helper, and add no validation to other internal application paths.
- Increase the final `Base64(deflate(UTF8(JSON)))` frame ceiling from 64KiB to 256KiB and the streaming decompressed JSON ceiling from 256KiB to 1MiB. No application-level fragmentation is added.
- Keep History Push at most 100 messages and raise every History Pull/Push page to the same 256KiB final-frame ceiling so every legal live message remains replayable.
- Remove the 10,000-entry and 8MiB cumulative History synchronization budgets. Retain the 180-day fixed snapshots, 10-second no-progress timeout, bounded pages, source/domain lifecycle cancellation, supplier admission, physical abort/settlement, and terminal resource release.
- Keep the per-source decode queue at 8 frames and 256KiB aggregate wire bytes, and keep the per-domain inbound un-ACK buffer at 512 records and 8MiB.
- Replace editor `hash:` image placeholders, image NanoIDs, and the hash-to-Base64 content map with exact `blob:<id>` Markdown references backed by an editor-owned session-only `id -> Blob` map. Generate each opaque id with the platform `crypto.randomUUID()` API, convert its live owned Blob to a data URL only when sending, and allow neither the token nor map into wire, persistence, or History.
- Deliver one clean capacity cut through v6 Chat and World physical namespaces. Older peers with the v5 48/64/256 limits are intentionally isolated and incompatible; no fallback, dual path, negotiation, migration, or compatibility logic is introduced.
- Add no repository test case. Mechanically update only existing assertions or fixtures made stale by the new values and removed hash path. Validate 64/128/192/256KiB frames externally in both directions across Chrome-to-Chrome, Chrome-to-Firefox, and Firefox-to-Firefox, including an oversize failure that does not disconnect the room.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `peer-wire-protocol`: Set the declarative body-field, final-frame, decompressed JSON, and History page limits while retaining the three unified Schema boundaries and the codec's separate representation limits.
- `webrtc-runtime`: Remove cumulative History session caps while preserving explicit termination/release, and replace editor hash placeholders with owned Blob-id draft references that resolve through a session-only Blob map at send.

## Impact

- Affected protocol modules: v6 Chat/World namespace inputs, declarative field limits, `NativeWireCodec`, strict peer acceptance, and existing protocol/codec expectations.
- Affected application modules: Footer text/image composition, send-time Blob resolution, editor-owned Blob-id map lifecycle, and existing affected editor assertions.
- Affected Runtime modules: History Pull/Push paging, requester/provider cumulative accounting removal, terminal cleanup, existing History expectations, and comments that encode obsolete 64KiB behavior.
- Unchanged: message/user fields and discriminants, 500-code-unit text UI rule, 30KiB image target, 5KiB avatar target, 100-message History page count, 180-day History window, 10-second History no-progress timeout, per-source decode queue, per-domain inbound un-ACK buffer, databases, permissions, dependencies, signaling, `master`, deployment, and production.
