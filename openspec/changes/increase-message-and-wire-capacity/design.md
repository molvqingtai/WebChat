## Context

The current protocol uses one direct Artico data-channel string whose representation is exactly `Base64(deflate(UTF8(JSON)))`; there is no additional application envelope or fragment reassembly layer. Current limits are 48KiB for one message-like value, 64KiB for the final Base64 frame, and 256KiB for decompressed JSON. The 48KiB constant is also used as a declarative body string-length ceiling, so it does not currently prove the size of a complete canonical message.

The active schema-authority contract intentionally removed callback-backed semantic validation and whole-value checks. This capacity contract does not create an exception. The same static declarative Schema validates protocol values exactly at peer receive, outbound send, and local persistence load. Other internal paths trust typed inputs. Limits that cannot be represented by the static Schema are not validated; the codec independently owns only its physical encoded and decompressed representation boundaries.

History currently creates fixed 180-day requester/provider snapshots, pages them through the same codec, and retains cumulative 10,000-entry/8MiB accounting. Supplier queries already have AbortSignal ownership and physical settlement, and each direction already terminates on completion, lifecycle loss, error, or a 10-second attempt timer. The new contract removes only the cumulative inventory/response ceilings and makes that timer a no-progress deadline refreshed by valid forward progress.

The Footer currently compresses an image, converts it to Base64 immediately, stores the Base64 value in a `Map` under a NanoID, inserts `![Image](hash:<id>)`, and expands the placeholder before send. The draft is not persisted. The replacement keeps the compressed `Blob` itself in an editor-owned session map and writes only an opaque `blob:<id>` locator into the draft; it creates no browser object URL.

## Goals / Non-Goals

**Goals:**

- Make the layered limits explicit in their actual units and enforce each limit at its owning boundary.
- Raise the static `body` field ceiling to 192 × 1024 JavaScript string/UTF-16 code units and let the real codec determine whether each complete containing frame is sendable.
- Bound one final frame to 256KiB and its decompressed JSON to 1MiB without introducing fragmentation.
- Retain the static `ChatUser` field limits, including the 8 × 1024-code-unit avatar field, while keeping the avatar compression target at 5KiB.
- Remove History cumulative session caps without leaving immortal or unbounded owned work.
- Replace the old hash-to-Base64 content map with a session-only Blob locator map while keeping data URLs as the only sent and persistent image representation.
- Make one current-only protocol cut and preserve the Owner's no-new-test policy.

**Non-Goals:**

- Increasing the 500-code-unit visible-text rule, changing it to grapheme counting, guaranteeing a fixed image count, or changing compression quality policy.
- Adding application fragmentation/reassembly, streaming attachments, upload storage, thumbnails, rich-text editing, or an image preview UI.
- Changing message/user shapes, History variants, peer ACK/retry/resume, source concurrency, delivery buffering, databases, dependencies, signaling, or user-visible History feedback.
- Preserving interoperability with peers built against the older capacity values or reading old `hash:` drafts.

## Decisions

### 1. Each layer has one explicit unit and owner

| Layer                            |                                Contract | Owner                                                    |
| -------------------------------- | --------------------------------------: | -------------------------------------------------------- |
| Visible text                     | 500 JavaScript string/UTF-16 code units | textarea/UI                                              |
| Image compression                |                  30KiB target per image | editor image compression                                 |
| Wire `body` field                | 192 × 1024 JavaScript/UTF-16 code units | static declarative Schema                                |
| Final encoded frame              |                                  256KiB | `NativeWireCodec` preflight/decode                       |
| Decompressed JSON                |                                    1MiB | streaming codec decode before UTF-8/JSON materialization |
| Avatar compression               |                             5KiB target | profile/avatar production                                |
| `ChatUser.avatar` field          |   8 × 1024 JavaScript/UTF-16 code units | static declarative Schema                                |
| History Push count               |                    at most 100 messages | declarative schema and History pager                     |
| History Pull/Push frame          |              256KiB final encoded frame | common codec preflight                                   |
| Per-source decode queue          |  8 frames / 256KiB aggregate wire bytes | `WireDomain` operational admission                       |
| Per-domain inbound un-ACK buffer |      512 records / 8MiB canonical bytes | `DeliveryDomain` operational admission                   |

KiB means 1024 bytes at byte-owning codec/queue/buffer boundaries. Field ceilings are explicitly JavaScript string/UTF-16 code units rather than bytes. A target is best-effort compression output, not a hard guarantee. The contract promises no fixed image count because final JSON, deflate, Base64, and envelope overhead determine whether the codec accepts a frame.

The 500-code-unit UI rule keeps literal user-entered text short. The declarative wire `body` ceiling becomes 192 × 1024 JavaScript string/UTF-16 code units so send-time data URLs are structurally representable. No `MAX_CHAT_MESSAGE_BYTES`, complete-object UTF-8 measurement, or equivalent object-budget concept exists. An outbound typed value passes the same pure static Schema once at the unified send boundary and then the real 1MiB decoded-JSON and 256KiB final-frame codec boundaries.

Alternative rejected: add a Footer or protocol complete-object byte check. Static Schema cannot describe that rule, duplicating it across producers and consumers creates over-defensive validation, and the real codec already owns physical frame admission.

### 2. One pure Schema validates at receive, send, and local load

Valibot schemas remain static and declarative. They define complete structures and enforce built-in field/array rules without callback, transform, clock, Set, map, dynamic context, or caller-side post-parse predicates. The expanded `body` ceiling and retained user/avatar limits use those built-in rules. The codec separately rejects a complete decompressed JSON value over 1MiB or final encoded frame over 256KiB as representation work, not message validation.

Peer input is decoded and parsed once through the room-selected static Schema. An outbound protocol value is parsed once through that same complete Schema before codec encoding. Each unknown local persistence record is parsed once through its complete declarative record Schema before projection. Those are the only three protocol-validation boundaries. Local production, persistence write, History supply, clock adoption, and downstream Session/History/Delivery paths trust their TypeScript inputs and add no other parse or field inspection.

This decision preserves the schema-derived data graph, declarative-only validation, the three unified validation boundaries, and the absence of cross-field/clock/URL/reference validation. It explicitly rejects `isChatMessageWithinBudget`, `isChatUserWithinBudget`, `utf8ByteLength`, `MAX_CHAT_MESSAGE_BYTES`, and any equivalent complete-object helper or call chain.

Alternative rejected: disguise UTF-8 object bytes as `v.maxLength`. JavaScript string units are not UTF-8 bytes and static Schema cannot measure a complete serialized object, so no such object rule is claimed.

### 3. One 256KiB final frame is the physical contract

`NativeWireCodec.encode` serializes one value to UTF-8 JSON, rejects that uncompressed byte sequence above 1MiB, deflates it, Base64-encodes it, and rejects the final string above 256KiB before handing any bytes to Artico. Decode rejects a non-canonical/malformed Base64 frame or final input above 256KiB, limits streamed decompression to 1MiB before UTF-8 decode/JSON parse, and returns `unknown` for the existing schema boundary.

The application adds no fragmentation, reassembly, attachment stream, alternate envelope, or frame-size negotiation. History Pull and Push use this same limit. Push still carries at most 100 messages, and the pager shrinks a page until the real codec accepts it. If one typed record from the persistence-load boundary plus required authors and Push envelope does not fit, that source-local History attempt fails instead of applying a separate per-message budget or silently dropping the record.

The existing per-source decode queue remains 8 frames and 256KiB aggregate wire bytes. A full-size frame may therefore occupy the complete byte queue for that source. Queue overflow or a rejected frame remains source-local and must not disconnect/recreate the room.

Alternative rejected: retain 64KiB for History. A message accepted live under the 192/256 contract could never be replayed.

### 4. History has finite data and progress boundaries, not cumulative session caps

Delete `MAX_HISTORY_SESSION_MESSAGES`, `MAX_HISTORY_SESSION_BYTES`, their State fields/checks, and descriptions of a 10,000-entry or 8MiB phase/session ceiling. Requester and provider still freeze independent 180-day snapshots. Pull pages contain continuous inventory slices accepted by the real 256KiB codec; Push pages contain at most 100 recent-first records and remain within the same codec bound.

The complete fixed snapshots may contain all eligible records and IDs. Their lifecycle remains finite and terminates on any of:

- final locally settled `done: true` for the direction;
- fixed requester/provider snapshot exhaustion, including the frozen 180-day cutoff boundary;
- source disconnect or replacement;
- domain release or Runtime lifecycle cleanup;
- explicit cancellation;
- malformed, invalid, reordered, changed replay, gap, post-done, or source-binding failure;
- supplier, persistence, encode, send, delivery-admission, or local-processing failure; or
- 10 seconds without valid forward progress.

Valid forward progress is acceptance/settlement that advances the current inventory page, provider snapshot/supply stage, response page send, response page admission, or local response processing under the complete current attempt identity. The deadline is re-armed only by such progress; duplicate/replayed work cannot keep an attempt alive. A stale timeout/token/completion cannot affect another attempt.

Every terminal path discards requester/provider inventories, snapshots, response pages, pending queues/sends, page fingerprints, working counters, and attempt-owned History feedback. It releases source/global supplier admission. If selected page supply is physically running, cancellation drives the existing `AbortSignal` through the IndexedDB query and projection/filter/sort chain, and slot release or successor promotion waits for actual settlement. Terminal source bindings remain only as already specified to prevent a second sync on the same connection; source replacement/domain release clears them. No peer ACK, resume, retry, progress persistence, or compatibility path is added.

Alternative rejected: remove caps and keep one fixed wall-clock lifetime. Large but continuously progressing 180-day snapshots would fail arbitrarily; a no-progress deadline bounds stalled work while allowing finite data exhaustion.

### 5. Blob ids are draft-only editor locators

On image insertion, the Footer compresses the file toward 30KiB, generates one opaque editor-session id with the platform `crypto.randomUUID()` API, stores the resulting `Blob` under that id in an editor-owned `Map<string, Blob>`, and inserts exact Markdown `![Image](blob:<id>)` into the textarea. The literal `blob:<id>` is an internal locator, not a browser object URL and not a fetch target. The textarea continues to show literal Markdown text and adds no image thumbnail or preview surface. The editor creates no object URL, performs no immediate Blob-to-data-URL conversion, assigns no image NanoID, and adds no dependency.

On send, the editor resolves every referenced `blob:<id>` through its map, converts each Blob to a data URL, replaces the locators only in one temporary command/message candidate, updates mention ranges through the existing composition owner, and submits that candidate through the unified outbound Schema boundary and codec. The Footer performs no separate parse or complete-message UTF-8/object-budget preflight. The actual sent, locally stored, remotely stored, and History-replayed Markdown contains data URLs only; the draft locator and Blob map never leave the editor session.

A missing id or Blob, Blob read/conversion failure, Schema failure, or codec failure rejects the entire send and preserves the literal draft plus every still-referenced map entry. A successful send clears only the draft it started from; edits made while Blob conversion is running and their referenced entries remain. Explicit draft clear and component unmount delete all entries. When editing removes the last occurrence of one id, the editor deletes that map entry; duplicate occurrences keep one entry until the final reference disappears. Deleting an entry lets the Blob become garbage-collectable; no object URL is created or revoked.

Delete `hash:` parsing, image-placeholder NanoID allocation, and the hash-to-Base64 content map in the same cut. The new id-to-Blob map is editor-session ownership, not a compatibility form of the old content map: it stores neither Base64 nor data URLs, is never persisted, and accepts only ids generated by the current editor instance. Do not interpret or migrate an old `hash:` draft.

Alternative rejected: write the complete browser object URL into the textarea. The token exists only to locate an editor-owned Blob, so exposing `blob:<origin>/<uuid>` couples visible draft text to an unnecessary fetch handle and creates a separate revoke lifecycle. Sending any `blob:` locator is also rejected because another peer, History, and later persistent renders cannot resolve the editor session map.

### 6. Capacity changes are one incompatible v6 generation

The new values replace 48KiB message-like, 64KiB final-frame, and 256KiB decompressed ceilings in one delivery. Chat and World advance together from v5 to v6 physical namespaces even though their retained data fields do not change. A v5 peer must not appear reachable to a v6 peer and then reject only larger frames. There is no capacity bit, negotiation message, v5 decoder, fallback limit, dual room publication, dual read/write, translator, migration, or conditional send path.

The implementation does not add repository test cases. Existing tests and fixtures that directly encode old values or the removed hash path may receive only mechanical expectation/value updates or deletion of now-obsolete assertions. Browser interoperability is an external acceptance matrix, not a new automated repository suite.

## Risks / Trade-offs

- [A 256KiB data-channel string is not interoperable in every target pairing] -> Gate delivery on bidirectional 64/128/192/256KiB Chrome/Firefox tests and treat any failure as a contract blocker rather than adding negotiation or fallback; v6 must not ship if the current target matrix fails.
- [A highly compressible frame expands excessively] -> Stop streaming decompression at 1MiB before UTF-8/JSON materialization.
- [Callers add defensive validation beyond Schema] -> Forbid complete-object byte helpers and caller-side guard matrices; retain only static field/array rules and the physical codec boundaries.
- [History can retain a large fixed snapshot] -> Keep bounded pages, concurrency, AbortSignal cancellation, no-progress timeout, finite 180-day/data-exhaustion termination, and complete terminal release.
- [Repeated valid progress can make a large History sync long-lived] -> This is intentional while the finite frozen snapshot advances; no-progress work still terminates after 10 seconds.
- [Session Blob entries remain after the draft no longer references them] -> Delete an entry at final-reference removal, successful send, explicit clear, or unmount.
- [A failed send deletes images and destroys the draft] -> Delete entries only after success or actual final-reference removal; preserve current referenced entries on every failure.
- [Four-image expectations become a product promise] -> Document only a typical estimate; enforce bytes, not image count.

## Migration Plan

1. Land this docs authority and obtain fresh independent review before implementation.
2. Implement the v6 namespace cut, static field limits, codec, History accounting removal, editor Blob lifecycle, and only mechanical existing-test updates in one requirement branch and Draft PR.
3. Run repository gates and the external browser matrix on one immutable implementation exact. Oversize rejection must remain source-local and leave the room usable.
4. Deliver as one clean current-only cut with no data or draft migration. Roll back only by reverting the complete requirement PR.
